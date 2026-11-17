#!/bin/sh
# FourWords CLI installer for Linux, macOS and Termux. This function is parsed in full before it runs.
# The release installer is signed (install.sh.minisig); it embeds the SHA-256 of every binary it can install.
fourwords_install() (
    set -eu
    umask 077
    version='1.0.0'
    release='https://github.com/4words/4w-cli/releases/download/v1.0.0'
    raw='https://raw.githubusercontent.com/4words/4w-cli/v1.0.0'
    sha_linux_x64='960a8d48b27d61c02318f6ccb3d7333740ae77b69e924e4e9a2b05a47ca02bae'
    sha_linux_arm64='35e8ae3208c98d406b842c520cba6fd33a3599887312235ab32bad2e0d465732'
    sha_darwin_x64='0000000000000000000000000000000000000000000000000000000000000000'
    sha_darwin_arm64='0000000000000000000000000000000000000000000000000000000000000000'
    action=install
    local_source=''
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --uninstall) action=uninstall; shift ;;
            --source)
                [ "$#" -ge 2 ] || { printf '%s requires a path.\n' "$1" >&2; exit 2; }
                local_source=$2
                shift 2 ;;
            --help|-h)
                printf '%s\n' 'Usage: sh install.sh [--uninstall] [--source PATH_TO_4W_BINARY]'
                exit 0 ;;
            *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
        esac
    done

    say() { printf '%s\n' "$*"; }
    fail() { printf '4Words: %s\n' "$*" >&2; exit 1; }
    step() { say "[$1] $2"; }
    [ -n "${HOME:-}" ] && [ "${HOME#/}" != "$HOME" ] || fail 'HOME must be an absolute path.'
    shell_kind=${SHELL:-sh}
    shell_kind=${shell_kind##*/}
    termux=0
    case "${PREFIX:-}" in
        /data/data/*/files/usr|/data/user/*/*/files/usr) termux=1 ;;
    esac
    bin_dir="$HOME/.local/bin"
    if [ "$termux" -eq 1 ]; then bin_dir="$PREFIX/bin"; fi
    base="$HOME/.local/share/4words-cli"
    exe="$base/4w"
    link="$bin_dir/4w"
    lock="$base/.lock"
    work=''
    profile_temp=''
    new_exe=0

    if [ "$action" = uninstall ] && [ ! -e "$base" ]; then
        say '4w is already uninstalled for this user profile.'
        exit 0
    fi
    [ ! -L "$base" ] || fail "Managed directory is a symbolic link: $base."
    mkdir -p "$base"
    mkdir "$lock" 2>/dev/null || fail "Another installation or uninstallation is already in progress ($lock)."
    owned_link() { [ -L "$link" ] && [ "$(readlink "$link")" = "$exe" ]; }
    cleanup() {
        status=$?
        trap - EXIT HUP INT TERM
        if [ "$new_exe" -eq 1 ] && owned_link; then new_exe=0; fi
        if [ "$new_exe" -eq 1 ]; then rm -f "$exe" || :; fi
        if [ -n "$work" ]; then rm -rf "$work" || :; fi
        if [ -n "$profile_temp" ]; then rm -f "$profile_temp" || :; fi
        rmdir "$lock" 2>/dev/null || :
        rmdir "$base" 2>/dev/null || :
        if [ "$status" -ne 0 ]; then
            printf '%s\n' '4Words: operation aborted. See the step and error above.' >&2
        fi
        exit "$status"
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP

    path_line='export PATH="$HOME/.local/bin:$PATH" # 4Words CLI PATH'
    fish_line='fish_add_path --path "$HOME/.local/bin" # 4Words CLI PATH'
    remove_path_line() {
        file=$1
        line=$2
        [ ! -L "$file" ] && [ -f "$file" ] && [ -w "$file" ] || return 0
        if grep -Fxq "$line" "$file"; then
            profile_temp=$(mktemp "$file.4w.XXXXXXXX")
            cp -p "$file" "$profile_temp"
            awk -v owned="$line" '$0 != owned { print }' "$file" > "$profile_temp"
            mv -f "$profile_temp" "$file"
            profile_temp=''
        fi
    }
    # Files left by the TypeScript/Bun generation of 4w (payload next to the launcher, NixOS glibc links).
    remove_legacy() { rm -rf "$base/4w.bin" "$base/glibc" "$base/glibc-bin" 2>/dev/null || :; }
    work=$(mktemp -d "$base/.work.XXXXXXXX")
    if [ "$action" = uninstall ]; then
        step '1/2' 'Removing 4w executable and symlink.'
        if owned_link; then rm -f "$link"; fi
        rm -f "$exe" "$base/config.json" "$base/history.json"
        remove_legacy
        step '2/2' 'Removing PATH entries added by the installer.'
        for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.bashrc" "${ZDOTDIR:-$HOME}/.zshrc"; do
            remove_path_line "$file" "$path_line"
        done
        remove_path_line "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/4words-cli.fish" "$fish_line"
        say '4w uninstalled from this user profile.'
        exit 0
    fi

    step '1/5' 'Detecting platform and checking prerequisites.'
    os_name=$(uname -s)
    [ "$os_name" = Linux ] || [ "$os_name" = Darwin ] || fail 'Use this installer on Linux, macOS, or Termux.'
    if command -v sha256sum >/dev/null; then
        sha_cmd='sha256sum'
    elif command -v shasum >/dev/null; then
        sha_cmd='shasum -a 256'
    else
        fail "Missing required command: sha256sum. See https://github.com/4words/4w-cli."
    fi
    if [ -z "$local_source" ]; then
        command -v curl >/dev/null || fail 'Install curl to download release files.'
    fi
    case "$(uname -m)" in
        x86_64|amd64) arch=x64 ;;
        aarch64|arm64) arch=arm64 ;;
        *) fail "Unsupported architecture: $(uname -m). Use a 64-bit x86-64 or ARM64 system." ;;
    esac
    case "$os_name/$arch" in
        Linux/x64) target=x86_64-unknown-linux-musl; expected=$sha_linux_x64 ;;
        Linux/arm64) target=aarch64-unknown-linux-musl; expected=$sha_linux_arm64 ;;
        Darwin/x64) target=x86_64-apple-darwin; expected=$sha_darwin_x64 ;;
        Darwin/arm64) target=aarch64-apple-darwin; expected=$sha_darwin_arm64 ;;
    esac
    say "      System: $os_name · arch: $arch · target: $target · 4w: $version."
    [ "$expected" != 0000000000000000000000000000000000000000000000000000000000000000 ] ||
        fail "No prebuilt binary for $target in v$version yet. See https://github.com/4words/4w-cli/releases."
    if [ -e "$link" ] || [ -L "$link" ]; then
        owned_link || fail "Another command already exists at this path: $link."
    fi
    [ ! -L "$exe" ] || fail "Managed executable is a symbolic link: $exe."
    [ ! -e "$exe" ] || [ -f "$exe" ] || fail "Executable path is not a regular file: $exe."

    download() {
        if [ -n "${GITHUB_TOKEN:-}" ] && [ "${1#https://raw.githubusercontent.com/}" != "$1" ]; then
            curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 15 \
                --max-time 300 --retry 2 -H "Authorization: Bearer $GITHUB_TOKEN" --output "$2" "$1"
        else
            curl -fLsS --proto '=https' --proto-redir '=https' --connect-timeout 15 \
                --max-time 300 --retry 2 --output "$2" "$1"
        fi
    }
    verify() {
        checksum=$($sha_cmd < "$2")
        [ "${checksum%% *}" = "$1" ] || fail "SHA-256 mismatch: ${2##*/}."
        say "      SHA-256 OK: ${2##*/}."
    }
    step '2/5' "Fetching the 4w binary for $target and verifying SHA-256."
    if [ -n "$local_source" ]; then cp "$local_source" "$work/4w"
    else download "$release/4w-$target" "$work/4w"; fi
    verify "$expected" "$work/4w"
    chmod 700 "$work/4w"

    step '3/5' 'Running self-test and verifying the version.'
    [ "$("$work/4w" --self-test)" = "4w $version OK" ] || fail 'Self-test failed. Previous installation preserved.'

    step '4/5' 'Activating executable for current user.'
    mkdir -p "$bin_dir"
    if owned_link && [ -f "$exe" ]; then
        mv -f "$work/4w" "$exe"
    else
        [ ! -e "$exe" ] || fail "Unlinked executable found in $base. Run --uninstall and try again."
        if owned_link; then rm -f "$link"; fi
        new_exe=1
        mv -f "$work/4w" "$exe"
        ln -s "$exe" "$link"
        new_exe=0
    fi
    remove_legacy

    add_path_line() {
        file=$1
        line=$2
        [ ! -L "$file" ] || return 1
        [ ! -e "$file" ] || { [ -f "$file" ] && [ -w "$file" ]; } || return 1
        if [ ! -f "$file" ] || ! grep -Fxq "$line" "$file"; then
            if [ -s "$file" ]; then
                last=$(tail -c 1 "$file")
                if [ -n "$last" ]; then printf '\n' >> "$file" || return 1; fi
            fi
            printf '%s\n' "$line" >> "$file" || return 1
        fi
    }
    step '5/5' 'Cleaning temporary files and checking PATH.'
    case ":${PATH:-}:" in
        *":$bin_dir:"*) ;;
        *)
            if [ "$termux" -eq 1 ]; then
                say '      For this session: export PATH="$PREFIX/bin:$PATH"'
            else
                case "$shell_kind" in
                    bash)
                        profile="$HOME/.profile"
                        if [ -e "$HOME/.bash_profile" ]; then profile="$HOME/.bash_profile"
                        elif [ -e "$HOME/.bash_login" ]; then profile="$HOME/.bash_login"; fi
                        add_path_line "$profile" "$path_line" || say "      PATH: could not edit $profile."
                        add_path_line "$HOME/.bashrc" "$path_line" || say '      PATH: could not edit ~/.bashrc.' ;;
                    zsh)
                        profile="${ZDOTDIR:-$HOME}/.zshrc"
                        add_path_line "$profile" "$path_line" || say "      PATH: could not edit $profile." ;;
                    fish)
                        config="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d"
                        if ! mkdir -p "$config" || ! add_path_line "$config/4words-cli.fish" "$fish_line"; then
                            say '      PATH: could not register fish config file.'
                        fi ;;
                    *) add_path_line "$HOME/.profile" "$path_line" || say '      PATH: could not edit ~/.profile.' ;;
                esac
                if [ "$shell_kind" = fish ]; then
                    say '      For this session: fish_add_path --path "$HOME/.local/bin"'
                else
                    say '      For this session: export PATH="$HOME/.local/bin:$PATH"'
                fi
            fi ;;
    esac
    say "4w $version installed at $link."
    say 'First use: 4w (opens the panel) | 4w --help | switch language: 4w lang ptbr.'
    say "Uninstall: curl -fsSL $raw/install.sh | sh -s -- --uninstall"
)
fourwords_install "$@"
