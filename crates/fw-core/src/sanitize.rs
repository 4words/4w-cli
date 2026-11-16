//! Everything that comes from the network is untrusted. Ratatui writes cell
//! symbols to the terminal verbatim, so control sequences must be neutralized
//! when data enters the model, never only when it is drawn.

use crate::lang::Lang;
use regex_lite::Regex;
use serde_json::Value;
use std::sync::OnceLock;

const REPLACEMENT: char = '\u{fffd}';

fn is_unsafe(c: char, keep_tab_newline: bool) -> bool {
    match c {
        '\t' | '\n' => !keep_tab_newline,
        '\u{0000}'..='\u{001f}' | '\u{007f}'..='\u{009f}' => true,
        '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' => true,
        _ => false,
    }
}

/// Replaces C0/C1 controls (except `\n`), bidi overrides and isolates with U+FFFD.
/// Newlines are preserved; tabs are replaced.
pub fn text_safe(text: &str) -> String {
    text.chars()
        .map(|c| if c == '\n' { c } else if is_unsafe(c, false) { REPLACEMENT } else { c })
        .collect()
}

/// For `get --raw` on a TTY: keeps `\n` and `\t`, normalizes `\r\n`, neutralizes the rest.
pub fn raw_safe(text: &str) -> String {
    text.replace("\r\n", "\n")
        .chars()
        .map(|c| if c == '\n' || c == '\t' { c } else if is_unsafe(c, false) { REPLACEMENT } else { c })
        .collect()
}

/// Single-line variant used for headers, nicks and list rows: newlines become spaces.
pub fn clean_line(text: &str) -> String {
    text_safe(text).replace('\n', " ")
}

fn secret_pattern() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\bfw(?:adm|llm)_[0-9a-f]+\b|https://[^\s<>]+/d/[0-9a-f]{32,}\b").expect("valid regex")
    })
}

pub fn hidden_token(lang: Lang) -> &'static str {
    if lang == Lang::En { "[hidden]" } else { "[oculto]" }
}

/// Masks `fwadm_`/`fwllm_` keys and secret delete links inside free text.
pub fn mask_secrets(text: &str, lang: Lang) -> String {
    secret_pattern().replace_all(text, hidden_token(lang)).into_owned()
}

fn secret_key_name(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    let word = |needle: &str| {
        lower.match_indices(needle).any(|(at, _)| {
            let before = lower[..at].chars().next_back();
            let after = lower[at + needle.len()..].chars().next();
            let edge = |c: Option<char>| matches!(c, None | Some('_') | Some('-'));
            edge(before) && edge(after)
        })
    };
    ["key", "token", "secret", "password", "authorization", "delete_url"].iter().any(|n| word(n))
        || matches!(lower.as_str(), "apikey" | "deleteurl" | "accesstoken" | "llmkey" | "adminkey")
}

/// Pretty JSON with secrets hidden unless `reveal` is set (TUI result viewer).
pub fn json_masked(value: &Value, reveal: bool, lang: Lang) -> String {
    fn walk(value: &Value, reveal: bool, lang: Lang) -> Value {
        match value {
            Value::Object(map) => Value::Object(
                map.iter()
                    .map(|(k, v)| {
                        let masked = if !reveal && secret_key_name(k) {
                            Value::String(hidden_token(lang).into())
                        } else {
                            walk(v, reveal, lang)
                        };
                        (k.clone(), masked)
                    })
                    .collect(),
            ),
            Value::Array(items) => Value::Array(items.iter().map(|v| walk(v, reveal, lang)).collect()),
            Value::String(text) if !reveal => Value::String(mask_secrets(text, lang)),
            other => other.clone(),
        }
    }
    serde_json::to_string_pretty(&walk(value, reveal, lang)).unwrap_or_else(|_| "null".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutralizes_terminal_injection() {
        assert_eq!(text_safe("x\u{1b}[32m\u{202e}"), "x\u{fffd}[32m\u{fffd}");
        assert_eq!(text_safe("a\nb"), "a\nb");
        assert_eq!(text_safe("a\tb"), "a\u{fffd}b");
        assert_eq!(raw_safe("a\u{1b}]0;x\u{7}b\r\nc\td\u{202e}"), "a\u{fffd}]0;x\u{fffd}b\nc\td\u{fffd}");
        assert_eq!(clean_line("a\nb\u{9b}"), "a b\u{fffd}");
    }

    #[test]
    fn masks_secrets_in_text_and_json() {
        let text = "k fwllm_abc123 and fwadm_00ff and https://h.example/d/".to_string() + &"a".repeat(40);
        let masked = mask_secrets(&text, Lang::En);
        assert!(!masked.contains("abc123") && !masked.contains("00ff") && !masked.contains(&"a".repeat(40)));
        assert_eq!(mask_secrets("fwllm_zz plain", Lang::PtBr), "fwllm_zz plain");
        let value = serde_json::json!({"admin_key": "fwadm_1", "url": "u", "nested": {"delete_url": "x", "llm_key": "y"}, "note": "fwllm_ff"});
        let out = json_masked(&value, false, Lang::En);
        assert!(out.contains("[hidden]") && !out.contains("fwadm_1") && !out.contains("\"x\"") && !out.contains("fwllm_ff"));
        assert!(json_masked(&value, true, Lang::En).contains("fwadm_1"));
    }
}
