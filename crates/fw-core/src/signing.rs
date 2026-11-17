//! Release signature verification (minisign-compatible prehashed mode "ED":
//! Ed25519 over the BLAKE2b-512 digest). Used by `4w update`.

use crate::error::{Error, ErrorKind, Result};
use crate::lang::trs;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use blake2::{Blake2b512, Digest};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

/// Release public keys (minisign public-key blobs: "Ed" + key id + key). The first is active;
/// later entries allow rotation without breaking older clients. See `minisign.pub`.
pub const RELEASE_PUBKEYS: &[&str] = &["RWT5/nJ2+TFUYaiFXQdA0xeHp96l7dpxN4yGuxi+3c7kBbkyITuaLrYb"];

fn fail(why: &str) -> Error {
    Error::new(
        ErrorKind::Crypto,
        trs(
            format!("Installer signature verification failed ({why}). Update aborted."),
            format!("A verificação da assinatura do instalador falhou ({why}). Atualização abortada."),
            format!("La verificación de la firma del instalador falló ({why}). Actualización abortada."),
        ),
    )
}

pub fn verify_minisig(content: &[u8], sig_text: &str, pubkeys_b64: &[&str]) -> Result<()> {
    let lines: Vec<&str> = sig_text.lines().collect();
    if lines.len() < 4 || !lines[0].starts_with("untrusted comment:") || !lines[2].starts_with("trusted comment: ") {
        return Err(fail("malformed signature file"));
    }
    let sig_blob = STANDARD.decode(lines[1].trim()).map_err(|_| fail("malformed signature"))?;
    let global_sig = STANDARD.decode(lines[3].trim()).map_err(|_| fail("malformed signature"))?;
    let trusted = &lines[2]["trusted comment: ".len()..];
    if sig_blob.len() != 74 || &sig_blob[..2] != b"ED" || global_sig.len() != 64 {
        return Err(fail("unsupported signature format"));
    }
    let key_id = &sig_blob[2..10];
    let signature = Signature::from_slice(&sig_blob[10..]).map_err(|_| fail("malformed signature"))?;
    let global = Signature::from_slice(&global_sig).map_err(|_| fail("malformed signature"))?;
    let mut key = None;
    for b64 in pubkeys_b64 {
        let Ok(blob) = STANDARD.decode(b64) else { continue };
        if blob.len() == 42 && &blob[..2] == b"Ed" && &blob[2..10] == key_id {
            let bytes: [u8; 32] = blob[10..].try_into().map_err(|_| fail("bad public key"))?;
            key = VerifyingKey::from_bytes(&bytes).ok();
            break;
        }
    }
    let key = key.ok_or_else(|| fail("unknown signing key id"))?;
    let digest = Blake2b512::digest(content);
    key.verify(digest.as_slice(), &signature).map_err(|_| fail("invalid file signature"))?;
    let mut trusted_msg = sig_blob[10..].to_vec();
    trusted_msg.extend_from_slice(trusted.as_bytes());
    key.verify(&trusted_msg, &global).map_err(|_| fail("invalid trusted comment signature"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A signature produced by `scripts/sign.mjs` with the real release key over `install.sh` of 0.3.3
    /// is checked at integration level; here we verify the negative paths deterministically.
    #[test]
    fn rejects_malformed_and_unknown_signatures() {
        assert!(verify_minisig(b"x", "nope", RELEASE_PUBKEYS).is_err());
        let sig = "untrusted comment: x\nAAAA\ntrusted comment: t\nBBBB\n";
        assert!(verify_minisig(b"x", sig, RELEASE_PUBKEYS).is_err());
    }
}
