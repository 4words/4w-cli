//! MCP client over HTTP (JSON-RPC 2.0). Two negotiation modes, as in the TypeScript CLI:
//! * stateless (`MCP-Protocol-Version: 2026-07-28`, one round trip) for remote endpoints;
//! * stateful (`initialize` + `Mcp-Session-Id`, protocol `2025-03-26`) for loopback endpoints.
//!
//! Responses may be plain JSON or an SSE stream; both are handled.

use crate::error::{Error, ErrorKind, Result};
use crate::http::{self, http_error, network_error};
use crate::lang::trs;
use crate::sse::SseParser;
use crate::url::{self, Url};
use futures_util::StreamExt;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;

const STATELESS_PROTOCOL: &str = "2026-07-28";
const DEFAULT_PROTOCOL: &str = "2025-03-26";
const MAX_RESPONSE: usize = 64 * 1024 * 1024;

struct State {
    session: Option<String>,
    protocol: String,
    initialized: bool,
}

struct Inner {
    http: reqwest::Client,
    endpoint: Url,
    loopback: bool,
    token: Option<String>,
    notify_key: Option<String>,
    next_id: AtomicU64,
    state: Mutex<State>,
}

/// Cheap to clone: every clone shares the session and the connection pool.
#[derive(Clone)]
pub struct Mcp {
    inner: Arc<Inner>,
}

