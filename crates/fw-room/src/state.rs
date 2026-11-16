//! Room state: a plain reducer over [`Event`]s, independent of any UI.

use crate::event::{Conn, Event};
use crate::model::{Doc, Message, Participant, Role, RoomInfo};
use std::collections::VecDeque;

pub const MAX_MESSAGES: usize = 5000;

/// Something worth telling the user about after applying an event.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Applied {
    pub new_messages: usize,
    pub mentioned: bool,
    pub doc_changed_by: Option<String>,
    pub presence_changed: bool,
    pub joined: Vec<String>,
    pub left: Vec<String>,
}

#[derive(Debug)]
pub struct RoomState {
    pub info: RoomInfo,
    pub my_nick: String,
    pub messages: VecDeque<Message>,
    pub participants: Vec<Participant>,
    pub doc: Doc,
    pub doc_loaded: bool,
    pub conn: Conn,
    pub expires_at: Option<u64>,
    pub last_seq: u64,
}

impl Default for RoomState {
    fn default() -> Self {
        Self {
            info: RoomInfo::default(),
            my_nick: String::new(),
            messages: VecDeque::new(),
            participants: Vec::new(),
            doc: Doc::default(),
            doc_loaded: false,
            conn: Conn::Connecting,
            expires_at: None,
            last_seq: 0,
        }
    }
}

/// `@nick`, `@all`, `@todos`, `@everyone` (and `@llm`/`@ai` for agents) address a participant.
pub fn mentions(text: &str, nick: &str, role: Role) -> bool {
    if nick.is_empty() {
        return false;
    }
    let lower = text.to_lowercase();
    let nick = nick.to_lowercase();
    let mut rest = lower.as_str();
    while let Some(at) = rest.find('@') {
        rest = &rest[at + 1..];
        let end = rest.find(|c: char| !(c.is_alphanumeric() || c == '-' || c == '_' || c == '(' || c == ')')).unwrap_or(rest.len());
        let word = &rest[..end];
        if word == nick || word == "all" || word == "todos" || word == "everyone" {
            return true;
        }
        if role == Role::Llm && matches!(word, "llm" | "llms" | "ai" | "ia") {
            return true;
        }
    }
    false
}

impl RoomState {
    pub fn is_mine(&self, message: &Message) -> bool {
        !self.my_nick.is_empty() && message.nick == self.my_nick
    }

    pub fn apply(&mut self, event: Event) -> Applied {
        let mut out = Applied::default();
        match event {
            Event::Ready(info) => {
                self.my_nick = info.nick.clone();
                if info.expires_at.is_some() {
                    self.expires_at = info.expires_at;
                }
                self.info = info;
            }
            Event::Messages { messages, mentioned_me } => {
                for message in messages {
                    if message.seq <= self.last_seq && self.messages.iter().any(|m| m.seq == message.seq) {
                        continue;
                    }
                    if !self.is_mine(&message) && mentions(&message.text, &self.my_nick, Role::Human) {
                        out.mentioned = true;
                    }
                    self.last_seq = self.last_seq.max(message.seq);
                    self.messages.push_back(message);
                    out.new_messages += 1;
                }
                if mentioned_me && out.new_messages > 0 {
                    out.mentioned = true;
                }
                self.messages.make_contiguous().sort_by_key(|m| m.seq);
                while self.messages.len() > MAX_MESSAGES {
                    self.messages.pop_front();
                }
            }
            Event::Presence(list) => {
                let before: Vec<&str> = self.participants.iter().map(|p| p.nick.as_str()).collect();
                out.joined = list.iter().filter(|p| !before.contains(&p.nick.as_str())).map(|p| p.nick.clone()).collect();
                out.left = self
                    .participants
                    .iter()
                    .filter(|old| !list.iter().any(|p| p.nick == old.nick))
                    .map(|p| p.nick.clone())
                    .collect();
                if !self.participants.is_empty() || !list.is_empty() {
                    out.presence_changed = self.participants != list;
                }
                self.participants = list;
            }
            Event::Doc { doc, initial, .. } => {
                if !initial && doc.updated_at != self.doc.updated_at {
                    out.doc_changed_by = Some(doc.editor.clone().unwrap_or_default());
                }
                let keep_history = doc.history.is_empty() && doc.version >= self.doc.version;
                let mut doc = doc;
                if keep_history {
                    doc.history = std::mem::take(&mut self.doc.history);
                }
                self.doc = doc;
                self.doc_loaded = true;
            }
            Event::Conn(conn) => self.conn = conn,
            Event::NickChanged(nick) => {
                self.my_nick = nick.clone();
                self.info.nick = nick;
            }
            Event::Expires(ts) => self.expires_at = Some(ts),
        }
        out
    }

    /// Participants sorted for display: humans first, then agents, each alphabetically; me first.
    pub fn sorted_participants(&self) -> Vec<&Participant> {
        let mut list: Vec<&Participant> = self.participants.iter().collect();
        list.sort_by(|a, b| {
            let rank = |p: &Participant| (p.nick != self.my_nick, p.role == Role::Llm, p.nick.to_lowercase());
            rank(a).cmp(&rank(b))
        });
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(seq: u64, nick: &str, text: &str) -> Message {
        Message { seq, nick: nick.into(), ts: 0, role: Role::Human, text: text.into(), file_url: None, filename: None }
    }

    #[test]
    fn dedupes_orders_and_detects_mentions() {
        let mut state = RoomState { my_nick: "eu-1".into(), ..Default::default() };
        let a = state.apply(Event::Messages { messages: vec![msg(2, "ana", "oi @eu-1"), msg(1, "bia", "x")], mentioned_me: false });
        assert_eq!((a.new_messages, a.mentioned), (2, true));
        assert_eq!(state.messages.iter().map(|m| m.seq).collect::<Vec<_>>(), vec![1, 2]);
        let b = state.apply(Event::Messages { messages: vec![msg(2, "ana", "dup"), msg(3, "c", "@all ola")], mentioned_me: false });
        assert_eq!((b.new_messages, b.mentioned), (1, true));
        assert_eq!(state.last_seq, 3);
        let own = state.apply(Event::Messages { messages: vec![msg(4, "eu-1", "@eu-1 eco")], mentioned_me: false });
        assert!(!own.mentioned, "my own messages never notify me");
    }

    #[test]
    fn presence_diff_and_doc_history_is_kept_across_live_patches() {
        let mut state = RoomState::default();
        let p = |n: &str, r: Role| Participant { nick: n.into(), role: r, via: vec![], model: None, status: None, status_detail: None, status_since: None };
        state.apply(Event::Presence(vec![p("a", Role::Human)]));
        let a = state.apply(Event::Presence(vec![p("a", Role::Human), p("b", Role::Llm)]));
        assert_eq!((a.joined, a.left), (vec!["b".to_string()], vec![]));
        let rev = crate::model::Revision { version: 1, nick: "a".into(), ts: 1, content: "x".into(), additions: 1, deletions: 0, rollback_from: None, export_url: None };
        state.apply(Event::Doc { doc: Doc { content: "x".into(), version: 1, updated_at: 5, history: vec![rev], ..Default::default() }, initial: true, additions: 0, deletions: 0 });
        let a = state.apply(Event::Doc { doc: Doc { content: "y".into(), version: 2, updated_at: 9, editor: Some("b".into()), ..Default::default() }, initial: false, additions: 1, deletions: 1 });
        assert_eq!(a.doc_changed_by.as_deref(), Some("b"));
        assert_eq!(state.doc.history.len(), 1, "live patch keeps the known history");
    }
}
