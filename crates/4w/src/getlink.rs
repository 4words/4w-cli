//! `4w get`: fetch a 4-word link (text page or file), decrypting `4WENC1` payloads.

use crate::util::{compact, opt_s};
use base64::Engine;
use fw_core::lang::trs;
use fw_core::mcp::Mcp;
use fw_core::url::normalize_target;
use fw_core::{Error, ErrorKind, Result, crypto, http};
use regex_lite::Regex;
use serde_json::Value;
use std::time::Duration;

pub struct RawPayload {
    pub text: Option<String>,
    pub bytes: Vec<u8>,
}

fn unescape_html(html: &str) -> String {
    html.replace("&#39;", "'").replace("&quot;", "\"").replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&")
}

fn need_key(file: bool) -> Error {
    Error::new(
        ErrorKind::Crypto,
        if file {
            trs(
                "Encrypted file. Provide the URL with #key= or pass --key KEY.",
                "Arquivo criptografado. Informe a URL com #key= ou use --key CHAVE.",
                "Archivo cifrado. Indique la URL con #key= o use --key CLAVE.",
            )
        } else {
            trs(
                "Encrypted content. Provide the URL with #key= or pass --key KEY.",
                "Conteúdo criptografado. Informe a URL com #key= ou use --key CHAVE.",
                "Contenido cifrado. Indique la URL con #key= o use --key CLAVE.",
            )
        },
    )
}

pub async fn fetch_link(
    mcp: &Mcp,
    raw_target: &str,
    output: Option<&str>,
    want_raw: bool,
    key_flag: Option<&str>,
) -> Result<(Value, Option<RawPayload>)> {
    let (target, fragment_key) = normalize_target(raw_target, mcp.endpoint())?;
    let key = key_flag.map(str::to_string).or(fragment_key);
    let response = http::client()
        .get(target.clone())
        .header("Accept", "text/html, text/plain, application/octet-stream, */*")
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| http::network_error(e, target.path()))?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let path = target.path();
        return Err(Error::new(
            ErrorKind::Http(status),
            trs(
                format!("Failed to fetch {path}: HTTP {status}."),
                format!("Falha ao acessar {path}: HTTP {status}."),
                format!("Error al acceder a {path}: HTTP {status}."),
            ),
        ));
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    if content_type.contains("text/html") {
        let html = String::from_utf8_lossy(&http::read_limited(response, 64 * 1024 * 1024).await?).into_owned();
        let pattern = Regex::new(r#"(?is)<pre[^>]*class="stored"[^>]*>(.*?)</pre>"#).expect("valid regex");
        let Some(found) = pattern.captures(&html).and_then(|c| c.get(1)) else {
            return Err(Error::new(
                ErrorKind::Http(404),
                trs("Content not found or link expired.", "Conteúdo não encontrado ou link expirado.", "Contenido no encontrado o enlace expirado."),
            ));
        };
        let mut text = unescape_html(found.as_str());
        let mut decrypted = false;
        if text.starts_with(crypto::ENC_TEXT_PREFIX) {
            let key = key.as_deref().ok_or_else(|| need_key(false))?;
            let plain = crypto::decrypt_text(&text, key)?;
            text = String::from_utf8(plain).map_err(|_| Error::new(ErrorKind::Crypto, "decrypted content is not valid UTF-8"))?;
            decrypted = true;
        }
        if let Some(path) = output {
            std::fs::write(path, &text)?;
        }
        let value = compact(vec![
            ("ok", Some(Value::Bool(true))),
            ("url", opt_s(Some(target.as_str()))),
            ("type", opt_s(Some("text"))),
            ("decrypted", decrypted.then_some(Value::Bool(true))),
            ("saved_to", opt_s(output)),
            ("content", opt_s(Some(&text))),
        ]);
        let raw = want_raw.then(|| RawPayload { text: Some(text), bytes: Vec::new() });
        return Ok((value, raw));
    }

    let mut bytes = http::read_limited(response, 1024 * 1024 * 1024).await?;
    let mut decrypted = false;
    if crypto::has_binary_magic(&bytes) {
        let key = key.as_deref().ok_or_else(|| need_key(true))?;
        bytes = crypto::decrypt_file(&bytes, key)?;
        decrypted = true;
    } else if content_type.contains("text/plain") {
        let maybe = String::from_utf8_lossy(&bytes).into_owned();
        if maybe.starts_with(crypto::ENC_TEXT_PREFIX) {
            let key = key.as_deref().ok_or_else(|| need_key(false))?;
            bytes = crypto::decrypt_text(&maybe, key)?;
            decrypted = true;
        }
    }
    if let Some(path) = output {
        std::fs::write(path, &bytes)?;
    }
    let lower = content_type.to_lowercase();
    let is_text = lower.starts_with("text/") || lower.contains("json") || lower.contains("markdown");
    let text_content = is_text.then(|| String::from_utf8_lossy(&bytes).into_owned());
    let value = compact(vec![
        ("ok", Some(Value::Bool(true))),
        ("url", opt_s(Some(target.as_str()))),
        ("type", opt_s(Some(if is_text { "text" } else { "file" }))),
        ("content_type", opt_s(Some(&content_type))),
        ("size", Some(Value::from(bytes.len()))),
        ("decrypted", decrypted.then_some(Value::Bool(true))),
        ("saved_to", opt_s(output)),
        ("content", if output.is_some() { None } else { text_content.as_deref().map(|t| Value::String(t.to_string())) }),
        (
            "content_base64",
            (output.is_none() && !is_text).then(|| Value::String(base64::engine::general_purpose::STANDARD.encode(&bytes))),
        ),
    ]);
    let raw = want_raw.then(|| RawPayload { text: text_content, bytes });
    Ok((value, raw))
}
