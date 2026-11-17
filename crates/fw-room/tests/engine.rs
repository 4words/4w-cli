//! End-to-end tests of the sync engine against a scripted loopback server (MCP + SSE).

use axum::extract::State;
use axum::response::IntoResponse;
use axum::response::sse::{Event as SseEvent, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use fw_core::mcp::Mcp;
use fw_room::{Auth, Conn, Event, RoomClient, SyncOptions, Transport, TransportMode, start};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

#[derive(Clone)]
struct Mock {
    calls: Arc<Mutex<Vec<(String, Value)>>>,
    sse_status: u16,
    sse: broadcast::Sender<(String, String)>,
    wait_script: Arc<Mutex<Vec<Value>>>,
    origin: Arc<Mutex<String>>,
}

async fn mcp(State(m): State<Mock>, Json(body): Json<Value>) -> impl IntoResponse {
    let id = body["id"].clone();
    let method = body["method"].as_str().unwrap_or("");
    let reply = |result: Value| {
        (axum::http::StatusCode::OK, [("Mcp-Session-Id", "s")], Json(json!({"jsonrpc":"2.0","id":id,"result":result}))).into_response()
    };
    match method {
        "initialize" => reply(json!({"protocolVersion":"2025-03-26"})),
        "notifications/initialized" => axum::http::StatusCode::ACCEPTED.into_response(),
        "tools/call" => {
            let name = body["params"]["name"].as_str().unwrap_or("").to_string();
            let args = body["params"]["arguments"].clone();
            m.calls.lock().unwrap().push((name.clone(), args));
            let origin = m.origin.lock().unwrap().clone();
            let sc = match name.as_str() {
                "chat_join" => json!({
                    "nick": "eu-1", "last_seq": 1, "fourwords_url": "https://4words.example/a-b-c-d-123456789",
                    "stream_url": format!("{origin}/chat/h/events"),
                    "participants": [{"nick": "eu-1", "role": "human", "via": ["http"]}],
                    "markdown": {"content": "# Doc", "updatedAt": 0, "version": 0, "history": []},
                }),
                "chat_messages" => json!({"messages": [{"seq": 1, "nick": "ana", "ts": 1, "role": "human", "text": "oi"}], "last_seq": 1}),
                "chat_wait_events" => {
                    let next = {
                        let mut s = m.wait_script.lock().unwrap();
                        if s.is_empty() { None } else { Some(s.remove(0)) }
                    };
                    match next {
                        Some(v) if v.is_number() => {
                            return axum::http::StatusCode::from_u16(v.as_u64().unwrap() as u16).unwrap().into_response();
                        }
                        Some(v) => v,
                        None => {
                            tokio::time::sleep(Duration::from_millis(300)).await;
                            json!({"messages": [], "timed_out": true})
                        }
                    }
                }
                _ => json!({"ok": true}),
            };
            reply(json!({"structuredContent": sc}))
        }
        _ => reply(json!({})),
    }
}

async fn events(State(m): State<Mock>) -> impl IntoResponse {
    if m.sse_status != 200 {
        return axum::http::StatusCode::from_u16(m.sse_status).unwrap().into_response();
    }
    let rx = m.sse.subscribe();
    let head = tokio_stream::iter(vec![
        Ok::<_, std::convert::Infallible>(SseEvent::default().event("ready").data(json!({"nick":"eu-1","lastSeq":1,"participants":[{"nick":"eu-1","role":"human","via":["sse","http"]},{"nick":"bia","role":"llm","via":["http"],"status":"working","statusDetail":"sending_reply"}],"expiresAt":9999999999999u64}).to_string())),
    ]);
    let live = BroadcastStream::new(rx).filter_map(|r| r.ok()).map(|(name, data)| Ok(SseEvent::default().event(name).data(data)));
    Sse::new(head.chain(live)).into_response()
}

async fn serve(sse_status: u16, waits: Vec<Value>) -> (Mock, String) {
    let (sse, _) = broadcast::channel(16);
    let mock = Mock { calls: Default::default(), sse_status, sse, wait_script: Arc::new(Mutex::new(waits)), origin: Default::default() };
    let app = Router::new().route("/mcp", post(mcp)).route("/chat/h/events", get(events)).with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    *mock.origin.lock().unwrap() = origin.clone();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (mock, origin)
}

fn client(origin: &str) -> RoomClient {
    let mcp = Mcp::with_endpoint(format!("{origin}/mcp").parse().unwrap(), None).unwrap();
    RoomClient::new(mcp, "a-b-c-d-123456789", Auth::default())
}

async fn init(client: &RoomClient) {
    client.mcp().initialize().await.unwrap();
}

/// Every event received so far is kept in `log`; `next` looks at not-yet-consumed ones first.
struct Feed {
    session: fw_room::Session,
    log: Vec<Event>,
    consumed: usize,
}

impl Feed {
    fn new(session: fw_room::Session) -> Self {
        Self { session, log: Vec::new(), consumed: 0 }
    }

    async fn next(&mut self, secs: u64, pred: impl Fn(&Event) -> bool) -> Event {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
        loop {
            while self.consumed < self.log.len() {
                let ev = self.log[self.consumed].clone();
                self.consumed += 1;
                if pred(&ev) {
                    return ev;
                }
            }
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(left, self.session.events.recv()).await {
                Ok(Some(ev)) => self.log.push(ev),
                other => panic!("expected event not received: {other:?}\nlog: {:#?}", self.log),
            }
        }
    }
}

#[tokio::test]
async fn sse_flow_delivers_backlog_then_live_messages_and_doc_patches() {
    let (mock, origin) = serve(200, vec![]).await;
    let c = client(&origin);
    init(&c).await;
    let mut feed = Feed::new(start(c, SyncOptions { mode: TransportMode::Sse, ..Default::default() }));

    let ready = feed.next(5, |e| matches!(e, Event::Ready(_))).await;
    let Event::Ready(info) = ready else { unreachable!() };
    assert_eq!(info.nick, "eu-1");
    // join said last_seq=1: the backlog (seq 1) must still be delivered (regression from the TS port).
    let backlog = feed.next(5, |e| matches!(e, Event::Messages { .. })).await;
    let Event::Messages { messages, .. } = backlog else { unreachable!() };
    assert_eq!(messages.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![1]);
    feed.next(5, |e| matches!(e, Event::Conn(Conn::Live(Transport::Sse)))).await;

    // The stream identifies with our nick.
    mock.sse.send(("msg".into(), json!({"seq": 2, "nick": "bia", "ts": 5, "role": "llm", "text": "ola \u{1b}[31mx"}).to_string())).unwrap();
    mock.sse.send(("msg".into(), json!({"seq": 2, "nick": "bia", "ts": 5, "role": "llm", "text": "dup"}).to_string())).unwrap();
    mock.sse
        .send((
            "doc".into(),
            json!({"content": "# Novo", "editor": "bia", "ts": 7, "version": 1, "additions": 2, "deletions": 1}).to_string(),
        ))
        .unwrap();
    let live = feed.next(5, |e| matches!(e, Event::Messages { messages, .. } if messages[0].seq == 2)).await;
    let Event::Messages { messages, .. } = live else { unreachable!() };
    assert!(!messages[0].text.contains('\u{1b}'), "remote escape must be neutralized at ingest");
    let doc = feed.next(5, |e| matches!(e, Event::Doc { initial: false, .. })).await;
    let Event::Doc { doc, additions, deletions, .. } = doc else { unreachable!() };
    assert_eq!((doc.content.as_str(), doc.updated_at, additions, deletions), ("# Novo", 7, 2, 1));
    let presence = feed
        .log
        .iter()
        .find_map(|e| match e {
            Event::Presence(p) if p.len() == 2 => Some(p.clone()),
            _ => None,
        })
        .expect("presence with the agent");
    assert_eq!(presence[1].status_detail.as_deref(), Some("sending_reply"));
    feed.session.stop();
}

#[tokio::test]
async fn falls_back_to_long_poll_after_three_stream_failures() {
    let waits = vec![json!({"messages": [{"seq": 2, "nick": "ana", "ts": 3, "role": "human", "text": "via poll"}], "last_seq": 2})];
    let (mock, origin) = serve(500, waits).await;
    let c = client(&origin);
    init(&c).await;
    let mut feed = Feed::new(start(c, SyncOptions::default()));
    let ev = feed.next(15, |e| matches!(e, Event::Messages { messages, .. } if messages.iter().any(|m| m.seq == 2))).await;
    let Event::Messages { messages, .. } = ev else { unreachable!() };
    assert_eq!(messages[0].text, "via poll");
    assert!(feed.log.iter().any(|e| matches!(e, Event::Conn(Conn::Live(Transport::Poll)))), "announces the long-poll transport");
    let waits: Vec<_> = mock.calls.lock().unwrap().iter().filter(|(n, _)| n == "chat_wait_events").map(|(_, a)| a.clone()).collect();
    assert_eq!(waits[0]["since"], 1, "cursor starts after the backlog");
    assert_eq!(waits[0]["nick"], "eu-1");
    feed.session.stop();
}

#[tokio::test]
async fn poll_mode_ends_after_persistent_client_errors() {
    let (_mock, origin) = serve(200, vec![json!(404), json!(404), json!(404), json!(404)]).await;
    let c = client(&origin);
    init(&c).await;
    let mut feed = Feed::new(start(c, SyncOptions { mode: TransportMode::Poll, ..Default::default() }));
    let ended = feed.next(15, |e| matches!(e, Event::Conn(Conn::Ended(_)))).await;
    assert!(matches!(ended, Event::Conn(Conn::Ended(reason)) if reason.contains("404")));
}