fn env_flag(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

static DEFAULT_NOTIFY: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Process-wide notify key (global `--notify` flag) used when a call site passes none.
pub fn set_default_notify(key: String) {
    let _ = DEFAULT_NOTIFY.set(key);
}

impl Mcp {
    pub fn new(notify_key: Option<String>) -> Result<Self> {
        let notify_key = notify_key.or_else(|| DEFAULT_NOTIFY.get().cloned());
        Self::with_endpoint(url::mcp_endpoint()?, notify_key)
    }

    pub fn with_endpoint(endpoint: Url, notify_key: Option<String>) -> Result<Self> {
        let loopback = url::is_loopback(&endpoint);
        Ok(Self {
            inner: Arc::new(Inner {
                http: http::client(),
                endpoint,
                loopback,
                token: env_flag("FOURWORDS_TOKEN"),
                notify_key,
                next_id: AtomicU64::new(0),
                state: Mutex::new(State { session: None, protocol: DEFAULT_PROTOCOL.into(), initialized: false }),
            }),
        })
    }

    pub fn endpoint(&self) -> &Url {
        &self.inner.endpoint
    }

    pub fn is_loopback(&self) -> bool {
        self.inner.loopback
    }

    pub fn notify_key(&self) -> Option<&str> {
        self.inner.notify_key.as_deref()
    }

    /// Bearer token header value, if `FOURWORDS_TOKEN` is set.
    pub fn bearer(&self) -> Option<String> {
        self.inner.token.as_ref().map(|t| format!("Bearer {t}"))
    }

    /// Whether the default flow runs `initialize` first (loopback / `FOURWORDS_STATELESS=0`).
    pub fn prefers_session(&self) -> bool {
        let stateless = env_flag("FOURWORDS_STATELESS");
        (self.inner.loopback && stateless.as_deref() != Some("1")) || stateless.as_deref() == Some("0")
    }

    async fn can_use_stateless(&self) -> bool {
        match env_flag("FOURWORDS_STATELESS").as_deref() {
            Some("1") => true,
            Some("0") => false,
            _ => !self.inner.loopback && !self.inner.state.lock().await.initialized,
        }
    }

    async fn rpc(&self, method: &str, params: Option<Value>, notification: bool, stateless: bool) -> Result<Value> {
        let id = (!notification).then(|| self.inner.next_id.fetch_add(1, Ordering::SeqCst) + 1);
        let mut request = self
            .inner
            .http
            .post(self.inner.endpoint.clone())
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .timeout(Duration::from_secs(if method == "tools/call" { 120 } else { 30 }));
        if let Some(bearer) = self.bearer() {
            request = request.header("Authorization", bearer);
        }
        {
            let state = self.inner.state.lock().await;
            if stateless {
                request = request.header("MCP-Protocol-Version", STATELESS_PROTOCOL).header("Mcp-Method", method);
                if method == "tools/call"
                    && let Some(name) = params.as_ref().and_then(|p| p.get("name")).and_then(Value::as_str)
                {
                    request = request.header("Mcp-Name", name);
                }
            } else {
                if method != "initialize" {
                    request = request.header("MCP-Protocol-Version", state.protocol.as_str());
                }
                if let Some(session) = &state.session {
                    request = request.header("Mcp-Session-Id", session.as_str());
                }
            }
        }
        let mut body = Map::new();
        body.insert("jsonrpc".into(), json!("2.0"));
        if let Some(id) = id {
            body.insert("id".into(), json!(id));
        }
        body.insert("method".into(), json!(method));
        if let Some(params) = params {
            body.insert("params".into(), params);
        }
        let response = request.json(&Value::Object(body)).send().await.map_err(|e| network_error(e, method))?;
        let status = response.status();
        if !status.is_success() {
            return Err(http_error(status.as_u16(), method));
        }
        if method == "initialize" {
            let session = response.headers().get("Mcp-Session-Id").and_then(|v| v.to_str().ok()).map(str::to_string);
            self.inner.state.lock().await.session = session;
        }
        if notification {
            drop(response);
            return Ok(Value::Null);
        }
        let id = id.expect("requests have an id");
        let is_sse =
            response.headers().get("Content-Type").and_then(|v| v.to_str().ok()).is_some_and(|ct| ct.contains("text/event-stream"));
        let message = if is_sse {
            read_sse_response(response, id).await?
        } else {
            let bytes = http::read_limited(response, MAX_RESPONSE).await?;
            serde_json::from_slice::<Value>(&bytes).map_err(|_| incompatible())?
        };
        if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0") || message.get("id").and_then(Value::as_u64) != Some(id) {
            return Err(incompatible());
        }
        if let Some(error) = message.get("error") {
            let text = error.get("message").and_then(Value::as_str).filter(|m| !m.is_empty());
            return Err(Error::new(
                ErrorKind::Rejected,
                text.map(str::to_string).unwrap_or_else(|| trs("JSON-RPC error.", "Erro JSON-RPC.", "Error JSON-RPC.")),
            ));
        }
        message.get("result").cloned().ok_or_else(|| {
            Error::protocol(trs("MCP response missing result.", "Resposta MCP sem resultado.", "Respuesta MCP sin resultado."))
        })
    }

    /// Runs the MCP handshake (needed on loopback; optional on stateless endpoints).
    pub async fn initialize(&self) -> Result<Value> {
        let protocol = self.inner.state.lock().await.protocol.clone();
        let server = self
            .rpc(
                "initialize",
                Some(json!({
                    "protocolVersion": protocol,
                    "capabilities": {},
                    "clientInfo": { "name": "4w", "version": env!("CARGO_PKG_VERSION") },
                })),
                false,
                false,
            )
            .await?;
        let Some(version) = server.get("protocolVersion").and_then(Value::as_str) else {
            return Err(Error::protocol(trs(
                "MCP did not report a protocol version.",
                "MCP não informou a versão do protocolo.",
                "El MCP no informó la versión del protocolo.",
            )));
        };
        self.inner.state.lock().await.protocol = version.to_string();
        self.rpc("notifications/initialized", None, true, false).await?;
        self.inner.state.lock().await.initialized = true;
        Ok(server)
    }

    /// `initialize` first when the endpoint/mode requires a session (or `force`).
    pub async fn ensure_ready(&self, force: bool) -> Result<()> {
        if self.inner.state.lock().await.initialized {
            return Ok(());
        }
        if force || self.prefers_session() {
            self.initialize().await?;
        }
        Ok(())
    }

    /// All tools, following pagination cursors; returns the raw tool objects.
    pub async fn list(&self) -> Result<Vec<Value>> {
        let mut tools = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut cursor: Option<String> = None;
        let stateless = self.can_use_stateless().await;
        loop {
            let params = cursor.as_ref().map(|c| json!({ "cursor": c }));
            let page = self.rpc("tools/list", params, false, stateless && cursor.is_none()).await?;
            let Some(items) = page.get("tools").and_then(Value::as_array) else {
                return Err(Error::protocol(trs(
                    "MCP returned an invalid tool list.",
                    "O MCP retornou uma lista de ferramentas inválida.",
                    "El MCP devolvió una lista de herramientas inválida.",
                )));
            };
            tools.extend(items.iter().cloned());
            cursor = page.get("nextCursor").and_then(Value::as_str).map(str::to_string);
            match &cursor {
                Some(c) if !seen.insert(c.clone()) => {
                    return Err(Error::protocol(trs("Repeated MCP cursor.", "Cursor MCP repetido.", "Cursor MCP repetido.")));
                }
                Some(_) => {}
                None => break,
            }
        }
        Ok(tools)
    }

    /// Invokes a tool and returns its payload (`structuredContent` or parsed JSON text).
    /// Only transport/protocol failures and `isError` are errors: `ok:false` and `conflict`
    /// stay in the returned value (see [`call`](Self::call) and [`call_allow_conflict`](Self::call_allow_conflict)).
    pub async fn call_raw(&self, name: &str, mut args: Value) -> Result<Value> {
        let stateless = self.can_use_stateless().await;
        if let (Some(key), Value::Object(map)) = (&self.inner.notify_key, &mut args) {
            map.entry("notify_key").or_insert_with(|| Value::String(key.clone()));
        }
        let result = self.rpc("tools/call", Some(json!({ "name": name, "arguments": args })), false, stateless).await?;
        if !result.is_object() {
            return Err(Error::protocol(trs("Expected a JSON object.", "Esperava um objeto JSON.", "Se esperaba un objeto JSON.")));
        }
        let content = result.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
        if result.get("isError").and_then(Value::as_bool) == Some(true) {
            let message = content
                .iter()
                .find(|c| c.get("type").and_then(Value::as_str) == Some("text"))
                .and_then(|c| c.get("text"))
                .and_then(Value::as_str);
            return Err(Error::new(
                ErrorKind::Rejected,
                message.map(str::to_string).unwrap_or_else(|| {
                    trs(format!("MCP rejected {name}."), format!("O MCP recusou {name}."), format!("El MCP rechazó {name}."))
                }),
            ));
        }
        let text = (content.len() == 1 && content[0].get("type").and_then(Value::as_str) == Some("text"))
            .then(|| content[0].get("text").and_then(Value::as_str).map(str::to_string))
            .flatten();
        Ok(match (result.get("structuredContent"), text) {
            (Some(structured), _) => structured.clone(),
            (None, Some(text)) => serde_json::from_str(&text).unwrap_or(Value::String(text)),
            (None, None) => result.clone(),
        })
    }

    fn is_conflict(output: &Value) -> bool {
        output.get("conflict").is_some_and(|c| !matches!(c, Value::Null | Value::Bool(false)))
    }

    fn check_ok(name: &str, output: &Value) -> Result<()> {
        if output.get("ok").and_then(Value::as_bool) == Some(false) {
            let detail = output
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| trs("operation rejected", "operação recusada", "operación rechazada"));
            return Err(Error::new(ErrorKind::Rejected, format!("{name}: {detail}")));
        }
        Ok(())
    }

    /// Invokes a tool, raising on rejection (`ok:false`) and on document conflicts.
    pub async fn call(&self, name: &str, args: Value) -> Result<Value> {
        let output = self.call_raw(name, args).await?;
        if Self::is_conflict(&output) {
            return Err(Error::new(
                ErrorKind::Conflict,
                trs(
                    "The document changed during editing (conflict). Run 4w room doc, merge changes, and try again.",
                    "O documento mudou durante a edição. Rode 4w room doc, incorpore as mudanças e tente novamente.",
                    "El documento cambió durante la edición. Ejecute 4w room doc, incorpore los cambios e intente de nuevo.",
                ),
            ));
        }
        Self::check_ok(name, &output)?;
        Ok(output)
    }

    /// Like [`call`](Self::call) but a document conflict is returned as data (`conflict: true`,
    /// `current_content`, `current_updated_at`) so a UI can resolve it.
    pub async fn call_allow_conflict(&self, name: &str, args: Value) -> Result<Value> {
        let output = self.call_raw(name, args).await?;
        if !Self::is_conflict(&output) {
            Self::check_ok(name, &output)?;
        }
        Ok(output)
    }

    /// `PUT /api/upload/file` streaming upload (files above 24 MiB, up to 1 GiB).
    pub async fn upload_file_stream(
        &self,
        filename: &str,
        body: reqwest::Body,
        len: Option<u64>,
        burn: bool,
        content_type: &str,
    ) -> Result<Value> {
        let mut target = Url::parse(&self.inner.endpoint.origin().ascii_serialization()).map_err(|e| Error::other(e.to_string()))?;
        target.set_path("/api/upload/file");
        {
            let mut query = target.query_pairs_mut();
            query.append_pair("name", filename);
            if burn {
                query.append_pair("burn", "1");
            }
            if let Some(key) = &self.inner.notify_key {
                query.append_pair("notify_key", key);
            }
        }
        let mut request = self.inner.http.put(target).header("Content-Type", content_type).timeout(Duration::from_secs(600)).body(body);
        if let Some(len) = len {
            request = request.header("Content-Length", len);
        }
        if let Some(key) = &self.inner.notify_key {
            request = request.header("X-Notify-Key", key.as_str());
        }
        if let Some(bearer) = self.bearer() {
            request = request.header("Authorization", bearer);
        }
        let response = request.send().await.map_err(|e| network_error(e, "upload"))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(Error::new(
                ErrorKind::Http(status),
                trs(
                    format!("Streaming upload returned HTTP {status}."),
                    format!("Upload via streaming retornou HTTP {status}."),
                    format!("Subida por streaming devolvió HTTP {status}."),
                ),
            ));
        }
        let bytes = http::read_limited(response, MAX_RESPONSE).await?;
        let Value::Object(mut payload) = serde_json::from_slice::<Value>(&bytes)? else {
            return Err(Error::protocol(trs("Expected a JSON object.", "Esperava um objeto JSON.", "Se esperaba un objeto JSON.")));
        };
        let delete_url = payload.get("delete_url").or_else(|| payload.get("deleteUrl")).and_then(Value::as_str).map(str::to_string);
        let expires_at = match (payload.get("expires_at"), payload.get("expiresAt")) {
            (Some(Value::String(s)), _) => Some(s.clone()),
            (_, Some(Value::Number(n))) => {
                n.as_i64().and_then(chrono::DateTime::from_timestamp_millis).map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            }
            _ => None,
        };
        if let Some(d) = delete_url {
            payload.insert("delete_url".into(), Value::String(d));
        }
        if let Some(e) = expires_at {
            payload.insert("expires_at".into(), Value::String(e));
        }
        payload.insert("burn".into(), Value::Bool(burn));
        Ok(Value::Object(payload))
    }
}

