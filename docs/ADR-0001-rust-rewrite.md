# ADR-0001: 4w 1.0 em Rust com Ratatui

Status: aceito. Substitui o runtime TypeScript/Bun a partir da 1.0.

## Decisão

Um único binário `4w` em Rust (workspace em `crates/`), com a sala completa numa TUI Ratatui.
A suíte TypeScript (`tests/*.test.ts`) é a especificação executável: roda contra o binário Rust
com `FOURWORDS_TEST_BIN=/caminho/4w bun test`.

## Resultados dos spikes (M0)

| Spike | Resultado |
|---|---|
| S1 widget Plasma | Emulador do widget é QML, não há como testar sem GUI. Mitigação: só emitir sequências que a especificação do widget declara (tela alternativa, SGR mouse, SGR/256/truecolor); sem teclado kitty, sem eventos de foco, sem consultas OSC. Certificação manual no M4. OSC 52 é **negado por padrão** no widget (SEC-005): cópia usa ferramenta nativa primeiro. |
| S2 editor | `ratatui 0.30.2` + `ratatui-textarea 0.9.4` compilam e renderizam. `tui-textarea 0.7` está parado e não é usado. |
| S3 transporte | O SSE `GET /chat/<hash>/events?nick=<nick>` unifica a identidade com a do MCP (`via: ["sse","http"]`, um participante). Sem `?nick=` o servidor cria outro apelido. Eventos: `ready`, `presence`, `msg` (`id:` = `seq`), `doc` (`content, editor, ts, version, additions, deletions`). **Transporte principal: SSE; fallback automático: long-poll `chat_wait_events`.** |
| S4 build estático | `cargo zigbuild` gera musl estático x64 (1,9 MB) e arm64 (1,7 MB) com `reqwest` + `rustls`(provider `ring`) + `webpki-roots`. O provider padrão `aws-lc` não linka com zig/LTO. Raízes embutidas evitam dependência do repositório de certificados do SO (Termux/Alpine). |
| S5 conformidade | `tests/bin.ts` expõe `cliCommand`; toda a suíte usa `FOURWORDS_TEST_BIN` quando definido. |

## Consequências

- Binários por alvo: linux x64/arm64 (musl), macOS x64/arm64, windows x64.
- Release assinado offline (minisign, chave já existente); o binário embute a chave pública.
- Texto remoto é sanitizado na entrada dos dados: o Ratatui escreve símbolos crus no terminal.
