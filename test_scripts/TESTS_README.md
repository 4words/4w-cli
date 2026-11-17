# Verification suite

`sh test_scripts/run_all_verifications.sh` runs everything below (set `WITH_RELEASE=1` to also build and
sign the release). The TypeScript suite is the executable specification of the CLI: the same tests run
against the Rust binary through `FOURWORDS_TEST_BIN`.

## Rust (`cargo test --workspace`)

| Crate / file | Scope |
| :--- | :--- |
| `fw-core` unit tests | sanitization (terminal-injection, secret masking), URL rules and four-word links, SSE parser, AES-256-GCM (`4WENC1` text/binary, tampering), vault format, help in three languages, version comparison |
| `fw-core/tests/signing.rs` | minisign signatures made by `scripts/sign.mjs` verify with the Rust verifier and embedded key; tampering fails |
| `fw-room` unit tests | typed model ingestion, state reducer (dedupe, order, mentions, presence diff, doc history) |
| `fw-room/tests/engine.rs` | the sync engine against a loopback MCP+SSE server: backlog is not lost when `join` reports `last_seq`, live messages/doc patches/presence, automatic fallback to long-polling, persistent 4xx ends the session |
| `fw-tui` unit tests | Markdown renderer, wrapping/clipping, diff, safe file names, path completion |
| `fw-tui/tests/render.rs` | `TestBackend` smoke test over 12 sizes × 3 languages × 4 themes × Unicode/ASCII × every modal (no panics), three-pane/people-strip/tabs layouts, secrets masked, no control characters in cells |

## Bun (`bun test`, `FOURWORDS_TEST_BIN=target/release/4w bun test`)

| File | Scope |
| :--- | :--- |
| `tests/mcp.test.ts` | the MCP client (`2025-03-26` stateful and `2026-07-28` stateless, SSE, pagination), `--burn` default, AES-256-GCM, `get`, streaming upload, vault, key files, `--notify`, all 15 tools |
| `tests/update.test.ts` | semver, `4w update` (`--check`, `--force`), installer download from the tag with mandatory signature verification (tampered, unsigned and unknown-key installers abort), URL validation |
| `tests/tui.test.ts` | help tree, languages and persistence (`4w lang`), terminal sanitization; the TS menu PTY test runs only against the TS implementation |
| `tests/watch.test.ts` | `room watch --jsonl`: cursors, re-poll, backoff, dedupe, key/nick forwarding, argument validation |
| `tests/room-tui.test.ts` | the Rust workspace and home in a real pseudoterminal (Bun native PTY + `tests/vt.ts` emulator): render, send, @mention completion, history/rollback, editor save, conflict resolution, remote-edit banner, search, owner moderation, file send, share, layouts, i18n/ASCII, reconnection, quit and terminal restoration |
| `tests/lifecycle.sh` | the signed installer end to end in a throwaway `HOME` (pipe install, idempotent update, tampered binary refused, lock, Bun-era migration, uninstall, foreign program safety) |
| `tests/windows-lifecycle.ps1` | the same lifecycle for `install.ps1` on Windows (run by CI/maintainer on Windows) |

Tests never touch the real user files: they set `FOURWORDS_CONFIG_FILE` / `FOURWORDS_HISTORY_FILE` or run the
renderer with `persist_settings: false`.
