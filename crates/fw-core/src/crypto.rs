//! Zero-knowledge sharing: AES-256-GCM with a random key and IV per upload, byte-compatible
//! with the TypeScript CLI and the web page (`4WENC1:` text, `4WENC1\0` binary, key in `#key=`).

use crate::error::{Error, ErrorKind, Result};
use crate::lang::trs;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::Value;

pub const ENC_TEXT_PREFIX: &str = "4WENC1:";
pub const ENC_BIN_MAGIC: &[u8] = b"4WENC1\0";

pub struct Encrypted {
    pub iv: [u8; 12],
    pub ciphertext: Vec<u8>,
    pub key_b64url: String,
}

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("operating system random source is available");
    bytes
}

pub fn encrypt(plain: &[u8]) -> Result<Encrypted> {
    let key = random::<32>();
    let iv = random::<12>();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| Error::new(ErrorKind::Crypto, e.to_string()))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&iv), plain)
        .map_err(|_| Error::new(ErrorKind::Crypto, "encryption failed"))?;
    Ok(Encrypted { iv, ciphertext, key_b64url: URL_SAFE_NO_PAD.encode(key) })
}

fn b64url_decode(text: &str) -> std::result::Result<Vec<u8>, base64::DecodeError> {
    URL_SAFE_NO_PAD.decode(text.trim_end_matches('='))
}

pub fn decrypt(iv: &[u8], ciphertext: &[u8], key_b64url: &str) -> Result<Vec<u8>> {
    let invalid = || {
        Error::new(
            ErrorKind::Crypto,
            trs(
                "Invalid key or initialization vector for AES-256-GCM decryption.",
                "Chave ou vetor de inicialização inválido para descriptografia AES-256-GCM.",
                "Clave o vector de inicialización inválido para descifrado AES-256-GCM.",
            ),
        )
    };
    let key = b64url_decode(key_b64url).map_err(|_| invalid())?;
    if key.len() != 32 || iv.len() != 12 {
        return Err(invalid());
    }
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| invalid())?;
    cipher.decrypt(Nonce::from_slice(iv), ciphertext).map_err(|_| {
        Error::new(
            ErrorKind::Crypto,
            trs(
                "Decryption failed: wrong key or tampered ciphertext.",
                "Falha ao descriptografar: chave incorreta ou conteúdo adulterado.",
                "Error al descifrar: clave incorrecta o contenido alterado.",
            ),
        )
    })
}

/// `4WENC1:<iv>:<ciphertext>` (both base64url) plus the key to put in the link fragment.
pub fn encrypt_text(content: &str) -> Result<(String, String)> {
    let enc = encrypt(content.as_bytes())?;
    let payload = format!("{ENC_TEXT_PREFIX}{}:{}", URL_SAFE_NO_PAD.encode(enc.iv), URL_SAFE_NO_PAD.encode(&enc.ciphertext));
    Ok((payload, enc.key_b64url))
}

/// `4WENC1\0 || iv || ciphertext` plus the key.
pub fn encrypt_file(bytes: &[u8]) -> Result<(Vec<u8>, String)> {
    let enc = encrypt(bytes)?;
    let mut payload = Vec::with_capacity(ENC_BIN_MAGIC.len() + 12 + enc.ciphertext.len());
    payload.extend_from_slice(ENC_BIN_MAGIC);
    payload.extend_from_slice(&enc.iv);
    payload.extend_from_slice(&enc.ciphertext);
    Ok((payload, enc.key_b64url))
}

pub fn has_binary_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(ENC_BIN_MAGIC)
}

/// Decrypts a `4WENC1:` text payload.
pub fn decrypt_text(payload: &str, key_b64url: &str) -> Result<Vec<u8>> {
    let rest = payload.strip_prefix(ENC_TEXT_PREFIX).unwrap_or(payload);
    let parts: Vec<&str> = rest.split(':').collect();
    if parts.len() != 2 {
        return Err(Error::new(
            ErrorKind::Crypto,
            trs("Invalid encrypted text format.", "Formato de texto criptografado inválido.", "Formato de texto cifrado inválido."),
        ));
    }
    let bad = |_| Error::new(ErrorKind::Crypto, trs("Invalid encrypted text format.", "Formato de texto criptografado inválido.", "Formato de texto cifrado inválido."));
    let iv = b64url_decode(parts[0]).map_err(bad)?;
    let ct = b64url_decode(parts[1]).map_err(bad)?;
    decrypt(&iv, &ct, key_b64url)
}

/// Decrypts a binary `4WENC1\0` payload.
pub fn decrypt_file(bytes: &[u8], key_b64url: &str) -> Result<Vec<u8>> {
    let start = ENC_BIN_MAGIC.len();
    if bytes.len() < start + 12 {
        return Err(Error::new(ErrorKind::Crypto, "invalid encrypted file"));
    }
    decrypt(&bytes[start..start + 12], &bytes[start + 12..], key_b64url)
}

/// Adds `encrypted: true` and `#key=` to `url`/`fourwords_url` of an upload result.
pub fn attach_key_fragment(mut output: Value, key_b64url: &str) -> Value {
    if let Value::Object(map) = &mut output {
        map.insert("encrypted".into(), Value::Bool(true));
        for field in ["url", "fourwords_url"] {
            if let Some(Value::String(link)) = map.get(field) {
                let base = link.split('#').next().unwrap_or(link);
                let with_key = format!("{base}#key={key_b64url}");
                map.insert(field.into(), Value::String(with_key));
            }
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_text_and_file_and_rejects_tampering() {
        let (payload, key) = encrypt_text("olá 🌊").unwrap();
        assert!(payload.starts_with("4WENC1:"));
        assert_eq!(decrypt_text(&payload, &key).unwrap(), "olá 🌊".as_bytes());
        assert!(decrypt_text(&payload, &encrypt(b"x").unwrap().key_b64url).is_err());
        let (blob, key) = encrypt_file(&[0, 1, 2, 255]).unwrap();
        assert!(has_binary_magic(&blob));
        assert_eq!(decrypt_file(&blob, &key).unwrap(), vec![0, 1, 2, 255]);
        let mut bad = blob.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(decrypt_file(&bad, &key).is_err());
    }

    #[test]
    fn fragment_is_attached_once() {
        let out = attach_key_fragment(serde_json::json!({"url": "https://h/a#old", "fourwords_url": "https://h/b"}), "K");
        assert_eq!(out["url"], "https://h/a#key=K");
        assert_eq!(out["fourwords_url"], "https://h/b#key=K");
        assert_eq!(out["encrypted"], true);
    }
}
