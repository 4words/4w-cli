#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

printf '[1/5] Generating release bundle and syncing installers...\n'
bun scripts/release.mjs

printf '[2/5] Validating POSIX shell syntax of install.sh...\n'
sh -n install.sh

printf '[3/5] Running self-test on source and release bundle...\n'
bun src/cli.ts --self-test
version=$(bun src/cli.ts --version | cut -d ' ' -f 2)
bun "releases/$version/cli.ts" --self-test

printf '[4/5] Verifying multilingual support (default EN / PTBR / ES & 4w lang persistence)...\n'
tmp_cfg=$(mktemp)
trap 'rm -f "$tmp_cfg"' EXIT
rm -f "$tmp_cfg"
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts --help | grep -q "Open the interactive panel"
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts lang ptbr | grep -q '"lang": "ptbr"'
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts --help | grep -q "Abre o painel interativo"
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts lang es | grep -q '"lang": "es"'
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts --help | grep -q "Abre el panel interactivo"
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts lang en | grep -q '"lang": "en"'
FOURWORDS_CONFIG_FILE="$tmp_cfg" bun src/cli.ts --help | grep -q "Open the interactive panel"

printf '[5/5] Running full automated test suite (MCP + Crypto + Streaming + TUI PTY)...\n'
bun test

printf 'All verifications completed with 0 errors.\n'
