# Verification Suite Documentation (`test_scripts/`)

This document describes the verification scripts and test suites of the `4w-cli` project, their responsibilities, execution instructions, and technical references.

---

## 1. Scripts in `test_scripts/`

### [`run_all_verifications.sh`](./run_all_verifications.sh)
- **Purpose**: Run end-to-end hermetic validation of the `4w-cli` (`v0.3.2`) repository.
- **Executed Steps**:
  1. Deterministic generation of the release bundle and `SHA-256` hashes (`bun scripts/release.mjs`).
  2. POSIX syntax validation of the installer (`sh -n install.sh`).
  3. CLI self-test execution on both source and release bundle (`bun src/cli.ts --self-test`).
  4. Internationalization and persistent language verification (`en` default, `ptbr`, `es`, and local persistence via `4w lang`).
  5. Full automated unit, MCP protocol, Zero-Knowledge encryption, HTTP streaming, in-place self-updater, and real PTY test suite (`bun test`).
- **Usage**:
  ```sh
  sh test_scripts/run_all_verifications.sh
  ```

---

## 2. Base Test Reference in `tests/`

| File | Technical Scope | How to Run |
| :--- | :--- | :--- |
| [`tests/update.test.ts`](../tests/update.test.ts) | Tests the semantic version comparator ([`compareSemver`](../src/help.ts)), repository release discovery ([`fetchLatestVersion`](../src/commands.ts)), `4w update --check`, in-place update execution via the verified installer, rollback on failure, `--force` override, and update help topics. | `bun test tests/update.test.ts` |
| [`tests/mcp.test.ts`](../tests/mcp.test.ts) | Tests the MCP client ([`FourWords`](../src/commands.ts)), `2025-03-26` stateful and `2026-07-28` 1-RTT stateless negotiation, SSE, pagination, optimistic concurrency (`--base`), default `burn: true` (`--no-burn` to disable), AES-256-GCM encryption (`--encrypt`), direct download (`4w get`), streaming upload (`PUT /api/upload/file`), local vault (`4w history`), and all 15 MCP tools. | `bun test tests/mcp.test.ts` |
| [`tests/tui.test.ts`](../tests/tui.test.ts) | Tests the contextual help tree, multilingual support (`en` default, `ptbr`, `es`), persistent language selection in `config.json` (`4w lang`), ANSI/VT sanitization ([`textSafe`](../src/tui-model.ts)), secret masking ([`maskSecrets`](../src/tui-model.ts)), and a real interactive pseudoterminal session. | `bun test tests/tui.test.ts` |
| [`tests/terminal-session.py`](../tests/terminal-session.py) | Python `pty` driver that spawns a real Linux pseudoterminal, navigates the TUI, pastes Unicode via bracketed paste, verifies secret masking, copies via `OSC 52`, resizes the window (`SIGWINCH`), edits collaborative Markdown, and verifies `termios` restoration. | Invoked automatically by `bun test tests/tui.test.ts` |
| [`tests/lifecycle.sh`](../tests/lifecycle.sh) | Tests the installation lifecycle, `PATH` idempotence, tampered `SHA-256` rejection, concurrency lockfile, and clean uninstallation on Linux/macOS. | `sh tests/lifecycle.sh /path/to/bun-linux-x64.zip` |
| [`tests/windows-lifecycle.ps1`](../tests/windows-lifecycle.ps1) | Tests the installation lifecycle, `SHA-256` verification, session mutex, and clean uninstallation on Windows PowerShell. | `& .\tests\windows-lifecycle.ps1 -BunArchive C:\path\to\bun-windows-x64.zip` |
