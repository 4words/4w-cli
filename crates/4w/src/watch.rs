//! `4w room watch ROOM`: live TUI on a TTY, one JSON object per line otherwise (`--jsonl`).

use crate::args::{self, flag, string};
use crate::util::{LlmFlags, exact, parse_non_negative_int};
use fw_core::lang::trs;
use fw_core::mcp::Mcp;
use fw_core::sanitize::text_safe;
use fw_core::{Error, Result};
use fw_room::{Auth, Conn, Event, RoomClient, Role, SyncOptions, TransportMode};
use serde_json::{Value, json};
use std::io::Write;

pub const WATCH_USAGE: &str = "room watch ROOM [--nick NICK] [--llm-key KEY | --key-file FILE | --from-history] [--llm-name NAME] [--since N] [--transport auto|sse|poll] [--no-mouse] [--jsonl]";

pub struct WatchOptions {
    pub room: String,
    pub client: RoomClient,
    pub sync: SyncOptions,
    pub mouse: bool,
}

fn role(r: Role) -> &'static str {
    match r {
        Role::Human => "human",
        Role::Llm => "llm",
        Role::Other => "other",
    }
}

fn message_json(m: &fw_room::Message) -> Value {
    let mut v = json!({ "seq": m.seq, "nick": m.nick, "ts": m.ts, "role": role(m.role), "text": m.text });
    if let Some(url) = &m.file_url {
        v["file_url"] = json!(url);
    }
    v
}

/// JSON line for an event (None for events that are not part of the JSONL contract).
pub fn event_json(event: &Event, room: &str) -> Option<Value> {
    Some(match event {
        Event::Ready(info) => {
            let mut v = json!({ "kind": "ready", "room": room });
            if !info.nick.is_empty() {
                v["nick"] = json!(info.nick);
            }
            if let Some(link) = &info.link {
                v["link"] = json!(link);
            }
            v
        }
        Event::Messages { messages, mentioned_me } => json!({
            "kind": "messages",
            "messages": messages.iter().map(message_json).collect::<Vec<_>>(),
            "mentionedMe": mentioned_me,
        }),
        Event::Presence(list) => json!({
            "kind": "participants",
            "participants": list.iter().map(|p| {
                let mut v = json!({ "nick": p.nick, "role": role(p.role) });
                if let Some(m) = &p.model { v["model"] = json!(m); }
                if let Some(s) = &p.status { v["status"] = json!(s); }
                v
            }).collect::<Vec<_>>(),
        }),
        Event::Doc { doc, initial, .. } => {
            let mut v = json!({ "kind": "doc", "updatedAt": doc.updated_at, "version": doc.version, "content": doc.content });
            if *initial {
                v["initial"] = json!(true);
            }
            v
        }
        Event::Conn(Conn::Live(_)) => json!({ "kind": "status", "state": "connected" }),
        Event::Conn(Conn::Reconnecting { in_secs, reason }) => {
            json!({ "kind": "status", "state": "reconnecting", "detail": reason, "retryInSeconds": in_secs })
        }
        Event::Conn(Conn::Ended(reason)) => json!({ "kind": "ended", "reason": reason }),
        Event::Conn(Conn::Connecting) | Event::NickChanged(_) | Event::Expires(_) => return None,
    })
}

fn parse_transport(raw: Option<&str>) -> Result<TransportMode> {
    match raw {
        None | Some("auto") => Ok(TransportMode::Auto),
        Some("sse") => Ok(TransportMode::Sse),
        Some("poll") => Ok(TransportMode::Poll),
        Some(other) => Err(Error::usage(trs(
            format!("Unknown --transport '{other}'. Use auto, sse or poll."),
            format!("--transport '{other}' desconhecido. Use auto, sse ou poll."),
            format!("--transport '{other}' desconocido. Use auto, sse o poll."),
        ))),
    }
}

/// Builds the client and sync options from `room watch` / `room open` arguments.
pub fn parse(rest: &[String]) -> Result<(WatchOptions, bool)> {
    let p = args::parse(
        rest,
        &[
            string("nick"),
            string("llm-key"),
            string("llm-name"),
            string("key-file"),
            flag("from-history"),
            string("since"),
            string("transport"),
            flag("mouse"),
            flag("no-mouse"),
            flag("jsonl"),
        ],
    )?;
    exact(&p.positionals, 1, WATCH_USAGE)?;
    let room = p.positionals[0].clone();
    let since = parse_non_negative_int(p.get("since"), "--since")?.unwrap_or(0);
    let transport = parse_transport(p.get("transport"))?;
    let resolved = LlmFlags::from(&p).resolve(Some(&room))?;
    let pick = |name: &str| {
        resolved.iter().find(|(k, _)| *k == name).and_then(|(_, v)| v.as_ref()).and_then(Value::as_str).map(str::to_string)
    };
    let auth = Auth { llm_key: pick("llm_key"), llm_name: pick("llm_name") };
    let mcp = Mcp::new(None)?;
    let client = RoomClient::new(mcp, room.clone(), auth).with_fixed_nick(p.get("nick").map(str::to_string));
    let sync = SyncOptions { since, mode: transport, ..Default::default() };
    Ok((WatchOptions { room, client, sync, mouse: !p.flag("no-mouse") }, p.flag("jsonl")))
}

fn interactive() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal() && std::env::var("TERM").as_deref() != Ok("dumb")
}

pub async fn run(rest: &[String]) -> Result<()> {
    let (opts, jsonl) = parse(rest)?;
    opts.client.mcp().ensure_ready(false).await?;
    if !jsonl && interactive() {
        return fw_tui::run_room(fw_tui::RoomLaunch {
            client: opts.client,
            sync: opts.sync,
            mouse: opts.mouse,
            owner_admin_key: fw_core::vault::admin_key_for(&opts.room),
            vault_link: None,
        })
        .await;
    }
    stream_jsonl(opts).await
}

/// Script/agent mode: stream events as JSON lines until SIGINT/SIGTERM or the room ends.
async fn stream_jsonl(opts: WatchOptions) -> Result<()> {
    let mut session = fw_room::start(opts.client, opts.sync);
    let mut ended = false;
    #[cfg(unix)]
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    #[cfg(unix)]
    let mut hup = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup())?;
    loop {
        #[cfg(unix)]
        let signal = async {
            tokio::select! {
                _ = term.recv() => {}
                _ = hup.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
        };
        #[cfg(not(unix))]
        let signal = async { let _ = tokio::signal::ctrl_c().await; };
        tokio::select! {
            _ = signal => break,
            event = session.events.recv() => {
                let Some(event) = event else { break };
                let Some(value) = event_json(&event, &opts.room) else { continue };
                if matches!(event, Event::Conn(Conn::Ended(_))) {
                    ended = true;
                }
                let line = text_safe(&serde_json::to_string(&value)?).replace('\u{2028}', " ");
                // text_safe maps \n to itself, but JSON strings never contain raw newlines.
                let mut out = std::io::stdout().lock();
                if writeln!(out, "{line}").and_then(|_| out.flush()).is_err() {
                    break; // reader went away (EPIPE)
                }
                if ended {
                    break;
                }
            }
        }
    }
    session.stop();
    if ended {
        // `ended` already carried the reason; exit non-zero for scripts.
        return Err(Error::other(trs("Room unavailable.", "Sala indisponível.", "Sala no disponible.")));
    }
    Ok(())
}
