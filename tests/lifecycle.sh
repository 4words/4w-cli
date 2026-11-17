#!/bin/sh
# Usage: sh tests/lifecycle.sh /absolute/path/to/the/release/4w-binary-for-this-platform
# Exercises the signed installer end to end in a throwaway HOME: stream install, idempotent update,
# tampered binary rejected, lock respected, legacy (Bun era) files migrated, uninstall, foreign program safety.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
binary=${1:?Provide the compiled 4w binary that install.sh expects for this platform.}
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
export HOME="$temp/profile with spaces" SHELL=/bin/bash
mkdir -p "$HOME"
printf '%s\n' '# original profile' > "$HOME/.bashrc"
installer="$root/install.sh"
version=$(sed -n "s/^[[:space:]]*version='\([^']*\)'$/\1/p" "$installer")
exe="$HOME/.local/bin/4w"
base="$HOME/.local/share/4words-cli"
install() { sh "$installer" --source "$binary"; }

# The documented entry point streams the script through sh.
cat "$installer" | sh -s -- --source "$binary"
[ "$("$exe" --self-test)" = "4w $version OK" ]
[ "$("$exe" --version)" = "4w $version" ]
[ -z "$(find "$base" -maxdepth 1 -name '.work.*' -print)" ]

# Idempotent update: PATH registered once, same executable linked.
install
[ "$(grep -c '4Words CLI PATH' "$HOME/.bashrc")" -eq 1 ]
before=$(sha256sum "$exe")

# Integrity: a modified binary must be refused and the installed one preserved.
cp "$binary" "$temp/tampered"
printf 'x' >> "$temp/tampered"
if sh "$installer" --source "$temp/tampered" > "$temp/log" 2>&1; then
    echo 'Installer accepted a tampered binary.' >&2; exit 1
fi
grep -q 'SHA-256 mismatch' "$temp/log"
[ "$before" = "$(sha256sum "$exe")" ]

# An active lock blocks a second installation.
mkdir "$base/.lock"
if install > "$temp/log" 2>&1; then
    echo 'Installer ignored active lock.' >&2; exit 1
fi
grep -q 'Another installation' "$temp/log"
rmdir "$base/.lock"

# Files from the TypeScript/Bun generation are cleaned on update.
mkdir -p "$base/glibc"
printf 'old payload\n' > "$base/4w.bin"
install
[ ! -e "$base/4w.bin" ] && [ ! -e "$base/glibc" ]

# Uninstall is complete and repeatable, and leaves the user's profile as it was.
sh "$installer" --uninstall
sh "$installer" --uninstall
[ ! -e "$exe" ] && [ ! -L "$exe" ] && [ ! -e "$base" ]
[ "$(cat "$HOME/.bashrc")" = '# original profile' ]

# Never replace a foreign program.
mkdir -p "$HOME/.local/bin"
printf 'another program\n' > "$exe"
if install > "$temp/log" 2>&1; then
    echo 'Installer overwrote a foreign program.' >&2; exit 1
fi
[ "$(cat "$exe")" = 'another program' ]
printf 'Installation, update, integrity, and uninstallation lifecycle OK.\n'
