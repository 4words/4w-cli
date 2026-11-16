//! Typed room data. Every string that came from the network is sanitized here, on ingest,
//! because the terminal renderer writes cell symbols verbatim.

use fw_core::sanitize::{clean_line, doc_safe, msg_safe};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Human,
    Llm,
    Other,
}

impl Role {
    fn parse(raw: Option<&str>) -> Role {
        match raw {
            Some("human") | None => Role::Human,
            Some("llm") => Role::Llm,
            Some(_) => Role::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub seq: u64,
    pub nick: String,
    pub ts: u64,
    pub role: Role,
    pub text: String,
    pub file_url: Option<String>,
    pub filename: Option<String>,
}

fn u64_of(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_f64().filter(|f| *f >= 0.0).map(|f| f as u64))
}

fn str_of<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

fn num_of(v: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|k| v.get(*k).and_then(u64_of))
}

impl Message {
    pub fn from_value(v: &Value) -> Option<Message> {
        let seq = num_of(v, &["seq"])?;
        let text = str_of(v, &["text"])?;
        Some(Message {
            seq,
            nick: clean_line(str_of(v, &["nick"]).unwrap_or("?")),
            ts: num_of(v, &["ts"]).unwrap_or(0),
            role: Role::parse(str_of(v, &["role"])),
            text: msg_safe(text),
            file_url: str_of(v, &["file_url", "fileUrl"]).map(clean_line),
            filename: str_of(v, &["filename", "file_name"]).map(clean_line),
        })
    }

    pub fn list_from(value: Option<&Value>) -> Vec<Message> {
        value.and_then(Value::as_array).map(|a| a.iter().filter_map(Message::from_value).collect()).unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Participant {
    pub nick: String,
    pub role: Role,
    pub via: Vec<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub status_detail: Option<String>,
    pub status_since: Option<u64>,
}

impl Participant {
    pub fn from_value(v: &Value) -> Option<Participant> {
        let nick = str_of(v, &["nick"])?;
        Some(Participant {
            nick: clean_line(nick),
            role: Role::parse(str_of(v, &["role"])),
            via: v
                .get("via")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(clean_line).collect())
                .unwrap_or_default(),
            model: str_of(v, &["model"]).map(clean_line),
            status: str_of(v, &["status"]).map(clean_line),
            status_detail: str_of(v, &["statusDetail", "status_detail"]).map(clean_line),
            status_since: num_of(v, &["statusSince", "status_since"]),
        })
    }

    pub fn list_from(value: Option<&Value>) -> Option<Vec<Participant>> {
        value.and_then(Value::as_array).map(|a| a.iter().filter_map(Participant::from_value).collect())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Revision {
    pub version: u64,
    pub nick: String,
    pub ts: u64,
    pub content: String,
    pub additions: u64,
    pub deletions: u64,
    pub rollback_from: Option<u64>,
    pub export_url: Option<String>,
}

impl Revision {
    fn from_value(v: &Value) -> Option<Revision> {
        Some(Revision {
            version: num_of(v, &["version"])?,
            nick: clean_line(str_of(v, &["nick", "editor"]).unwrap_or("?")),
            ts: num_of(v, &["ts", "updatedAt", "updated_at"]).unwrap_or(0),
            content: doc_safe(str_of(v, &["content"]).unwrap_or("")),
            additions: num_of(v, &["additions"]).unwrap_or(0),
            deletions: num_of(v, &["deletions"]).unwrap_or(0),
            rollback_from: num_of(v, &["rollbackFrom", "rollback_from"]),
            export_url: str_of(v, &["download_url", "downloadUrl", "export_url", "exportUrl"]).map(clean_line),
        })
    }
}

/// The shared Markdown scratchpad. `history` is empty when only a live patch was received.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Doc {
    pub content: String,
    pub version: u64,
    pub editor: Option<String>,
    /// Timestamp of the current revision: the `base_updated_at` that `chat_save_doc` expects.
    pub updated_at: u64,
    pub history: Vec<Revision>,
}

impl Doc {
    /// From `chat_join`/`chat_wait_events` (`markdown{content,updatedAt,version,history,editor}`)
    /// or `chat_get_doc` (`content,updated_at,version,history,editor`).
    pub fn from_value(v: &Value) -> Doc {
        Doc {
            content: doc_safe(str_of(v, &["content"]).unwrap_or("")),
            version: num_of(v, &["version"]).unwrap_or(0),
            editor: str_of(v, &["editor"]).filter(|e| *e != "none").map(clean_line),
            updated_at: num_of(v, &["updatedAt", "updated_at"]).unwrap_or(0),
            history: v
                .get("history")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Revision::from_value).collect())
                .unwrap_or_default(),
        }
    }

    /// Live SSE `doc` event: `{content, editor, ts, version, additions, deletions}`.
    pub fn from_live(v: &Value) -> Option<(Doc, u64, u64)> {
        let content = str_of(v, &["content"])?;
        let doc = Doc {
            content: doc_safe(content),
            version: num_of(v, &["version"]).unwrap_or(0),
            editor: str_of(v, &["editor"]).map(clean_line),
            updated_at: num_of(v, &["ts", "updatedAt", "updated_at"]).unwrap_or(0),
            history: Vec::new(),
        };
        Some((doc, num_of(v, &["additions"]).unwrap_or(0), num_of(v, &["deletions"]).unwrap_or(0)))
    }
}

/// What `chat_join` told us about the room and about ourselves.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RoomInfo {
    pub room: String,
    pub nick: String,
    pub role: Option<String>,
    pub link: Option<String>,
    pub stream_url: Option<String>,
    pub expires_at: Option<u64>,
    pub moderation_available: bool,
}

impl RoomInfo {
    pub fn from_join(room: &str, v: &Value) -> RoomInfo {
        RoomInfo {
            room: room.to_string(),
            nick: clean_line(str_of(v, &["nick"]).unwrap_or("")),
            role: str_of(v, &["role"]).map(clean_line),
            link: str_of(v, &["fourwords_url"]).or_else(|| str_of(v, &["combo"])).map(clean_line),
            stream_url: str_of(v, &["stream_url", "streamUrl"]).map(str::to_string),
            expires_at: num_of(v, &["expiresAt", "expires_at"]),
            moderation_available: v.get("moderation_available").and_then(Value::as_bool).unwrap_or(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ingest_sanitizes_and_tolerates_naming_variants() {
        let m = Message::from_value(&json!({"seq": 3, "nick": "a\u{1b}b", "ts": 5, "role": "llm", "text": "x\u{1b}[31m\ty"})).unwrap();
        assert_eq!(m.nick, "a\u{fffd}b");
        assert_eq!(m.text, "x\u{fffd}[31m    y");
        assert_eq!(m.role, Role::Llm);
        let p = Participant::from_value(&json!({"nick": "bia", "role": "llm", "via": ["sse"], "statusDetail": "sending_reply", "statusSince": 9})).unwrap();
        assert_eq!(p.status_detail.as_deref(), Some("sending_reply"));
        let d = Doc::from_value(&json!({"content": "a\tb", "updatedAt": 7, "version": 2, "editor": "none"}));
        assert_eq!((d.updated_at, d.version, d.editor), (7, 2, None));
        let d2 = Doc::from_value(&json!({"content": "z", "updated_at": 8, "history": [{"version": 1, "nick": "n", "ts": 1, "content": "c", "additions": 2, "rollbackFrom": 0}]}));
        assert_eq!((d2.updated_at, d2.history.len(), d2.history[0].rollback_from), (8, 1, Some(0)));
        assert!(Message::from_value(&json!({"nick": "x"})).is_none());
    }
}
