//! One error type for the whole workspace: a user-facing (already localized)
//! message plus a machine-readable kind so callers can react (e.g. the room
//! engine distinguishes a permanent HTTP 4xx from a transient failure).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErrorKind {
    /// Server answered with this HTTP status.
    Http(u16),
    /// Connection, TLS, timeout or aborted request.
    Network,
    /// Malformed or unexpected protocol payload.
    Protocol,
    /// The tool/endpoint refused the operation (`isError`, `ok:false`).
    Rejected,
    /// Optimistic-concurrency conflict on the shared document.
    Conflict,
    /// Bad command line or input.
    Usage,
    /// Local filesystem problem.
    Io,
    /// Cryptographic failure (bad key, tampering, signature).
    Crypto,
    Other,
}

#[derive(Debug, Clone)]
pub struct Error {
    pub kind: ErrorKind,
    pub message: String,
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
    pub fn usage(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Usage, message)
    }
    pub fn other(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Other, message)
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Io, message)
    }
    pub fn protocol(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Protocol, message)
    }
    /// True when retrying later cannot help (the room is gone, banned, bad URL...).
    pub fn is_permanent_client_error(&self) -> bool {
        matches!(self.kind, ErrorKind::Http(status) if (400..500).contains(&status) && status != 408 && status != 429)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::io(error.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::protocol(error.to_string())
    }
}
