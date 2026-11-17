# 4w · FourWords in the Terminal

**Language:** English | [Português (Brasil)](README_PTBR.md)

Official client for [FourWords](https://4words.aletheia.land): share text and files with four-word links, encrypt them client-side, and **run a whole collaboration room without leaving the terminal** — live chat, who is online (humans and AI agents), a shared Markdown document with an editor, history and rollback, files, and moderation. One small static binary, no runtime to install.

```text
4w                     open the home: new room, open a room, recent rooms, sharing, tools
4w room create         create a room and open its workspace
4w room open LINK      open any room (link or four-word code)
4w text "hello"        publish text and get a four-word link
4w --help              every command; 4w help room watch for details
```

## Install

Single prebuilt binary (about 4 MB), verified by SHA-256; the installer itself is signed.

**Linux, macOS, Termux** · `x64` and `arm64`. Needs `curl` and `sha256sum` (or `shasum`).

```sh
curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh
```

**Windows PowerShell** · Windows 10 1809+; `x64` (and `ARM64` through Windows' emulation).

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/4words/4w-cli/main/install.ps1)))
```

Update with `4w update` (`--check` only looks). Remove everything (executable, PATH entries, local vault and settings) with `4w uninstall --yes`, or from the home panel under **Update / Remove**; `sh install.sh --uninstall` also works.
The binaries are static (musl on Linux): they run on Alpine, NixOS and Termux unchanged.

## The room workspace

`4w room create` (or **New room** in the home) opens the full room. Open an existing one with `4w room open LINK`. It adapts to the window: three panes on wide terminals, two panes plus a people strip on medium ones, tabs on narrow ones (down to 26×8).

| You can | How |
| --- | --- |
| Chat | type, `Enter` sends, `Alt+Enter` new line, `↑` recalls sent messages, `@` completes names |
| See who is online | people pane: humans first, agents after, with live status such as `◐ bia [AI] working` |
| Read the shared document | rendered Markdown (headings, lists, tasks, tables, code), live updates with `+N −M by whom` |
| Edit the document | `F2`: full editor with soft wrap, line numbers, undo/redo, `Ctrl+T` preview, `Ctrl+S` saves safely |
| Resolve conflicts | if someone saved first: take theirs, overwrite with yours, save yours to a file, or inspect the diff |
| History and rollback | `F3`: every revision with a colored diff; `R` restores one without losing history; export a 24 h link |
| Send and get files | `F4` with path completion and progress (inline up to 24 MiB, streamed above); list and download from `Files` |
| Share | `F5`: room link, agent key and admin key (masked until you reveal them), copy with `Y` |
| Moderate | `F6` when you own the room: list, ban and unban |
| Search the chat | `/search text` or `Ctrl+P` → *Search chat* |
| Do anything else | `Ctrl+P` command palette · `F1` help · `Ctrl+L` language · `Ctrl+T` theme · mouse wheel and clicks |
| Copy the room link | click the link in the header (or `Ctrl+Y`) |
| Leave | `Esc` unselects every pane; `Esc` again asks whether to leave the room |

Slash commands in the message box: `/help /edit /history /file PATH /files /share /mod /nick /copy /search /lang /theme /reveal /quit`.

Live updates use a server stream (SSE) with automatic fallback to long-polling and exponential reconnection; the header shows `● live`, `reconnecting in 4s` or `room unavailable`. Rooms live 24 hours.

Owner mode: rooms you create keep their admin key in the local vault (24 h), so moderation is enabled automatically. For other rooms pass `--admin-key-file FILE`.

Options of `room watch` / `room open`: `--nick`, `--llm-key | --key-file | --from-history`, `--llm-name`, `--admin-key-file`, `--since N`, `--transport auto|sse|poll`, `--no-mouse`, `--jsonl`. Colors follow your terminal; `NO_COLOR=1`, `FOURWORDS_THEME=light|contrast|mono` and `FOURWORDS_ASCII=1` (no Unicode symbols) are supported. Set `FOURWORDS_BELL=1` to beep on mentions.

## Scripts and agents

Every command prints JSON on stdout and errors on stderr (exit code 1). Without a terminal, `room create` and `room watch` do the same:

```sh
4w text "Hello" --no-burn                     # burn-after-reading is ON by default
4w text --file notes.md --encrypt             # AES-256-GCM, key only in the #key= fragment
4w file report.pdf --stream                   # up to 1 GiB
4w get lua-gato-sol-rio-123456789 --raw
4w delete https://4words.aletheia.land/d/...  # secret delete_url
4w history                                    # local 24 h vault (--clear)

