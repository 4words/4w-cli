//! Clipboard in layers. The desktop widget denies OSC 52 by default, so a native tool comes first;
//! OSC 52 is used when opted in (`FOURWORDS_OSC52=1`) or when no native tool exists in a remote session.

use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, PartialEq, Eq)]
pub enum CopyResult {
    /// Copied with this command.
    Tool(&'static str),
    /// Sent as an OSC 52 escape sequence (terminal decides).
    Osc52,
    /// Nothing available; caller should show the text.
    Unavailable,
}

fn candidates() -> Vec<(&'static str, Vec<&'static str>)> {
    let mut list: Vec<(&'static str, Vec<&'static str>)> = Vec::new();
    if std::env::var_os("TERMUX_VERSION").is_some() || std::env::var_os("PREFIX").is_some_and(|p| p.to_string_lossy().contains("com.termux")) {
        list.push(("termux-clipboard-set", vec![]));
    }
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        list.push(("wl-copy", vec![]));
    }
    if std::env::var_os("DISPLAY").is_some() {
        list.push(("xclip", vec!["-selection", "clipboard"]));
        list.push(("xsel", vec!["--clipboard", "--input"]));
    }
    if cfg!(target_os = "macos") {
        list.push(("pbcopy", vec![]));
    }
    if cfg!(windows) || std::env::var_os("WSL_DISTRO_NAME").is_some() {
        list.push(("clip.exe", vec![]));
    }
    list
}

fn on_path(program: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else { return false };
    std::env::split_paths(&paths).any(|dir| {
        let candidate = dir.join(program);
        candidate.is_file() || (cfg!(windows) && dir.join(format!("{program}.exe")).is_file())
    })
}

/// OSC 52 sequence for `text` (write it to the terminal to copy through the emulator).
pub fn osc52(text: &str) -> String {
    use base64::Engine;
    format!("\x1b]52;c;{}\x07", base64::engine::general_purpose::STANDARD.encode(text))
}

pub async fn copy(text: &str) -> CopyResult {
    for (program, args) in candidates() {
        if !on_path(program) {
            continue;
        }
        let spawned = Command::new(program).args(&args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
        let Ok(mut child) = spawned else { continue };
        if let Some(mut stdin) = child.stdin.take() {
            if stdin.write_all(text.as_bytes()).await.is_err() {
                continue;
            }
        }
        match tokio::time::timeout(Duration::from_secs(2), child.wait()).await {
            Ok(Ok(status)) if status.success() => return CopyResult::Tool(program),
            _ => {
                let _ = child.kill().await;
            }
        }
    }
    let remote = std::env::var_os("SSH_TTY").is_some() || std::env::var_os("SSH_CONNECTION").is_some();
    if std::env::var("FOURWORDS_OSC52").as_deref() == Ok("1") || remote {
        return CopyResult::Osc52;
    }
    CopyResult::Unavailable
}
