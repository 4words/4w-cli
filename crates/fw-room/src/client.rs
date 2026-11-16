//! Typed calls to the room tools. Cheap to clone; every clone shares the MCP session.

use crate::model::{Doc, Participant};
use fw_core::mcp::Mcp;
use fw_core::sanitize::clean_line;
use fw_core::{Error, Result};
use serde_json::{Map, Value, json};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Default)]
pub struct Auth {
    pub llm_key: Option<String>,
    pub llm_name: Option<String>,
}

#[derive(Clone)]
pub struct RoomClient {
    mcp: Mcp,
    room: String,
    auth: Auth,
    nick: Arc<Mutex<Option<String>>>,
    /// Nickname forced by the user (`--nick`); the server-assigned one never replaces it.
    fixed_nick: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Sent {
    pub seq: u64,
    pub nick: Option<String>,
}

#[derive(Debug, Clone)]
pub enum SaveOutcome {
    Saved { doc: Doc, additions: u64, deletions: u64, export_url: Option<String> },
    Conflict { current_content: String, current_updated_at: u64 },
}

impl RoomClient {
    pub fn new(mcp: Mcp, room: impl Into<String>, auth: Auth) -> Self {
        Self { mcp, room: room.into(), auth, nick: Arc::new(Mutex::new(None)), fixed_nick: None }
    }

    /// Always send this nickname on calls that accept one.
    pub fn with_fixed_nick(mut self, nick: Option<String>) -> Self {
        self.fixed_nick = nick.filter(|n| !n.is_empty());
        self
    }

    pub fn room(&self) -> &str {
        &self.room
    }

    pub fn mcp(&self) -> &Mcp {
        &self.mcp
    }

    pub fn auth(&self) -> &Auth {
        &self.auth
    }

    pub fn nick(&self) -> Option<String> {
        self.fixed_nick.clone().or_else(|| self.nick.lock().ok().and_then(|n| n.clone()))
    }

    pub fn set_nick(&self, nick: &str) {
        if self.fixed_nick.is_some() {
            return;
        }
        if let Ok(mut slot) = self.nick.lock() {
            *slot = (!nick.is_empty()).then(|| nick.to_string());
        }
    }

    fn base(&self, with_nick: bool) -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("url".into(), Value::String(self.room.clone()));
        if let Some(key) = &self.auth.llm_key {
            map.insert("llm_key".into(), Value::String(key.clone()));
        }
        if let Some(name) = &self.auth.llm_name {
            map.insert("llm_name".into(), Value::String(name.clone()));
        }
        if with_nick {
            if let Some(nick) = self.nick() {
                map.insert("nick".into(), Value::String(nick));
            }
        }
        map
    }

    fn with(&self, with_nick: bool, extra: Vec<(&str, Value)>) -> Value {
        let mut map = self.base(with_nick);
        for (k, v) in extra {
            map.insert(k.to_string(), v);
        }
        Value::Object(map)
    }

    pub async fn join(&self) -> Result<Value> {
        self.mcp.call("chat_join", self.with(false, vec![])).await
    }

    pub async fn messages(&self, since: u64) -> Result<Value> {
        self.mcp.call("chat_messages", self.with(true, vec![("since", json!(since))])).await
    }

    pub async fn wait(&self, since: u64, since_doc: u64, timeout_secs: u64) -> Result<Value> {
        let mut extra = vec![
            ("since", json!(since)),
            ("timeout_seconds", json!(timeout_secs)),
            ("mentions_only", json!(false)),
        ];
        if since_doc > 0 {
            extra.push(("since_doc_ts", json!(since_doc)));
        }
        self.mcp.call("chat_wait_events", self.with(true, extra)).await
    }

    pub async fn participants(&self) -> Result<Vec<Participant>> {
        let out = self.mcp.call("chat_participants", self.with(false, vec![])).await?;
        Ok(Participant::list_from(out.get("participants")).unwrap_or_default())
    }

    pub async fn send(&self, text: &str) -> Result<Sent> {
        let out = self.mcp.call("chat_send", self.with(true, vec![("text", json!(text))])).await?;
        Ok(Sent {
            seq: out.get("seq").and_then(Value::as_u64).unwrap_or(0),
            nick: out.get("nick").and_then(Value::as_str).map(clean_line),
        })
    }