fn incompatible() -> Error {
    Error::protocol(trs("Incompatible JSON-RPC response.", "Resposta JSON-RPC incompatível.", "Respuesta JSON-RPC incompatible."))
}

async fn read_sse_response(response: reqwest::Response, id: u64) -> Result<Value> {
    let mut stream = response.bytes_stream();
    let mut parser = SseParser::new();
    let mut seen = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| network_error(e, "stream"))?;
        seen += chunk.len();
        if seen > MAX_RESPONSE {
            return Err(Error::protocol(trs(
                "Response is larger than the allowed limit.",
                "A resposta excede o limite permitido.",
                "La respuesta supera el límite permitido.",
            )));
        }
        for event in parser.push(&chunk) {
            if let Some(found) = matching(&event.data, id) {
                return Ok(found);
            }
        }
    }
    if let Some(event) = parser.finish()
        && let Some(found) = matching(&event.data, id)
    {
        return Ok(found);
    }
    Err(Error::protocol(trs(
        "MCP stream ended without the expected response.",
        "Fluxo MCP terminou sem a resposta esperada.",
        "El flujo MCP terminó sin la respuesta esperada.",
    )))
}

fn matching(data: &str, id: u64) -> Option<Value> {
    if data.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(data).ok()?;
    (value.get("id").and_then(Value::as_u64) == Some(id)).then_some(value)
}
