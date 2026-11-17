//! Small helpers shared by the command implementations.

use fw_core::lang::{tr, trs};
use fw_core::secrets::read_secret_file;
use fw_core::{Error, Result, vault};
use serde_json::{Map, Value};

pub const MAX_FILE: u64 = 24 * 1024 * 1024;
pub const MAX_STREAM_FILE: u64 = 1024 * 1024 * 1024;

/// `Usage: 4w <usage>` error.
pub fn usage(text: &str) -> Error {
    Error::usage(format!("{}: 4w {text}", tr("Usage", "Uso", "Uso")))
}

pub fn exact(values: &[String], count: usize, text: &str) -> Result<()> {
    if values.len() == count { Ok(()) } else { Err(usage(text)) }
}

/// Builds a JSON object, dropping `None` values (the TypeScript `compact`).
pub fn compact(pairs: Vec<(&str, Option<Value>)>) -> Value {
    let mut map = Map::new();
    for (key, value) in pairs {
        if let Some(value) = value {
            map.insert(key.to_string(), value);
        }
    }
    Value::Object(map)
}

pub fn s(value: &str) -> Option<Value> {
    Some(Value::String(value.to_string()))
}

pub fn opt_s(value: Option<&str>) -> Option<Value> {
    value.map(|v| Value::String(v.to_string()))
}

pub fn parse_non_negative_int(raw: Option<&str>, flag: &str) -> Result<Option<u64>> {
    let Some(raw) = raw else { return Ok(None) };
    if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(non_negative(flag));
    }
    match raw.parse::<u64>() {
        Ok(n) if n <= 9_007_199_254_740_991 => Ok(Some(n)),
        _ => Err(non_negative(flag)),
    }
}

fn non_negative(flag: &str) -> Error {
    Error::usage(trs(
        format!("{flag} requires a non-negative integer."),
        format!("{flag} requer um inteiro não negativo."),
        format!("{flag} requiere un entero no negativo."),
    ))
}

pub fn markdown_too_long() -> Error {
    Error::usage(trs(
        "Markdown exceeds 50,000 UTF-16 code units.",
        "Markdown excede 50.000 unidades UTF-16.",
        "El Markdown supera las 50.000 unidades UTF-16.",
    ))
}

pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

// ---- notify key -----------------------------------------------------------------------------

pub fn normalize_notify_key(raw: Option<&str>) -> Result<Option<String>> {
    let Some(raw) = raw else { return Ok(None) };
    let clean = raw.trim().to_lowercase();
    if clean.is_empty() {
        return Ok(None);
    }
    if clean.len() != 32 || !clean.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err(Error::usage(trs(
            format!("Invalid notify_key MD5 (expected 32 lowercase hex characters): {raw}"),
            format!("notify_key MD5 inválido (esperado 32 caracteres hexadecimais): {raw}"),
            format!("notify_key MD5 inválido (se esperaban 32 caracteres hexadecimales): {raw}"),
        )));
    }
    Ok(Some(clean))
}

fn notify_required() -> Error {
    Error::usage(trs(
        "--notify requires a 32-character hexadecimal MD5 notify_key.",
        "--notify requer um notify_key MD5 hexadecimal de 32 caracteres.",
        "--notify requiere un notify_key MD5 hexadecimal de 32 caracteres.",
    ))
}

/// Removes the global `--notify <md5>` / `--notify=<md5>` flag (before `--`).
pub fn extract_global_notify(raw: &[String]) -> Result<(Vec<String>, Option<String>)> {
    let end = raw.iter().position(|a| a == "--").unwrap_or(raw.len());
    let mut out = Vec::new();
    let mut key = None;
    let mut i = 0;
    while i < end {
        let token = &raw[i];
        if token == "--notify" {
            match raw.get(i + 1) {
                Some(v) if i + 1 < end && !v.starts_with('-') => key = normalize_notify_key(Some(v))?,
                _ => return Err(notify_required()),
            }
            i += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--notify=") {
            if value.is_empty() {
                return Err(notify_required());
            }
            key = normalize_notify_key(Some(value))?;
            i += 1;
            continue;
        }
        out.push(token.clone());
        i += 1;
    }
    out.extend(raw[end..].iter().cloned());
    Ok((out, key))
}

// ---- LLM identity -----------------------------------------------------------------------------

#[derive(Default, Clone)]
pub struct LlmFlags {
    pub llm_key: Option<String>,
    pub llm_name: Option<String>,
    pub key_file: Option<String>,
    pub from_history: bool,
}

