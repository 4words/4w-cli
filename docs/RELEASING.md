# Releasing 4w

The release is a signed installer plus one prebuilt binary per platform. The private signing key never
leaves the maintainer's machine (`~/.config/4words-release/minisign.key`; create it once with
`bun scripts/keygen.mjs`, back it up, commit only `minisign.pub`). The public key is compiled into the
binary (`fw-core::signing::RELEASE_PUBKEYS`), so clients can verify `4w update`.

## Steps

1. Bump the version in **three** places (they must match; `release.mjs` checks): `Cargo.toml`
   (`[workspace.package]`), `src/help.ts` (`VERSION`, used by the conformance suite) and `package.json`
   (older clients read it from `main` to discover updates).
2. `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
3. `FOURWORDS_TEST_BIN=target/release/4w bun test` against a release build.
4. Push the tag `vX.Y.Z` to start `.github/workflows/release.yml`: it builds every platform and attaches the
   binaries to a **draft** GitHub release.
5. Download the five binaries into `dist/X.Y.Z/` (`4w-x86_64-unknown-linux-musl`,
   `4w-aarch64-unknown-linux-musl`, `4w-x86_64-apple-darwin`, `4w-aarch64-apple-darwin`,
   `4w-x86_64-pc-windows-msvc.exe`). Linux binaries are also built locally by the next command.
6. `FOURWORDS_SIGNING_KEY=~/.config/4words-release/minisign.key bun scripts/release.mjs` fills
   `install.sh`/`install.ps1` with the SHA-256 of each binary and signs them (`*.minisig`).
   `FOURWORDS_ALLOW_PARTIAL=1` allows a release where some platforms have no binary yet (their installers
   refuse with a clear message).
7. `sh tests/lifecycle.sh dist/X.Y.Z/4w-x86_64-unknown-linux-musl` (installer end to end in a throwaway HOME).
8. Commit `install.sh`, `install.ps1`, their `.minisig`, `package.json`; move the tag to that commit
   (the installer is fetched from the tag) and publish the draft release with the binaries attached.

## Verifying by hand

```sh
minisign -Vm install.sh -p minisign.pub
sha256sum -c dist/X.Y.Z/SHA256SUMS
```

## Key rotation

Append the new public key to `RELEASE_PUBKEYS` (keep the old one for a release or two), ship that version,
then sign with the new key.