    /// Uploads up to 24 MiB inline (base64) and posts the link in the chat.
    pub async fn send_file(&self, filename: &str, bytes: &[u8], text: Option<&str>, burn: bool) -> Result<Value> {
        use base64::Engine;
        let mut extra = vec![
            ("filename", json!(filename)),
            ("content_base64", json!(base64::engine::general_purpose::STANDARD.encode(bytes))),
            ("burn", json!(burn)),
        ];
        if let Some(text) = text.filter(|t| !t.is_empty()) {
            extra.push(("text", json!(text)));
        }
        self.mcp.call("chat_send_file", self.with(true, extra)).await
    }

    /// Posts a message that references an already uploaded file (streaming uploads > 24 MiB).
    pub async fn send_file_link(&self, text: &str, file_url: &str, filename: &str, delete_url: Option<&str>) -> Result<Sent> {
        let mut extra = vec![("text", json!(text)), ("file_url", json!(file_url)), ("filename", json!(filename))];
        if let Some(d) = delete_url {
            extra.push(("delete_url", json!(d)));
        }
        let out = self.mcp.call("chat_send", self.with(true, extra)).await?;
        Ok(Sent { seq: out.get("seq").and_then(Value::as_u64).unwrap_or(0), nick: None })
    }

    pub async fn get_doc(&self) -> Result<Doc> {
        let out = self.mcp.call("chat_get_doc", self.with(false, vec![])).await?;
        Ok(Doc::from_value(&out))
    }

    /// Saves Markdown with optimistic concurrency. A conflict is data, not an error.
    pub async fn save_doc(&self, content: &str, base_updated_at: u64, export_link: bool) -> Result<SaveOutcome> {
        let mut extra = vec![("content", json!(content)), ("base_updated_at", json!(base_updated_at))];
        if export_link {
            extra.push(("export_fourwords_link", json!(true)));
        }
        let out = self.mcp.call_allow_conflict("chat_save_doc", self.with(true, extra)).await?;
        Ok(Self::outcome(&out))
    }

    /// Restores a previous revision as a new, non-destructive edit.
    pub async fn rollback(&self, version: u64) -> Result<SaveOutcome> {
        let out = self
            .mcp
            .call_allow_conflict("chat_save_doc", self.with(true, vec![("rollback_to_version", json!(version))]))
            .await?;
        Ok(Self::outcome(&out))
    }

    fn outcome(out: &Value) -> SaveOutcome {
        if out.get("conflict").is_some_and(|c| !matches!(c, Value::Null | Value::Bool(false))) {
            return SaveOutcome::Conflict {
                current_content: fw_core::sanitize::doc_safe(out.get("current_content").and_then(Value::as_str).unwrap_or("")),
                current_updated_at: out.get("current_updated_at").and_then(Value::as_u64).unwrap_or(0),
            };
        }
        let mut doc = Doc::from_value(out);
        if doc.updated_at == 0 {
            doc.updated_at = out.get("doc_updated_at").and_then(Value::as_u64).unwrap_or(0);
        }
        SaveOutcome::Saved {
            doc,
            additions: out.get("additions").and_then(Value::as_u64).unwrap_or(0),
            deletions: out.get("deletions").and_then(Value::as_u64).unwrap_or(0),
            export_url: out.get("download_url").and_then(Value::as_str).map(clean_line),
        }
    }

    pub async fn roll_nick(&self) -> Result<String> {
        let out = self.mcp.call("chat_roll_nick", self.with(false, vec![])).await?;
        let nick = out.get("nick").and_then(Value::as_str).map(clean_line).ok_or_else(|| Error::protocol("chat_roll_nick returned no nick"))?;
        self.set_nick(&nick);
        Ok(nick)
    }

    /// `action`: `ban` | `unban` | `list` | `verify`.
    pub async fn moderate(&self, admin_key: &str, action: &str, nick: Option<&str>, ban_id: Option<&str>) -> Result<Value> {
        let mut extra = vec![("action", json!(action)), ("admin_key", json!(admin_key))];
        if let Some(n) = nick {
            extra.push(("nick", json!(n)));
        }
        if let Some(b) = ban_id {
            extra.push(("ban_id", json!(b)));
        }
        self.mcp.call("chat_moderate", self.with(false, extra)).await
    }

    /// Creates a room. Returns the raw `chat_create` payload (links and secret keys included).
    pub async fn create(mcp: &Mcp, markdown: Option<&str>, message: Option<&str>, llm_name: Option<&str>) -> Result<Value> {
        let mut args = Map::new();
        if let Some(m) = markdown {
            args.insert("initial_markdown".into(), json!(m));
        }
        if let Some(m) = message {
            args.insert("initial_message".into(), json!(m));
        }
        if let Some(n) = llm_name {
            args.insert("llm_name".into(), json!(n));
        }
        mcp.call("chat_create", Value::Object(args)).await
    }
}
