//! Local 24 h credentials vault (`history.json`), format shared with the TypeScript CLI.

use crate::config::{history_path, now_ms};
use crate::error::Result;
use crate::fsutil;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const TTL_MS: u64 = 24 * 60 * 60 * 1000;
pub const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct HistoryEntry {
    pub created_at: u64,
    #[serde(default)]
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fourwords_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delete_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admin_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted: Option<bool>,
}

impl HistoryEntry {
    /// True when this entry refers to the given room (URL, 4-word link or combo).
    pub fn matches_room(&self, room: &str) -> bool {
        let Some(token) = room_token(room) else { return false };
        [&self.url, &self.fourwords_url, &self.combo].into_iter().flatten().any(|candidate| candidate.to_lowercase().contains(&token))
    }

    /// Best human-facing link for this entry.
    pub fn link(&self) -> Option<&str> {
        self.fourwords_url.as_deref().or(self.url.as_deref()).or(self.combo.as_deref())
    }
}

/// Last path segment of a room reference, lowercased, without fragment/query.
pub fn room_token(room: &str) -> Option<String> {
    let base = room.split('#').next()?.split('?').next()?;
    base.split('/').rfind(|s| !s.is_empty()).map(str::to_lowercase)
}

/// Entries younger than 24 h, newest first. A missing/damaged vault is an empty vault.
pub fn load() -> Vec<HistoryEntry> {
    let Some(path) = history_path() else { return Vec::new() };
    let Ok(raw) = std::fs::read_to_string(path) else { return Vec::new() };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&raw) else { return Vec::new() };
    let now = now_ms();
    items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<HistoryEntry>(item).ok())
        .filter(|entry| now.saturating_sub(entry.created_at) <= TTL_MS)
        .collect()
}

fn text(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Records credentials from a command output (no-op when nothing sensitive/linkable is present).
pub fn save_entry(command: &str, output: &Value) {
    if std::env::var("FOURWORDS_NO_HISTORY").as_deref() == Ok("1") {
        return;
    }
    if !output.is_object() {
        return;
    }
    let delete_url = text(output, "delete_url").or_else(|| text(output, "deleteUrl"));
    let admin_key = text(output, "admin_key");
    let llm_key = text(output, "llm_key");
    let url = text(output, "url");
    if delete_url.is_none() && admin_key.is_none() && llm_key.is_none() && url.is_none() {
        return;
    }
    let entry = HistoryEntry {
        created_at: now_ms(),
        command: command.to_string(),
        url,
        fourwords_url: text(output, "fourwords_url"),
        combo: text(output, "combo"),
        delete_url,
        admin_key,
        llm_key,
        encrypted: (output.get("encrypted").and_then(Value::as_bool) == Some(true)).then_some(true),
    };
    let _ = add(entry);
}

/// Prepends an entry (keeps the newest 200) and rewrites the vault atomically with 0600.
pub fn add(entry: HistoryEntry) -> Result<()> {
    let Some(path) = history_path() else { return Ok(()) };
    let mut all = vec![entry];
    all.extend(load());
    all.truncate(MAX_ENTRIES);
    let bytes = serde_json::to_vec_pretty(&all)?;
    fsutil::write_private(&path, &bytes)
}

pub fn clear() {
    if let Some(path) = history_path() {
        let _ = std::fs::remove_file(path);
    }
}

/// Newest recorded `fwllm_` key for the room, if any.
pub fn llm_key_for(room: &str) -> Option<String> {
    load().into_iter().find(|e| e.llm_key.is_some() && e.matches_room(room)).and_then(|e| e.llm_key)
}

/// Newest recorded `fwadm_` key for the room (the owner's moderation key), if any.
pub fn admin_key_for(room: &str) -> Option<String> {
    load().into_iter().find(|e| e.admin_key.is_some() && e.matches_room(room)).and_then(|e| e.admin_key)
}

/// Rooms the user created or opened in the last 24 h, newest first, de-duplicated.
pub fn recent_rooms() -> Vec<HistoryEntry> {
    let mut seen = std::collections::HashSet::new();
    load()
        .into_iter()
        .filter(|e| e.command.starts_with("room ") && e.link().is_some())
        .filter(|e| seen.insert(room_token(e.link().unwrap_or_default()).unwrap_or_default()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_matching_and_tokens() {
        assert_eq!(room_token("https://h/lua-gato-sol-rio-123456789#key=x").as_deref(), Some("lua-gato-sol-rio-123456789"));
        let entry = HistoryEntry {
            created_at: 1,
            command: "room create".into(),
            fourwords_url: Some("https://h/lua-gato-sol-rio-123456789".into()),
            llm_key: Some("fwllm_a".into()),
            ..Default::default()
        };
        assert!(entry.matches_room("lua-gato-sol-rio-123456789"));
        assert!(!entry.matches_room("outra-sala-aqui-xx-111111111"));
    }

    #[test]
    fn entry_serializes_like_the_typescript_cli() {
        let entry = HistoryEntry { created_at: 5, command: "text".into(), url: Some("u".into()), ..Default::default() };
        assert_eq!(serde_json::to_string(&entry).unwrap(), r#"{"created_at":5,"command":"text","url":"u"}"#);
    }
}
