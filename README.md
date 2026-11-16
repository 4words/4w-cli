# 4w · FourWords in the Terminal

**Language:** English | [Português (Brasil)](README_PTBR.md)

Official CLI and interactive TUI client for [FourWords](https://4words.aletheia.land) — share text and files with human-readable four-word links, encrypt payloads client-side with Zero-Knowledge `AES-256-GCM`, collaborate in real-time rooms, and drive all 15 MCP tools in scripts and AI agent pipelines.

```text
4w                 open the interactive terminal panel (TUI)
4w --help          list all commands and flags
4w lang ptbr       switch and save language on this machine (en, ptbr, es)
4w doctor          verify connectivity and MCP tool discovery
```

## Installation

**Linux & macOS** · Ubuntu, Debian, Fedora, Arch, glibc distros, and macOS (`x64` or Apple Silicon `arm64`). Requires `curl`, `unzip`, and `sha256sum` (or `shasum` on macOS).

```sh
curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh
```

**Alpine Linux** · On minimal installations, install the required packages with `apk` first.

```sh
apk add --no-cache curl unzip libstdc++ libgcc && curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh
```

**NixOS** · Use the standard Linux command. If `curl` or `unzip` are not in your profile, provide them for the install session.

```sh
nix --extra-experimental-features 'nix-command flakes' shell nixpkgs#curl nixpkgs#unzip -c sh -c 'curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh'
```

**Termux (Android)** · Use 64-bit Termux and Android on internal app storage.

```sh
pkg install -y curl unzip && curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh
```

**Windows PowerShell** · Windows 10 1809 or newer on `x64` or `ARM64`. Installs into the current user profile.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/4words/4w-cli/main/install.ps1)))
```

The installer executes seven verified steps: detects the platform, downloads the versioned TypeScript bundle and the official Bun runtime (`1.4.4`), verifies the `SHA-256` checksums of both artifacts, compiles a standalone executable, runs `--self-test`, and activates the binary in your user profile. If the repository is private during testing, export `GITHUB_TOKEN` before running the installer.

## Interactive Panel (TUI)

Run `4w` or `4w tui` in an interactive terminal. The panel adapts to your terminal width and switches to a compact layout on smaller screens. `NO_COLOR=1` disables the color palette while preserving active field indicators.

> **Default Burn Policy:** Burn-after-reading (`--burn`) is **enabled (`ON`) by default** for all `text`, `file`, and `room send-file` operations. Toggle it off in the TUI with `Space` or pass `--no-burn` on the CLI if you want a link to remain readable for the full 24 hours.

| Section | Capabilities |
| --- | --- |
| **Publish** | Publish text/Markdown or files (up to 24 MiB via MCP or 1 GiB via HTTP streaming), burn-after-reading (`ON` by default), client-side Zero-Knowledge encryption (`--encrypt`), open/download 4-word links, and destroy published content with `delete_url`. |
| **Rooms** | Create or join rooms, read and send messages/files, inspect and edit shared Markdown with optimistic concurrency (`--base`), long-poll live room events (`wait`), list participants, roll nicknames, register LLM agents, and moderate with `admin_key`. |
| **Tools & MCP** | Inspect the local 24-hour credentials vault (`history`), browse the live MCP tool catalog and JSON schemas, test connection health (`doctor`), and switch/save the interface language (`en`, `ptbr`, `es`). |
| **Results** | Scroll responses, copy public links (`Y`), toggle secret visibility (`V`), open returned Markdown directly for editing (`E`), or immediately destroy published content (`D`). |

| Key | Action |
| --- | --- |
| Arrows or `j` / `k`, `Enter` | Select and open an item. |
| `L` | Cycle and save interface language on this machine (`EN` $\to$ `PTBR` $\to$ `ES`). |
| `Tab` / `Shift+Tab` | Move between form fields or focus the **Continue** button. |
| `Space` | Toggle boolean options (burn-after-reading, streaming, encryption). |
| `F2` or `Ctrl+S` | Submit form (write operations prompt for confirmation). |
| `F1` | Open command help or MCP tool input schema. |
| `?` | Open the keyboard shortcut guide from the main menu. |
| `V` | Show or hide sensitive credentials in the response viewer. |
| `Y` | Copy the public link to clipboard via OSC 52. |
| `E` | Edit the currently displayed room Markdown revision. |
| `D` | Immediately destroy the displayed item using its `delete_url`. |
| `Esc` / `Ctrl+C` | Go back, cancel an active request, or quit. |

## CLI Commands & Examples

```sh
4w --help
4w text --help
4w help room wait
4w mcp call --help

