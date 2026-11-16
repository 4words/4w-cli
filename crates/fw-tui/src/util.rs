//! Filesystem helpers for the room UI (path completion, uploads with progress, downloads).

use fw_core::url::Url;
use fw_core::{Error, Result};
use fw_room::RoomClient;
use futures_util::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

pub const MAX_INLINE_FILE: u64 = 24 * 1024 * 1024;

pub fn room_slug(room: &str) -> String {
    let base = room.split(['#', '?']).next().unwrap_or(room);
    let last = base.rsplit('/').find(|s| !s.is_empty()).unwrap_or("room");
    let cleaned: String = last.chars().filter(|c| c.is_alphanumeric() || *c == '-').take(48).collect();
    if cleaned.is_empty() { "room".into() } else { cleaned }
}

pub fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}/{rest}", home.trim_end_matches('/'));
        }
    } else if path == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return home;
        }
    }
    path.to_string()
}

pub fn downloads_dir() -> String {
    if let Ok(home) = std::env::var("HOME") {
        let dir = PathBuf::from(&home).join("Downloads");
        if dir.is_dir() {
            return dir.to_string_lossy().into_owned();
        }
    }
    ".".into()
}

pub fn file_name_from_url(url: &str) -> String {
    let base = url.split(['#', '?']).next().unwrap_or(url);
    let last = base.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or("download");
    safe_name(last)
}

/// A file name safe to create locally (no separators, no control characters, not hidden).
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() { "download".into() } else { trimmed }
}

/// Path completions for a typed prefix (directories get a trailing `/`).
pub fn complete_path(typed: &str) -> Vec<String> {
    let expanded = expand_home(typed);
    let (dir, prefix) = match expanded.rfind('/') {
        Some(i) => (expanded[..=i].to_string(), expanded[i + 1..].to_string()),
        None => ("./".to_string(), expanded.clone()),
    };
    let shown_dir = match typed.rfind('/') {
        Some(i) => typed[..=i].to_string(),
        None => String::new(),
    };
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.starts_with(&prefix) || (name.starts_with('.') && !prefix.starts_with('.')) {
                return None;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(format!("{shown_dir}{name}{}", if is_dir { "/" } else { "" }))
        })
        .collect();
    out.sort();
    out.truncate(50);
    out
}

/// Sends a file to the room: inline (≤ 24 MiB, one request) or streamed upload + link message.
pub async fn upload(client: &RoomClient, path: &str, name: &str, size: u64, burn: bool, progress: Arc<AtomicU64>) -> Result<()> {
    if size <= MAX_INLINE_FILE {
        let bytes = tokio::fs::read(path).await?;
        client.send_file(name, &bytes, None, burn).await?;
        progress.store(size, Ordering::Relaxed);
        return Ok(());
    }
    let file = tokio::fs::File::open(path).await?;
    let counter = progress.clone();
    let stream = tokio_util::io::ReaderStream::new(file).map(move |chunk| {
        if let Ok(bytes) = &chunk {
            counter.fetch_add(bytes.len() as u64, Ordering::Relaxed);
        }
        chunk
    });
    let out = client
        .mcp()
        .upload_file_stream(name, reqwest::Body::wrap_stream(stream), Some(size), burn, "application/octet-stream")
        .await?;
    let url = out
        .get("fourwords_url")
        .or_else(|| out.get("url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::protocol("upload returned no link"))?;
    let delete = out.get("delete_url").and_then(|v| v.as_str());
    client.send_file_link(name, url, name, delete).await?;
    Ok(())
}

/// Downloads a shared link to `path` (creating parent directories; refuses to overwrite silently).
pub async fn download(base: &Url, url: &str, path: &str) -> Result<()> {
    if std::path::Path::new(path).exists() {
        return Err(Error::io(format!("{path} already exists")));
    }
    if let Some(parent) = std::path::Path::new(path).parent().filter(|p| !p.as_os_str().is_empty()) {
        tokio::fs::create_dir_all(parent).await?;
    }
    fw_core::fetch::fetch_link(base, url, Some(path), false, None).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name("a:b?.txt"), "a_b_.txt");
        assert_eq!(file_name_from_url("https://h/x/rel%C3%B3gio.pdf?k=1#f"), "rel%C3%B3gio.pdf");
        assert_eq!(room_slug("https://h/lua-gato-sol-rio-123456789#key=x"), "lua-gato-sol-rio-123456789");
    }

    #[test]
    fn completes_existing_paths() {
        let dir = std::env::temp_dir().join(format!("4w-complete-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("alpha.txt"), "x").unwrap();
        std::fs::write(dir.join("alps.txt"), "x").unwrap();
        let typed = format!("{}/al", dir.display());
        let found = complete_path(&typed);
        assert_eq!(found.len(), 2, "{found:?}");
        let sub = complete_path(&format!("{}/su", dir.display()));
        assert!(sub[0].ends_with("sub/"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
