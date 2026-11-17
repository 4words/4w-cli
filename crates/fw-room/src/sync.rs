//! The sync engine: join, backlog, then live updates.
//!
//! * Primary transport: SSE (`GET /chat/<hash>/events?nick=<nick>`), which pushes messages,
//!   presence and document changes. `?nick=` makes the stream share our MCP identity.
//! * Fallback: `chat_wait_events` long-poll (also used for LLM agents that authenticate by key).
//!   `Auto` switches to it after three consecutive SSE failures.
//!
//! Lessons carried over from the TypeScript `room watch`: the `last_seq` returned by `join` never
//! advances the message cursor (it would hide the backlog), cursors only move on messages actually
//! delivered, and failures back off 1, 2, 4... up to 30 s.

use crate::client::RoomClient;
use crate::event::{Conn, Event, Transport};
use crate::model::{Doc, Message, Participant, RoomInfo};
use futures_util::StreamExt;
use fw_core::http;
use fw_core::sse::{SseEvent, SseParser};
use fw_core::url::Url;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{Instant, sleep, timeout};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportMode {
    Auto,
    Sse,
    Poll,
}

#[derive(Debug, Clone)]
pub struct SyncOptions {
    /// Message cursor to start from (0 = full backlog).
    pub since: u64,
    pub mode: TransportMode,
    pub poll_timeout_secs: u64,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self { since: 0, mode: TransportMode::Auto, poll_timeout_secs: 25 }
    }
}

#[derive(Debug)]
pub enum Control {
    /// Our nickname changed: reconnect the stream with the new identity.
    NickChanged(String),
    /// Re-fetch messages and the document now.
    Refresh,
}

/// Handle to a running room session. Dropping it stops the engine.
pub struct Session {
    pub client: RoomClient,
    pub events: mpsc::UnboundedReceiver<Event>,
    control: mpsc::UnboundedSender<Control>,
    cancel: CancellationToken,
}

impl Session {
    pub fn stop(&self) {
        self.cancel.cancel();
    }

