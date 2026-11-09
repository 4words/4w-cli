#!/bin/sh
# Usage: sh tests/lifecycle.sh /absolute/path/to/official-bun-archive.zip
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
archive=${1:?Provide the official Bun ZIP archive for the target platform.}
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
export HOME="$temp/profile with spaces" SHELL=/bin/bash
mkdir -p "$HOME"
printf '%s\n' '# original profile' > "$HOME/.bashrc"
installer="$root/install.sh"
version=$(sed -n "s/^[[:space:]]*version='\([^']*\)'$/\1/p" "$installer")
src="$root/releases/$version/cli.ts"
exe="$HOME/.local/bin/4w"
base="$HOME/.local/share/4words-cli"
install() { sh "$installer" --source "$src" --bun-archive "$archive"; }

# Exercise the same streaming shell entry point documented for HTTPS.
cat "$installer" | sh -s -- --source "$src" --bun-archive "$archive"
[ "$("$exe" --self-test)" = "4w $("$exe" --version | cut -d ' ' -f 2) OK" ]
[ -z "$(find "$base" -maxdepth 1 -name '.work.*' -print)" ]
install
[ "$(grep -c '4Words CLI PATH' "$HOME/.bashrc")" -eq 1 ]
before=$(sha256sum "$exe")
printf '%s\n' 'unauthorized change' > "$temp/invalid.ts"
if sh "$installer" --source "$temp/invalid.ts" --bun-archive "$archive" > "$temp/log" 2>&1; then
    echo 'Installer accepted tampered source.' >&2; exit 1
fi
grep -q 'SHA-256 mismatch' "$temp/log"
printf 'not a zip\n' > "$temp/invalid.zip"
if sh "$installer" --source "$src" --bun-archive "$temp/invalid.zip" > "$temp/log" 2>&1; then
    echo 'Installer accepted tampered Bun archive.' >&2; exit 1
fi
grep -q 'SHA-256 mismatch' "$temp/log"
[ "$before" = "$(sha256sum "$exe")" ]
mkdir "$base/.lock"
if install > "$temp/log" 2>&1; then
    echo 'Installer ignored active lock.' >&2; exit 1
fi
grep -q 'Another installation' "$temp/log"
rmdir "$base/.lock"
sh "$installer" --uninstall
sh "$installer" --uninstall
[ ! -e "$exe" ] && [ ! -L "$exe" ] && [ ! -e "$base" ]
[ "$(cat "$HOME/.bashrc")" = '# original profile' ]
printf 'another program\n' > "$exe"
if install > "$temp/log" 2>&1; then
    echo 'Installer overwrote a foreign program.' >&2; exit 1
fi
[ "$(cat "$exe")" = 'another program' ]
printf 'Installation, update, integrity, and uninstallation lifecycle OK.\n'
