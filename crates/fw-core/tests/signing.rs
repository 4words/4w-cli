//! Cross-implementation check: signatures produced by `scripts/sign.mjs` (TypeScript/Bun)
//! with the real release key must verify with the Rust verifier and the embedded public key.

use fw_core::signing::{RELEASE_PUBKEYS, verify_minisig};

fn repo(path: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(path)
}

#[test]
fn rust_verifies_installer_signatures_made_by_the_typescript_signer() {
    for name in ["install.sh", "install.ps1"] {
        let content = std::fs::read(repo(name)).unwrap();
        let sig = std::fs::read_to_string(repo(&format!("{name}.minisig"))).unwrap();
        verify_minisig(&content, &sig, RELEASE_PUBKEYS).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut tampered = content.clone();
        tampered.push(b'\n');
        assert!(verify_minisig(&tampered, &sig, RELEASE_PUBKEYS).is_err(), "{name}: tampering must fail");
    }
}
