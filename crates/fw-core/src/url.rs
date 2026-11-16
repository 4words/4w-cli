//! Endpoint validation and 4-word link normalization (shared rules with the TS CLI).

use crate::error::{Error, Result};
use crate::lang::trs;
pub use reqwest::Url;

pub const SITE: &str = "https://4words.aletheia.land";
pub const REPO: &str = "https://github.com/4words/4w-cli";

pub fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

pub fn is_loopback(url: &Url) -> bool {
    url.host_str().is_some_and(is_loopback_host)
}

/// HTTPS, or HTTP on loopback; never embedded credentials.
pub fn assert_safe_url(raw: &str, name: &str) -> Result<Url> {
    let bad = || {
        Error::usage(trs(
            format!("{name} must use HTTPS or loopback HTTP without embedded credentials."),
            format!("{name} deve usar HTTPS ou HTTP em loopback, sem credenciais na URL."),
            format!("{name} debe usar HTTPS o HTTP en loopback, sin credenciales en la URL."),
        ))
    };
    let url = Url::parse(raw).map_err(|_| bad())?;
    let ok = url.scheme() == "https" || (is_loopback(&url) && url.scheme() == "http");
    if !ok || !url.username().is_empty() || url.password().is_some() {
        return Err(bad());
    }
    Ok(url)
}

/// MCP endpoint from `FOURWORDS_MCP_URL` or the public site.
pub fn mcp_endpoint() -> Result<Url> {
    let raw = std::env::var("FOURWORDS_MCP_URL").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| format!("{SITE}/mcp"));
    assert_safe_url(&raw, "FOURWORDS_MCP_URL")
}

fn is_word(segment: &str) -> bool {
    !segment.is_empty() && segment.chars().all(|c| c.is_alphanumeric())
}

/// `word-word-word-word-123 456 789` → `word-word-word-word-123456789` (exactly 9 digits).
fn normalize_combo(text: &str) -> String {
    let tail_ok = |tail: &str| {
        let (Some(first), Some(last)) = (tail.chars().next(), tail.chars().next_back()) else { return false };
        first.is_ascii_digit()
            && last.is_ascii_digit()
            && tail.chars().all(|c| c.is_ascii_digit() || c.is_whitespace() || matches!(c, '.' | '_' | '-'))
    };
    for (index, _) in text.match_indices('-') {
        let tail = &text[index + 1..];
        if !tail_ok(tail) {
            continue;
        }
        let head = &text[..index];
        let mut segments = head.rsplit('-');
        // Three whole words, then a fourth whose trailing run of letters/digits is the word
        // (it may be preceded by a scheme or path such as `https://host/`).
        let words_ok = (0..4).all(|i| {
            segments.next().is_some_and(|s| if i < 3 { is_word(s) } else { s.chars().next_back().is_some_and(char::is_alphanumeric) })
        });
        if !words_ok {
            continue;
        }
        let digits: String = tail.chars().filter(char::is_ascii_digit).collect();
        return if digits.len() == 9 { format!("{head}-{digits}") } else { text.to_string() };
    }
    text.to_string()
}

/// Turns a link or `a-b-c-d-123456789` combo into an absolute URL plus an optional `#key=` secret.
pub fn normalize_target(raw: &str, base: &Url) -> Result<(Url, Option<String>)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Error::usage(trs(
            "Provide a link or 4-word code.",
            "Informe um link ou código de 4 palavras.",
            "Indique un enlace o código de 4 palabras.",
        )));
    }
    let (without_hash, fragment_key) = match trimmed.split_once('#') {
        Some((head, hash)) => {
            let key = hash.split('&').find_map(|part| part.strip_prefix("key=")).filter(|k| {
                !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            });
            (head, key.map(str::to_string))
        }
        None => (trimmed, None),
    };
    let normalized = normalize_combo(without_hash);
    let lower = normalized.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let url = Url::parse(&normalized).map_err(|_| {
            Error::usage(trs(
                "URL must use HTTPS or loopback HTTP without credentials.",
                "A URL deve usar HTTPS ou HTTP em loopback, sem credenciais.",
                "La URL debe usar HTTPS o HTTP en loopback, sin credenciales.",
            ))
        })?;
        let ok = url.scheme() == "https" || (is_loopback(&url) && url.scheme() == "http");
        if !ok || !url.username().is_empty() || url.password().is_some() {
            return Err(Error::usage(trs(
                "URL must use HTTPS or loopback HTTP without credentials.",
                "A URL deve usar HTTPS ou HTTP em loopback, sem credenciais.",
                "La URL debe usar HTTPS o HTTP en loopback, sin credenciales.",
            )));
        }
        return Ok((url, fragment_key));
    }
    let path = normalized.trim_start_matches('/');
    let origin = Url::parse(&base.origin().ascii_serialization()).map_err(|e| Error::other(e.to_string()))?;
    let url = origin.join(&format!("/{path}")).map_err(|e| Error::usage(e.to_string()))?;
    Ok((url, fragment_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_rules() {
        assert!(assert_safe_url("https://x.example/mcp", "X").is_ok());
        assert!(assert_safe_url("http://127.0.0.1:9/mcp", "X").is_ok());
        assert!(assert_safe_url("http://x.example/mcp", "X").is_err());
        assert!(assert_safe_url("https://u:p@x.example/", "X").is_err());
        assert!(assert_safe_url("ftp://localhost/", "X").is_err());
    }

    #[test]
    fn combo_normalization() {
        let base = Url::parse("https://4words.aletheia.land/mcp").unwrap();
        let (url, key) = normalize_target("lua-gato-sol-rio-123 456 789#key=AbC_-1", &base).unwrap();
        assert_eq!(url.as_str(), "https://4words.aletheia.land/lua-gato-sol-rio-123456789");
        assert_eq!(key.as_deref(), Some("AbC_-1"));
        let (url, _) = normalize_target("lua-gato-sol-rio-123.456.789", &base).unwrap();
        assert_eq!(url.path(), "/lua-gato-sol-rio-123456789");
        let (url, _) = normalize_target("https://4words.aletheia.land/a-b-c-d-123456789", &base).unwrap();
        assert_eq!(url.host_str(), Some("4words.aletheia.land"));
        assert!(normalize_target("http://evil.example/x", &base).is_err());
        assert!(normalize_target("   ", &base).is_err());
    }
}