impl LlmFlags {
    pub fn from(p: &crate::args::Parsed) -> Self {
        Self {
            llm_key: p.get("llm-key").map(str::to_string),
            llm_name: p.get("llm-name").map(str::to_string),
            key_file: p.get("key-file").map(str::to_string),
            from_history: p.flag("from-history"),
        }
    }

    /// Resolves `llm_key` / `llm_name`: `--llm-key` > `--key-file` > `--from-history` >
    /// `FOURWORDS_LLM_KEY_FILE` > `FOURWORDS_LLM_KEY` (same precedence as the TypeScript CLI).
    pub fn resolve(&self, room: Option<&str>) -> Result<Vec<(&'static str, Option<Value>)>> {
        let env_file = std::env::var("FOURWORDS_LLM_KEY_FILE").ok().filter(|v| !v.is_empty());
        let key = if let Some(key) = &self.llm_key {
            Some(key.clone())
        } else if let Some(path) = &self.key_file {
            Some(read_secret_file(path, "--key-file")?.to_string())
        } else if let (true, Some(room)) = (self.from_history, room) {
            match vault::llm_key_for(room) {
                Some(k) => Some(k),
                None => env_file_or_env(env_file.as_deref())?,
            }
        } else {
            env_file_or_env(env_file.as_deref())?
        };
        let name = self.llm_name.clone().or_else(|| std::env::var("FOURWORDS_LLM_NAME").ok().filter(|v| !v.is_empty()));
        Ok(vec![("llm_key", key.map(Value::String)), ("llm_name", name.map(Value::String))])
    }
}

fn env_file_or_env(file: Option<&str>) -> Result<Option<String>> {
    if let Some(path) = file {
        return Ok(Some(read_secret_file(path, "FOURWORDS_LLM_KEY_FILE")?.to_string()));
    }
    Ok(std::env::var("FOURWORDS_LLM_KEY").ok().filter(|v| !v.is_empty()))
}

// ---- file/text input --------------------------------------------------------------------------

pub async fn file_stat_size(path: &str, limit: u64) -> Result<u64> {
    let meta = tokio::fs::metadata(path).await.map_err(|e| Error::io(e.to_string()))?;
    if !meta.is_file() {
        return Err(Error::usage(trs("Provide a regular file.", "Informe um arquivo regular.", "Indique un archivo regular.")));
    }
    if meta.len() > limit {
        return Err(too_big(limit));
    }
    Ok(meta.len())
}

fn too_big(limit: u64) -> Error {
    Error::usage(trs(
        format!("File exceeds the {limit} byte limit."),
        format!("Arquivo excede o limite de {limit} bytes."),
        format!("El archivo supera el límite de {limit} bytes."),
    ))
}

pub async fn file_bytes(path: &str, limit: u64) -> Result<Vec<u8>> {
    let size = file_stat_size(path, limit).await?;
    let bytes = tokio::fs::read(path).await.map_err(|e| Error::io(e.to_string()))?;
    if bytes.len() as u64 != size {
        return Err(Error::io(trs(
            "File size changed while reading. Please try again.",
            "O tamanho do arquivo mudou durante a leitura. Tente novamente.",
            "El tamaño del archivo cambió durante la lectura. Intente de nuevo.",
        )));
    }
    Ok(bytes)
}

fn input_too_big(limit: usize) -> Error {
    Error::usage(trs(
        format!("Input exceeds {limit} bytes."),
        format!("A entrada excede {limit} bytes."),
        format!("La entrada supera {limit} bytes."),
    ))
}

fn utf8(bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes)
        .map_err(|_| Error::usage(trs("Input is not valid UTF-8.", "A entrada não é UTF-8 válido.", "La entrada no es UTF-8 válido.")))
}

/// Reads UTF-8 text from a file, from `-` (stdin or the injected `input`), within `limit` bytes.
pub async fn read_text(path: &str, limit: usize, input: Option<&str>) -> Result<String> {
    if path == "-" {
        if let Some(input) = input {
            if input.len() > limit {
                return Err(input_too_big(limit));
            }
            return Ok(input.to_string());
        }
        use tokio::io::AsyncReadExt;
        let mut stdin = tokio::io::stdin().take(limit as u64 + 1);
        let mut buf = Vec::new();
        stdin.read_to_end(&mut buf).await?;
        if buf.len() > limit {
            return Err(input_too_big(limit));
        }
        return utf8(buf);
    }
    utf8(file_bytes(path, limit as u64).await?)
}

pub fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}