    pub fn control(&self) -> mpsc::UnboundedSender<Control> {
        self.control.clone()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

pub fn start(client: RoomClient, opts: SyncOptions) -> Session {
    let (tx, events) = mpsc::unbounded_channel();
    let (control, ctl_rx) = mpsc::unbounded_channel();
    let cancel = CancellationToken::new();
    let run = Run {
        client: client.clone(),
        tx,
        cancel: cancel.clone(),
        cursor: opts.since,
        doc_ts: 0,
        doc_version: 0,
        stream_url: None,
        last_presence: Vec::new(),
        reconnects: 0,
    };
    tokio::spawn(run.drive(opts, ctl_rx));
    Session { client, events, control, cancel }
}

#[derive(Default)]
struct Backoff(u64);

impl Backoff {
    fn next(&mut self) -> u64 {
        self.0 = if self.0 == 0 { 1 } else { (self.0 * 2).min(30) };
        self.0
    }
    fn reset(&mut self) {
        self.0 = 0;
    }
}

enum SseEnd {
    Cancelled,
    Ended(String),
    Retry { reason: String, lived: Duration },
}

enum PollEnd {
    Cancelled,
    Ended(String),
}

struct Run {
    client: RoomClient,
    tx: mpsc::UnboundedSender<Event>,
    cancel: CancellationToken,
    cursor: u64,
    doc_ts: u64,
    doc_version: u64,
    stream_url: Option<String>,
    last_presence: Vec<Participant>,
    reconnects: u32,
}

type Ctl = Option<mpsc::UnboundedReceiver<Control>>;

async fn recv_ctl(ctl: &mut Ctl) -> Option<Control> {
    match ctl {
        Some(rx) => match rx.recv().await {
            Some(msg) => Some(msg),
            None => {
                *ctl = None;
                std::future::pending().await
            }
        },
        None => std::future::pending().await,
    }
}

impl Run {
    fn emit(&self, event: Event) {
        let _ = self.tx.send(event);
    }

    fn conn(&self, conn: Conn) {
        self.emit(Event::Conn(conn));
    }

    /// Sleeps `secs`; returns false when cancelled meanwhile.
    async fn pause(&self, secs: u64) -> bool {
        tokio::select! {
            _ = self.cancel.cancelled() => false,
            _ = sleep(Duration::from_secs(secs)) => true,
        }
    }

    fn presence(&mut self, list: Vec<Participant>) {
        if list != self.last_presence {
            self.last_presence = list.clone();
            self.emit(Event::Presence(list));
        }
    }

    fn doc(&mut self, doc: Doc, initial: bool, additions: u64, deletions: u64) {
        self.doc_ts = self.doc_ts.max(doc.updated_at);
        self.doc_version = doc.version;
        self.emit(Event::Doc { doc, initial, additions, deletions });
    }

    fn absorb_messages(&mut self, value: Option<&Value>, mentioned_me: bool) {
        let mut fresh: Vec<Message> = Message::list_from(value).into_iter().filter(|m| m.seq > self.cursor).collect();
        if fresh.is_empty() {
            return;
        }
        fresh.sort_by_key(|m| m.seq);
        fresh.dedup_by_key(|m| m.seq);
        if let Some(last) = fresh.last() {
            self.cursor = self.cursor.max(last.seq);
        }
        self.emit(Event::Messages { messages: fresh, mentioned_me });
    }

    async fn fill_messages(&mut self) {
        if let Ok(v) = self.client.messages(self.cursor).await {
            self.absorb_messages(v.get("messages"), false);
            if let Some(list) = Participant::list_from(v.get("participants")) {
                self.presence(list);
            }
        }
    }

    async fn refresh_doc(&mut self) {
        if let Ok(doc) = self.client.get_doc().await
            && (doc.version != self.doc_version || doc.updated_at != self.doc_ts)
        {
            self.doc(doc, false, 0, 0);
        }
    }

    async fn drive(mut self, opts: SyncOptions, ctl_rx: mpsc::UnboundedReceiver<Control>) {
        let mut ctl: Ctl = Some(ctl_rx);
        self.conn(Conn::Connecting);
        let mut backoff = Backoff::default();
        let joined = loop {
            if self.cancel.is_cancelled() {
                return;
            }
            match self.client.join().await {
                Ok(v) => break v,
                Err(error) => {
                    if error.is_permanent_client_error() {
                        self.conn(Conn::Ended(error.to_string()));
                        return;
                    }
                    let secs = backoff.next();
                    self.conn(Conn::Reconnecting { in_secs: secs, reason: error.to_string() });
                    if !self.pause(secs).await {
                        return;
                    }
                }
            }
        };
        backoff.reset();
        let info = RoomInfo::from_join(self.client.room(), &joined);
        self.client.set_nick(&info.nick);
        self.stream_url = info.stream_url.clone();
        if let Some(expires) = info.expires_at {
            self.emit(Event::Expires(expires));
        }
        self.emit(Event::Ready(info));
        if let Some(list) = Participant::list_from(joined.get("participants")) {
            self.presence(list);
        }
        if let Some(markdown) = joined.get("markdown").filter(|m| m.is_object()) {
            let doc = Doc::from_value(markdown);
            self.doc(doc, true, 0, 0);
        }
        // Backlog. The cursor only moves on delivered messages, never from `join`'s last_seq.
        self.fill_messages().await;

        let mut mode = opts.mode;
        if mode == TransportMode::Auto && (self.client.auth().llm_key.is_some() || self.stream_url.is_none()) {
            // Agents authenticate by key (the stream identifies by nick) and servers without a
            // stream endpoint can only be long-polled.
            mode = TransportMode::Poll;
        }
        let mut sse_failures = 0u32;
        loop {
            if self.cancel.is_cancelled() {
                return;
            }
            if mode == TransportMode::Poll {
                match self.run_poll(&opts, &mut ctl).await {
                    PollEnd::Cancelled => return,
                    PollEnd::Ended(reason) => {
                        self.conn(Conn::Ended(reason));
                        return;
                    }
                }
            }
            match self.run_sse(&mut ctl).await {
                SseEnd::Cancelled => return,
                SseEnd::Ended(reason) => {
                    self.conn(Conn::Ended(reason));
                    return;
                }
                SseEnd::Retry { reason, lived } => {
                    if lived >= Duration::from_secs(30) {
                        sse_failures = 0;
                        backoff.reset();
                    } else {
                        sse_failures += 1;
                    }
                    if mode == TransportMode::Auto && sse_failures >= 3 {
                        mode = TransportMode::Poll;
                        self.conn(Conn::Reconnecting { in_secs: 0, reason: format!("{reason} (switching to long-poll)") });
                        continue;
                    }
                    let secs = if lived >= Duration::from_secs(30) { 1 } else { backoff.next() };
                    self.conn(Conn::Reconnecting { in_secs: secs, reason });
                    if !self.pause(secs).await {
                        return;
                    }
                }
            }
        }
    }

    // ---- SSE -----------------------------------------------------------------------------

    fn stream_target(&self) -> Option<Url> {
        let raw = self.stream_url.as_deref()?;
        let mut url = Url::parse(raw).ok()?;
        let endpoint = self.client.mcp().endpoint();
        // The URL comes from the server: only follow it on the same origin as the MCP endpoint.
        if url.origin() != endpoint.origin() {
            return None;
        }
        if let Some(nick) = self.client.nick() {
            url.query_pairs_mut().append_pair("nick", &nick);
        }
        Some(url)
    }

    async fn run_sse(&mut self, ctl: &mut Ctl) -> SseEnd {
        let Some(url) = self.stream_target() else {
            return SseEnd::Retry { reason: "no usable stream URL".into(), lived: Duration::ZERO };
        };
        let mut request = http::client().get(url).header("Accept", "text/event-stream").header("Cache-Control", "no-cache");
        if self.cursor > 0 {
            request = request.header("Last-Event-ID", self.cursor.to_string());
        }
        if let Some(bearer) = self.client.mcp().bearer() {
            request = request.header("Authorization", bearer);
        }
        let started = Instant::now();
        let response = tokio::select! {
            _ = self.cancel.cancelled() => return SseEnd::Cancelled,
            r = timeout(Duration::from_secs(20), request.send()) => r,
        };
        let response = match response {
            Err(_) => return SseEnd::Retry { reason: "stream connection timed out".into(), lived: started.elapsed() },
            Ok(Err(e)) => return SseEnd::Retry { reason: http::network_error(e, "stream").to_string(), lived: started.elapsed() },
            Ok(Ok(r)) => r,
        };
        let status = response.status().as_u16();
        if matches!(status, 404 | 410) {
            return SseEnd::Ended(format!("HTTP {status}"));
        }
        if !(200..300).contains(&status) {
            return SseEnd::Retry { reason: format!("stream returned HTTP {status}"), lived: started.elapsed() };
        }
        let mut stream = response.bytes_stream();
        let mut parser = SseParser::new();
        let mut announced = false;
        loop {
            tokio::select! {
                _ = self.cancel.cancelled() => return SseEnd::Cancelled,
                msg = recv_ctl(ctl) => match msg {
                    Some(Control::NickChanged(nick)) => {
                        self.client.set_nick(&nick);
                        return SseEnd::Retry { reason: "nickname changed".into(), lived: Duration::from_secs(60) };
                    }
                    Some(Control::Refresh) => {
                        self.fill_messages().await;
                        self.refresh_doc().await;
                    }
                    None => {}
                },
                next = timeout(Duration::from_secs(70), stream.next()) => match next {
                    Err(_) => return SseEnd::Retry { reason: "stream stalled".into(), lived: started.elapsed() },
                    Ok(None) => return SseEnd::Retry { reason: "stream closed".into(), lived: started.elapsed() },
                    Ok(Some(Err(e))) => return SseEnd::Retry { reason: http::network_error(e, "stream").to_string(), lived: started.elapsed() },
                    Ok(Some(Ok(bytes))) => {
                        for event in parser.push(&bytes) {
                            self.on_sse_event(event, &mut announced).await;
                        }
                    }
                },
            }
        }
    }

    async fn on_sse_event(&mut self, event: SseEvent, announced: &mut bool) {
        let data: Value = serde_json::from_str(&event.data).unwrap_or(Value::Null);
        match event.event.as_deref() {
            Some("ready") => {
                if let Some(list) = Participant::list_from(data.get("participants")) {
                    self.presence(list);
                }
                if let Some(expires) = data.get("expiresAt").and_then(Value::as_u64) {
                    self.emit(Event::Expires(expires));
                }
                // Close the gap between the backlog fetch and the stream becoming live.
                self.fill_messages().await;
                if self.reconnects > 0 {
                    self.refresh_doc().await;
                }
                self.reconnects += 1;
                if !*announced {
                    *announced = true;
                    self.conn(Conn::Live(Transport::Sse));
                }
            }
            Some("presence") => {
                if let Some(list) = Participant::list_from(data.get("participants")) {
                    self.presence(list);
                }
            }
            Some("msg") => {
                if let Some(message) = Message::from_value(&data)
                    && message.seq > self.cursor
                {
                    self.cursor = message.seq;
                    self.emit(Event::Messages { messages: vec![message], mentioned_me: false });
                }
            }
            Some("doc") => {
                if let Some((doc, additions, deletions)) = Doc::from_live(&data)
                    && (doc.updated_at != self.doc_ts || doc.version != self.doc_version)
                {
                    self.doc(doc, false, additions, deletions);
                }
            }
            _ => {}
        }
    }

    // ---- long-poll ------------------------------------------------------------------------

    async fn run_poll(&mut self, opts: &SyncOptions, ctl: &mut Ctl) -> PollEnd {
        let mut backoff = Backoff::default();
        let mut client_errors = 0u32;
        let mut announced = false;
        loop {
            if self.cancel.is_cancelled() {
                return PollEnd::Cancelled;
            }
            let wait = self.client.wait(self.cursor, self.doc_ts, opts.poll_timeout_secs);
            let result = tokio::select! {
                _ = self.cancel.cancelled() => return PollEnd::Cancelled,
                msg = recv_ctl(ctl) => {
                    match msg {
                        Some(Control::NickChanged(nick)) => self.client.set_nick(&nick),
                        Some(Control::Refresh) => {
                            self.fill_messages().await;
                            self.refresh_doc().await;
                        }
                        None => {}
                    }
                    continue;
                }
                r = wait => r,
            };
            match result {
                Ok(v) => {
                    if !announced || backoff.0 > 0 {
                        announced = true;
                        self.conn(Conn::Live(Transport::Poll));
                    }
                    backoff.reset();
                    client_errors = 0;
                    self.absorb_messages(v.get("messages"), v.get("mentioned_me").and_then(Value::as_bool).unwrap_or(false));
                    if let Some(list) = Participant::list_from(v.get("participants")) {
                        self.presence(list);
                    }
                    if v.get("doc_updated").and_then(Value::as_bool) == Some(true)
                        && let Some(markdown) = v.get("markdown").filter(|m| m.is_object())
                    {
                        let doc = Doc::from_value(markdown);
                        if doc.updated_at != self.doc_ts || doc.version != self.doc_version {
                            self.doc(doc, false, 0, 0);
                        }
                    }
                }
                Err(error) => {
                    if self.cancel.is_cancelled() {
                        return PollEnd::Cancelled;
                    }
                    if error.is_permanent_client_error() {
                        client_errors += 1;
                        if client_errors >= 3 {
                            return PollEnd::Ended(error.to_string());
                        }
                    } else {
                        client_errors = 0;
                    }
                    let secs = backoff.next();
                    self.conn(Conn::Reconnecting { in_secs: secs, reason: error.to_string() });
                    if !self.pause(secs).await {
                        return PollEnd::Cancelled;
                    }
                }
            }
        }
    }
}