# Language Selection & Persistence (Default: en)
4w lang                  # Show current and saved language
4w lang ptbr             # Switch to Brazilian Portuguese and save on this machine
4w lang es               # Switch to Spanish and save on this machine
4w lang en               # Switch back to English and save on this machine

# Publishing, Zero-Knowledge Encryption, Download & Destruction
# Note: Burn-after-reading (--burn) is ON by default; pass --no-burn for 24h retention.
4w text "Hello, FourWords!"
4w text --file notes.md --no-burn
4w text --file secret.md --encrypt
4w file "final-report.pdf"
4w file large-backup.zip --stream --no-burn
4w get lua-gato-sol-rio-123456789 --raw
4w get "https://4words.aletheia.land/lua-gato-sol-rio-123456789#key=..." --output decrypted.md
4w delete "https://4words.aletheia.land/d/..."
4w history

# Collaborative Rooms (Humans & LLM Agents)
4w room create --doc agenda.md --message "Welcome everyone"
4w room join "$ROOM"
4w room messages "$ROOM" --since 0
4w room send "$ROOM" "Starting in five minutes."
4w room send-file "$ROOM" diagram.png --text "Current architecture"
4w room doc "$ROOM"
4w room save "$ROOM" revised.md --base 1780000000000
4w room save "$ROOM" --rollback-version 1
4w room wait "$ROOM" --since 0 --timeout 20
4w room watch "$ROOM"                       # live room panel
4w room watch "$ROOM" --key-file ~/.config/4w/llm.key --mouse
4w room watch "$ROOM" --jsonl | head        # one JSON event per line, for scripts and agents
4w room participants "$ROOM"
4w room nick "$ROOM"
4w room register-llm "$ROOM" --llm-key "$LLM_KEY" --llm-name claude
4w room moderate "$ROOM" list --admin-key "$ADMIN_KEY"

# Direct MCP Introspection & Invocation
4w mcp list
4w mcp call chat_participants - < args.json
```

### Live Room Panel (`4w room watch`)

A continuous view of one room: live messages (long-poll with cursor tracking), presence, a marker whenever the shared document changes, and a send field at the bottom. It reconnects by itself with exponential backoff (1 s up to 30 s) and only stops on Esc/Ctrl+C or when the room is permanently unavailable.

| Key | Action |
| --- | --- |
| `Enter` | Send the typed message |
| `PgUp` / `PgDn`, `↑` / `↓`, `Home` / `End` | Scroll the feed (`↓ N new` appears while scrolled up) |
| `Ctrl+D` | Toggle the shared Markdown document |
| `Ctrl+R` | Show or hide credentials (`fwllm_`, `fwadm_`, delete links are masked by default) |
| `Ctrl+Y` | Copy the room link via OSC 52 |
| `Esc` / `Ctrl+C` | Quit (Esc first leaves the document view) |

- `--key-file FILE` (or `FOURWORDS_LLM_KEY_FILE`) loads the agent key from a chmod-600 file, so it never appears in argv or environment dumps. `--from-history` reuses the key stored in the local vault.
- `--mouse` enables wheel scrolling. It is off by default because mouse reporting disables native text selection in the terminal.
- Without a TTY, or with `--jsonl`, it prints one sanitized JSON object per line (`ready`, `messages`, `participants`, `doc`, `status`, `ended`) and exits 0 on SIGINT/SIGTERM.
- Remote text is sanitized before it reaches the screen; a room message cannot inject terminal escape sequences.

**Desktop widget profile** (program + args, no shell): `program: ~/.local/bin/4w`, `args: ["room", "watch", "<ROOM>", "--key-file", "<chmod-600 file>"]`, `env: FOURWORDS_NO_UPDATE_CHECK=1`. `4w` itself performs the daily version check against `raw.githubusercontent.com` unless that variable is set.

### Environment Variables

| Variable | Description |
| --- | --- |
| `FOURWORDS_MCP_URL` | Custom MCP endpoint (HTTPS or loopback HTTP). Default: `https://4words.aletheia.land/mcp`. |
| `FOURWORDS_LANG` | Override interface language for the current process (`en`, `ptbr`, `es`). Default: saved preference or `en`. |
| `FOURWORDS_LLM_KEY` | Default `fwllm_...` key for authenticating `4w room *` commands as an LLM agent. |
| `FOURWORDS_LLM_NAME` | Short LLM agent identifier (e.g., `claude`, `gemini`, `cursor`). |
| `FOURWORDS_ADMIN_KEY` | Default `fwadm_...` key for `4w room moderate`. |
| `FOURWORDS_TOKEN` | Optional Bearer token for HTTP authorization. |
| `FOURWORDS_NO_HISTORY` | Set to `1` to disable automatic local 24-hour credential vault recording. |
| `FOURWORDS_LLM_KEY_FILE` | Path to a chmod-600 file holding the `fwllm_...` key (also `--key-file`); keeps secrets out of argv and env dumps. |
| `FOURWORDS_NO_UPDATE_CHECK` | Set to `1` to disable periodic background update checks. |

