//! `config.json` (language, update-check cache) and `history.json` locations.
//! Paths and file formats are shared with the TypeScript CLI.

use crate::error::Result;
use crate::fsutil;
use crate::lang::{self, Lang};
use serde_json::{Map, Value};
use std::path::PathBuf;

fn data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return Some(PathBuf::from(local).join("4Words").join("CLI"));
    }
    std::env::var("HOME")
        .ok()
        .filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home).join(".local").join("share").join("4words-cli"))
}

/// Directory that holds the installed executable payload, config and vault.
pub fn base_dir() -> Option<PathBuf> {
    data_dir()
}

pub fn config_path() -> Option<PathBuf> {
    match std::env::var("FOURWORDS_CONFIG_FILE") {
        Ok(path) if !path.is_empty() => Some(PathBuf::from(path)),
        _ => data_dir().map(|dir| dir.join("config.json")),
    }
}

pub fn history_path() -> Option<PathBuf> {
    match std::env::var("FOURWORDS_HISTORY_FILE") {
        Ok(path) if !path.is_empty() => Some(PathBuf::from(path)),
        _ => data_dir().map(|dir| dir.join("history.json")),
    }
}

/// Reads `config.json` as a plain object; missing or damaged files yield `{}`.
pub fn read() -> Map<String, Value> {
    let Some(path) = config_path() else { return Map::new() };
    match std::fs::read_to_string(path).ok().and_then(|raw| serde_json::from_str::<Value>(&raw).ok()) {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

/// Merges `patch` into `config.json`, keeping every other key. Returns the file path.
pub fn update(patch: Map<String, Value>) -> Result<Option<PathBuf>> {
    let Some(path) = config_path() else { return Ok(None) };
    let mut current = read();
    for (key, value) in patch {
        current.insert(key, value);
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(current))?;
    text.push('\n');
    fsutil::write_private(&path, text.as_bytes())?;
    Ok(Some(path))
}

pub fn saved_lang() -> Option<Lang> {
    read().get("lang").and_then(Value::as_str).and_then(|raw| lang::normalize(Some(raw)))
}

pub fn save_lang(lang: Lang) -> Result<Option<PathBuf>> {
    let mut patch = Map::new();
    patch.insert("lang".into(), Value::String(lang.code().into()));
    patch.insert("updated_at".into(), Value::from(now_ms()));
    update(patch)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
