//! One HTTP client for the whole program: rustls with the `ring` provider and the
//! Mozilla root set compiled in (no dependency on the OS certificate store, which
//! keeps static musl, Alpine and Termux builds portable). Redirects are refused.

use crate::error::{Error, ErrorKind, Result};
use crate::lang::trs;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

fn tls_config() -> rustls::ClientConfig {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("ring provider supports the default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth()
}

fn build(builder: reqwest::ClientBuilder) -> reqwest::Client {
    builder
        .use_preconfigured_tls(tls_config())
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("4w/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .expect("static HTTP client configuration is valid")
}

/// Shared client for request/response calls (per-request timeouts are set by callers).
pub fn client() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| build(reqwest::Client::builder())).clone()
}

/// Maps a transport failure to a localized message; never includes the URL's query/secrets.
pub fn network_error(error: reqwest::Error, context: &str) -> Error {
    let reason = if error.is_timeout() {
        trs("timed out", "tempo esgotado", "tiempo agotado")
    } else if error.is_connect() {
        trs("could not connect", "não foi possível conectar", "no se pudo conectar")
    } else if error.is_redirect() {
        trs("redirects are not allowed", "redirecionamentos não são permitidos", "no se permiten redirecciones")
    } else {
        trs("network error", "erro de rede", "error de red")
    };
    Error::new(ErrorKind::Network, format!("{context}: {reason}."))
}

pub fn http_error(status: u16, context: &str) -> Error {
    Error::new(
        ErrorKind::Http(status),
        trs(
            format!("MCP returned HTTP {status} on {context}."),
            format!("MCP retornou HTTP {status} em {context}."),
            format!("MCP devolvió HTTP {status} en {context}."),
        ),
    )
}

/// Reads a response body into memory, refusing anything above `limit` bytes.
pub async fn read_limited(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut out = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| network_error(e, "body"))?;
        if out.len() + chunk.len() > limit {
            return Err(Error::protocol(trs(
                "Response is larger than the allowed limit.",
                "A resposta excede o limite permitido.",
                "La respuesta supera el límite permitido.",
            )));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}
