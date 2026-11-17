#!/bin/sh
# Full local gate for 4w (Rust). Run from anywhere: sh test_scripts/run_all_verifications.sh
# Set WITH_RELEASE=1 to also rebuild and sign the release (needs the private key; rewrites install.sh*).
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
export FOURWORDS_NO_UPDATE_CHECK=1

printf '[1/7] Formatting and lints...\n'
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings

printf '[2/7] Rust unit, engine and render tests...\n'
cargo test --workspace --locked

printf '[3/7] Release build and self-test...\n'
cargo build --release --locked -p fw-cli
bin="$root/target/release/4w"
version=$("$bin" --version | cut -d ' ' -f 2)
[ "$("$bin" --self-test)" = "4w $version OK" ]
for lang in en ptbr es; do FOURWORDS_LANG=$lang "$bin" --help >/dev/null; done

printf '[4/7] TypeScript reference suite (executable specification)...\n'
bun test

printf '[5/7] Conformance and terminal end-to-end suites against the Rust binary...\n'
FOURWORDS_TEST_BIN="$bin" bun test

printf '[6/7] Installer syntax and signatures...\n'
sh -n install.sh
cargo test -p fw-core --test signing --locked

if [ "${WITH_RELEASE:-0}" = 1 ]; then
    printf '[7/7] Building and signing the release, installer lifecycle...\n'
    key=${FOURWORDS_SIGNING_KEY:-$HOME/.config/4words-release/minisign.key}
    FOURWORDS_SIGNING_KEY=$key bun scripts/release.mjs
    sh tests/lifecycle.sh "$root/dist/$version/4w-$(uname -m | sed 's/arm64/aarch64/')-unknown-linux-musl"
else
    printf '[7/7] Installer lifecycle...\n'
    artifact="$root/dist/$version/4w-$(uname -m | sed 's/arm64/aarch64/')-unknown-linux-musl"
    if [ -f "$artifact" ] && [ "$(uname -s)" = Linux ]; then
        sh tests/lifecycle.sh "$artifact"
    else
        printf '      skipped (no dist build for this platform; run with WITH_RELEASE=1)\n'
    fi
fi
printf 'All verifications completed with 0 errors.\n'
