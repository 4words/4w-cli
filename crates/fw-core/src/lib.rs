//! FourWords core: everything shared by the CLI and the TUI.
pub mod config;
pub mod crypto;
pub mod error;
pub mod fetch;
pub mod fsutil;
pub mod help;
pub mod http;
pub mod lang;
pub mod mcp;
pub mod sanitize;
pub mod secrets;
pub mod signing;
pub mod sse;
pub mod url;
pub mod version;
pub mod vault;

pub use error::{Error, ErrorKind, Result};
pub use lang::Lang;

/// Version of this build (single-sourced from the workspace).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