## Update or Uninstall

### In-Place Update

Run `4w update` to check for updates and update `4w` in-place:

```sh
4w update --check   # Check if a newer version is available without modifying files
4w update           # Download and apply the update
4w update --force   # Force reinstallation even if already on the latest version
```

Security model of `4w update`:

- When a TTY is attached, `4w` checks `raw.githubusercontent.com` for a newer version at most once per day (cached in `config.json`). Set `FOURWORDS_NO_UPDATE_CHECK=1` to disable the background check entirely (recommended for embedded uses such as desktop widgets).
- Updates download the installer from the immutable release tag `v<version>`, never from a branch, and verify a minisign-compatible Ed25519 signature (`install.sh.minisig`) against the public key embedded in the binary **before** writing or executing anything. A tampered or unsigned installer aborts the update.
- Humans can verify releases independently with [minisign](https://jedisct1.github.io/minisign/): `minisign -Vm install.sh -p minisign.pub`.
- The signature protects `4w update`; the very first `curl | sh` install still trusts GitHub TLS, so verify `minisign.pub` out of band if your threat model requires it.

### Uninstallation

Linux, macOS, and Termux:

```sh
curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh -s -- --uninstall
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/4words/4w-cli/main/install.ps1))) -Uninstall
```

## Development & Distribution

Requires [Bun 1.4.4](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4) or compatible.

```sh
bun src/cli.ts --help
bun test
bun scripts/release.mjs
sh -n install.sh
sh test_scripts/run_all_verifications.sh
```

Releases are always signed: create the signing key once with `bun scripts/keygen.mjs` (private key stays outside the repository), export `FOURWORDS_SIGNING_KEY` before `bun scripts/release.mjs`, then commit and push the `v<version>` tag — `4w update` fetches installers from that tag.

To install from a local checkout, run `sh install.sh --source releases/0.4.0/cli.ts`. In PowerShell, run `& .\install.ps1 -Source .\releases\0.4.0\cli.ts`.

| Environment | Runtime Strategy |
| --- | --- |
| Linux glibc | Official Bun Linux (`x64` / `aarch64`). |
| macOS (`Darwin`) | Official Bun Darwin (`x64` / Apple Silicon `aarch64`). |
| Alpine Linux | Official Bun musl + Alpine C++ runtime libraries. |
| NixOS | Official Bun Linux wrapped with the Nix store `glibc.out` dynamic loader. |
| Termux | Official Bun Android Bionic build. |
| Windows | Official Bun Windows build (`4w.exe`). |