4w room create --json --doc agenda.md --message "Welcome"
4w room join|messages|send|send-file|doc|save|wait|participants|nick|register-llm|moderate ROOM ...
4w room watch ROOM --jsonl                    # one JSON event per line (messages, participants, doc, status)
4w mcp list ; 4w mcp call TOOL '{"k":"v"}'    # all 15 MCP tools
4w doctor                                     # connectivity and tool discovery
```

`ROOM` accepts a room URL or its four-word combo. Keep keys out of argv and the environment with `--key-file FILE` / `--admin-key-file FILE` (the file must be `chmod 600`).

### Environment

| Variable | Purpose |
| --- | --- |
| `FOURWORDS_MCP_URL` | MCP endpoint (HTTPS, or HTTP on loopback). Default `https://4words.aletheia.land/mcp` |
| `FOURWORDS_LANG` | `en`, `ptbr` or `es` for this process; `4w lang ptbr` saves it |
| `FOURWORDS_LLM_KEY` / `_FILE` / `FOURWORDS_LLM_NAME` | agent identity for `4w room *` |
| `FOURWORDS_ADMIN_KEY` | owner key for `room moderate` / the workspace |
| `FOURWORDS_NOTIFY_KEY`, `--notify MD5` | Web Push `notify_key` forwarded to the service |
| `FOURWORDS_TOKEN` | optional Bearer token |
| `FOURWORDS_NO_HISTORY=1` | do not record the local vault |
| `FOURWORDS_NO_UPDATE_CHECK=1` | disable the once-a-day version check (queries `raw.githubusercontent.com` on a terminal) |
| `FOURWORDS_OSC52=1` | allow copying through the terminal (OSC 52) when no clipboard tool exists |

## Security

- **Remote text is untrusted.** Names, messages and documents are sanitized when they arrive: terminal escape sequences and bidirectional overrides become `�`, so nobody can inject commands into your terminal. `4w get --raw` does the same on a terminal.
- **Secrets are masked** on screen (`fwadm_…`, `fwllm_…`, delete links) until you ask to reveal them.
- **Network:** HTTPS or loopback only, no credentials in URLs, redirects refused, response sizes capped, certificate roots bundled in the binary.
- **Files:** `history.json` and `config.json` are `0600` in a `0700` directory; key files are refused if other users can read them.
- **Clipboard:** a native tool first (`wl-copy`, `xclip`, `xsel`, `pbcopy`, `clip.exe`, `termux-clipboard-set`); OSC 52 only on request or over SSH.
- **Updates are verified:** `4w update` downloads the installer of the release tag and checks its Ed25519 signature against the key built into the binary (`minisign.pub`, verify by hand with `minisign -Vm install.sh -p minisign.pub`) before running anything. The first `curl | sh` install still trusts GitHub's TLS.

## Develop

Rust 1.99 (`rust-toolchain.toml`), crates in `crates/`: `fw-core` (MCP client, crypto, sanitization), `fw-room` (sync engine), `fw-tui` (Ratatui screens) and `fw-cli` (the `4w` binary).

```sh
cargo test --workspace            # unit, engine and render tests
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release -p fw-cli
FOURWORDS_TEST_BIN=target/release/4w bun test   # conformance + terminal end-to-end suites
```

Releases: see [docs/RELEASING.md](docs/RELEASING.md). Design decisions: [docs/ADR-0001-rust-rewrite.md](docs/ADR-0001-rust-rewrite.md).

The TypeScript implementation that preceded 1.0 stays in `src/` for one more release as the executable reference for the conformance suite (`bun test` runs it); it is no longer distributed.
