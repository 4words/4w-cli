//! `4w update` (implemented in M6).

use fw_core::{Error, Result};
use serde_json::Value;

pub async fn command(_rest: &[String]) -> Result<Value> {
    Err(Error::other("4w update is not available in this build yet."))
}
