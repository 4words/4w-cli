#!/bin/sh
# FourWords CLI installer for Linux, macOS, and Termux. This function is parsed in full before it runs.
fourwords_install() (
    set -eu
    umask 077
    version='0.3.0'
    source_sha='e07944cf62a9dc6740a208b973a4e71b05a74664ea1210657616623cba5e4042'
    bun_version='1.4.4'
    release='https://raw.githubusercontent.com/tallesdantas/4w-cli/main'
    action=install
    local_source=''
    local_bun=''
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --uninstall) action=uninstall; shift ;;
            --source|--bun-archive)
                [ "$#" -ge 2 ] || { printf '%s requires a path.\n' "$1" >&2; exit 2; }
                if [ "$1" = --source ]; then local_source=$2; else local_bun=$2; fi
                shift 2 ;;
            --help|-h)
                printf '%s\n' 'Usage: sh install.sh [--uninstall] [--source cli.ts] [--bun-archive bun.zip]'
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
    payload="$base/4w.bin"
    link="$bin_dir/4w"
    lock="$base/.lock"
    work=''
    profile_temp=''
    new_glibc=0
    new_exe=0

    if [ "$action" = uninstall ] && [ ! -e "$base" ]; then
        say '4w is already uninstalled for this user profile.'
        exit 0
    fi
    [ ! -L "$base" ] || fail "Managed directory is a symbolic link: $base."
    mkdir -p "$base"
    mkdir "$lock" 2>/dev/null || fail "Another installation or uninstallation is already in progress ($lock)."
    cleanup() {
        status=$?
        trap - EXIT HUP INT TERM
        if [ "$new_exe" -eq 1 ] && owned_link; then
            new_exe=0
            new_glibc=0
        fi
        if [ "$new_exe" -eq 1 ]; then rm -f "$exe" "$payload" || :; fi
        if [ "$new_glibc" -eq 1 ]; then rm -f "$base/glibc" "$base/glibc-bin" || :; fi
        if [ -n "$work" ]; then rm -rf "$work" || :; fi
        if [ -n "$profile_temp" ]; then rm -f "$profile_temp" || :; fi
        rmdir "$lock" 2>/dev/null || :
        rmdir "$base" 2>/dev/null || :
        if [ "$status" -ne 0 ]; then
            printf '%s\n' '4Words: operation aborted. See the step and error above.' >&2
        fi
        exit "$status"
    }
    owned_link() { [ -L "$link" ] && [ "$(readlink "$link")" = "$exe" ]; }
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
    work=$(mktemp -d "$base/.work.XXXXXXXX")
    if [ "$action" = uninstall ]; then
        step '1/2' 'Removing 4w executable and symlink.'
        if owned_link; then rm -f "$link"; fi
        rm -f "$exe" "$payload" "$base/glibc" "$base/glibc-bin" "$base/config.json" "$base/history.json"
        step '2/2' 'Removing PATH entries added by the installer.'
        for file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.bashrc" "${ZDOTDIR:-$HOME}/.zshrc"; do
            remove_path_line "$file" "$path_line"
        done
        remove_path_line "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/4words-cli.fish" "$fish_line"
        say '4w uninstalled from this user profile.'
        exit 0
    fi

    step '1/7' 'Detecting platform and checking prerequisites.'
    os_name=$(uname -s)
    [ "$os_name" = Linux ] || [ "$os_name" = Darwin ] || fail 'Use this installer on Linux, macOS, or Termux.'
    command -v unzip >/dev/null || fail "Missing required command: unzip. See https://github.com/tallesdantas/4w-cli."
    if command -v sha256sum >/dev/null; then
        sha_cmd='sha256sum'
    elif command -v shasum >/dev/null; then
        sha_cmd='shasum -a 256'
    else
        fail "Missing required command: sha256sum. See https://github.com/tallesdantas/4w-cli."
    fi
    if [ -z "$local_source" ] || [ -z "$local_bun" ]; then
        command -v curl >/dev/null || fail 'Install curl to download release files.'
    fi
    case "$(uname -m)" in
        x86_64) arch=x64 ;;
        aarch64|arm64) arch=aarch64 ;;
        *) fail "Unsupported architecture for Bun binary: $(uname -m). Use a 64-bit x86-64 or ARM64 system." ;;
    esac
    platform=gnu
    if [ "$os_name" = Darwin ]; then
        platform=darwin
    elif [ "$termux" -eq 1 ]; then
        platform=android
    elif [ -e /etc/NIXOS ] || { [ -d /run/current-system/sw ] && [ -d /nix/store ]; }; then
        platform=nix
    elif [ -f /etc/alpine-release ] || { ls /lib/ld-musl-*.so.1 >/dev/null 2>&1 && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; }; then
        platform=musl
    fi
    case "$arch/$platform" in
        x64/darwin) asset=bun-darwin-x64; bun_sha='50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e' ;;
        aarch64/darwin) asset=bun-darwin-aarch64; bun_sha='c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510' ;;
        x64/android) asset=bun-linux-x64-android; bun_sha='c1d7819a84407701be1904d8733b9a2e009432c2b80135e11b482c217fa598a9' ;;
        aarch64/android) asset=bun-linux-aarch64-android; bun_sha='d72e42c60e895ccbc16144bb1e0e0ad7ee384841c35b5501a7ec28b4d6d759c9' ;;
        x64/musl) asset=bun-linux-x64-musl; bun_sha='a5a8ccc5e74dcb883fe974f125a7bdb3b41e5195ed1b870e73f17effd3eb2b2d' ;;
        aarch64/musl) asset=bun-linux-aarch64-musl; bun_sha='57f01b02ac7113c61c935f28f38c2eab849e3c970dab21f8b640a87b1ef65009' ;;
        x64/*) asset=bun-linux-x64; bun_sha='bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c' ;;
        aarch64/*) asset=bun-linux-aarch64; bun_sha='baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e' ;;
    esac
    say "      System: $platform · arch: $arch · 4w: $version."
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
    step '2/7' 'Fetching and verifying 4w TypeScript source.'
    if [ -n "$local_source" ]; then cp "$local_source" "$work/cli.ts"
    else download "$release/releases/$version/cli.ts" "$work/cli.ts"; fi
    verify "$source_sha" "$work/cli.ts"

    step '3/7' "Fetching Bun $bun_version ($asset) and verifying SHA-256."
    use_system_bun=0
    if [ -n "$local_bun" ]; then
        cp "$local_bun" "$work/bun.zip"
        verify "$bun_sha" "$work/bun.zip"
        unzip -p "$work/bun.zip" "$asset/bun" > "$work/bun"
        chmod 700 "$work/bun"
    elif download "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/$asset.zip?4w=1" "$work/bun.zip"; then
        verify "$bun_sha" "$work/bun.zip"
        unzip -p "$work/bun.zip" "$asset/bun" > "$work/bun"
        chmod 700 "$work/bun"
    elif command -v bun >/dev/null; then
        use_system_bun=1
        sys_bun=$(command -v bun)
        say "      GitHub CDN unavailable; using local system Bun ($("$sys_bun" --version))."
    else
        fail 'Failed to download Bun from GitHub and no local bun binary is installed.'
    fi

    if [ "$use_system_bun" -eq 0 ] && [ "$platform" = nix ]; then
        say '      NixOS: resolving dynamic loader and glibc via Nix.'
        command -v nix >/dev/null || fail 'NixOS requires the nix command.'
        nix_build() { nix --extra-experimental-features 'nix-command flakes' build "$@"; }
        rm -f "$base/glibc-bin"
        if [ ! -e "$base/glibc" ]; then
            new_glibc=1
            nix_build --out-link "$base/glibc" nixpkgs#glibc.out
        fi
        libc=$(readlink -f "$base/glibc")
        case "$arch" in x64) ld=ld-linux-x86-64.so.2 ;; aarch64) ld=ld-linux-aarch64.so.1 ;; esac
        loader="$libc/lib/$ld"
        [ -x "$loader" ] || fail 'Nix glibc dynamic loader was not found.'
    fi
    run_bun() {
        if [ "$use_system_bun" -eq 1 ]; then
            "$sys_bun" "$@"
        elif [ "$platform" = nix ]; then
            "$loader" --library-path "$libc/lib" "$work/bun" "$@"
        else
            "$work/bun" "$@"
        fi
    }
    if [ "$use_system_bun" -eq 0 ]; then
        actual=$(run_bun --version) || fail 'Bun failed to execute on this system. On Alpine, check libstdc++ and libgcc. On Termux, use internal app storage on 64-bit Android.'
        [ "$actual" = "$bun_version" ] || fail "Unexpected Bun version: $actual."
    fi

    step '4/7' 'Compiling 4w into a standalone executable.'
    if [ "$use_system_bun" -eq 0 ] && [ "$platform" = nix ]; then
        (cd "$work" && run_bun build --compile --compile-executable-path="$work/bun" ./cli.ts --outfile ./4w.bin)
        cat > "$work/4w" <<LAUNCHER
#!/bin/sh
target=\$(readlink -f "\$0") || exit 1
base=\${target%/*}
exec "\$base/glibc/lib/$ld" --library-path "\$base/glibc/lib" "\$base/4w.bin" "\$@"
LAUNCHER
        chmod 700 "$work/4w"
        ln -s "$libc" "$work/glibc"
    else
        (cd "$work" && run_bun build --compile ./cli.ts --outfile ./4w)
    fi
    step '5/7' 'Running self-test and verifying compiled version.'
    [ "$("$work/4w" --self-test)" = "4w $version OK" ] || fail 'Self-test failed. Previous installation preserved.'
    rm -f "$work/bun" "$work/bun.zip" "$work/cli.ts"

    step '6/7' 'Activating executable for current user.'
    mkdir -p "$bin_dir"
    if owned_link && [ -f "$exe" ]; then
        if [ "$use_system_bun" -eq 0 ] && [ "$platform" = nix ]; then
            [ -f "$payload" ] && [ ! -L "$payload" ] || fail 'NixOS payload missing. Run --uninstall and try again.'
            mv -f "$work/4w.bin" "$payload"
        else
            rm -f "$payload"
            mv -f "$work/4w" "$exe"
        fi
    else
        [ ! -e "$exe" ] && [ ! -e "$payload" ] && [ ! -L "$payload" ] ||
            fail "Unlinked executable found in $base. Run --uninstall and try again."
        if owned_link; then rm -f "$link"; fi
        new_exe=1
        if [ "$use_system_bun" -eq 0 ] && [ "$platform" = nix ]; then mv -f "$work/4w.bin" "$payload"; fi
        mv -f "$work/4w" "$exe"
        ln -s "$exe" "$link"
        new_exe=0
    fi
    new_glibc=0

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
    step '7/7' 'Cleaning temporary files and checking PATH.'
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
    say 'First use: 4w --help | switch language: 4w lang ptbr | online check: 4w doctor.'
    say "Uninstall: curl -fsSL $release/install.sh | sh -s -- --uninstall"
)
fourwords_install "$@"
