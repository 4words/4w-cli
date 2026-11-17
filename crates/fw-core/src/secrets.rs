//! Secret files: keys must never need to appear in argv or environment dumps.

use crate::error::{Error, Result};
use crate::fsutil;
use crate::lang::trs;
use std::path::Path;
use zeroize::Zeroizing;

/// Reads a key file: regular file, ≤ 512 bytes, not readable by group/others (Unix), non-empty.
pub fn read_secret_file(path: &str, source: &str) -> Result<Zeroizing<String>> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|_| {
        Error::usage(trs(
            format!("{source}: cannot read {path}."),
            format!("{source}: não foi possível ler {path}."),
            format!("{source}: no se pudo leer {path}."),
        ))
    })?;
    if !meta.is_file() || meta.len() > 512 {
        return Err(Error::usage(trs(
            format!("{source} must point to a regular file of at most 512 bytes."),
            format!("{source} deve apontar para um arquivo regular de no máximo 512 bytes."),
            format!("{source} debe apuntar a un archivo regular de como máximo 512 bytes."),
        )));
    }
    if fsutil::is_group_or_world_accessible(p) {
        return Err(Error::usage(trs(
            format!("{source}: {path} is readable by other users. Run: chmod 600 {path}"),
            format!("{source}: {path} pode ser lido por outros usuários. Execute: chmod 600 {path}"),
            format!("{source}: {path} puede ser leído por otros usuarios. Ejecute: chmod 600 {path}"),
        )));
    }
    let value = Zeroizing::new(std::fs::read_to_string(p)?.trim().to_string());
    if value.is_empty() {
        return Err(Error::usage(trs(
            format!("{source}: {path} is empty."),
            format!("{source}: {path} está vazio."),
            format!("{source}: {path} está vacío."),
        )));
    }
    Ok(value)
}
