//! Events emitted by the sync engine and consumed by any front end (TUI, JSONL).

use crate::model::{Doc, Message, Participant, RoomInfo};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Sse,
    Poll,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Conn {
    Connecting,
    Live(Transport),
    Reconnecting { in_secs: u64, reason: String },
    Ended(String),
}

#[derive(Debug, Clone)]
pub enum Event {
    /// Joined: identity, link and expiry are known.
    Ready(RoomInfo),
    /// New messages (sorted, de-duplicated by `seq`, already sanitized).
    Messages {
        messages: Vec<Message>,
        mentioned_me: bool,
    },
    Presence(Vec<Participant>),
    /// The shared document changed (or was loaded). `history` may be empty for live patches.
    Doc {
        doc: Doc,
        initial: bool,
        additions: u64,
        deletions: u64,
    },
    Conn(Conn),
    /// Our nickname changed (e.g. `/nick`).
    NickChanged(String),
    Expires(u64),
}
