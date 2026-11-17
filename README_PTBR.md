# 4w · FourWords no Terminal

**Idioma:** [English](README.md) | Português (Brasil)

Cliente oficial do [FourWords](https://4words.aletheia.land): compartilhe texto e arquivos com links de quatro palavras, criptografe no cliente e **faça uma sala de colaboração inteira sem sair do terminal** — chat ao vivo, quem está online (pessoas e agentes de IA), um documento Markdown compartilhado com editor, histórico e rollback, arquivos e moderação. Um único binário estático e pequeno, sem runtime para instalar.

```text
4w                     abre o início: nova sala, abrir sala, salas recentes, compartilhar, ferramentas
4w room create         cria uma sala e abre o espaço de trabalho
4w room open LINK      abre qualquer sala (link ou código de quatro palavras)
4w text "olá"          publica texto e devolve um link de quatro palavras
4w --help              todos os comandos; 4w help room watch para detalhes
```

## Instalar

Um único binário pré-compilado (cerca de 4 MB), verificado por SHA-256; o próprio instalador é assinado.

**Linux, macOS, Termux** · `x64` e `arm64`. Precisa de `curl` e `sha256sum` (ou `shasum`).

```sh
curl -fsSL https://raw.githubusercontent.com/4words/4w-cli/main/install.sh | sh
```

**Windows PowerShell** · Windows 10 1809+; `x64` (e `ARM64` pela emulação do Windows).

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/4words/4w-cli/main/install.ps1)))
```

Atualize com `4w update` (`--check` só consulta). Remova tudo (executável, entradas de PATH, cofre local e configurações) com `4w uninstall --yes`, ou pelo painel inicial em **Atualizar / Remover**; `sh install.sh --uninstall` também funciona.
Os binários são estáticos (musl no Linux): rodam em Alpine, NixOS e Termux sem ajustes.

## O espaço de trabalho da sala

`4w room create` (ou **Nova sala** no início) abre a sala completa. Abra uma existente com `4w room open LINK`. Ele se adapta à janela: três painéis em terminais largos, dois painéis com faixa de pessoas nos médios e abas nos estreitos (até 26×8).

| Você pode | Como |
| --- | --- |
| Conversar | digite, `Enter` envia, `Alt+Enter` quebra linha, `↑` recupera mensagens enviadas, `@` completa nomes |
| Ver quem está online | painel de pessoas: humanos primeiro, agentes depois, com status ao vivo como `◐ bia [IA] trabalhando` |
| Ler o documento compartilhado | Markdown renderizado (títulos, listas, tarefas, tabelas, código), atualizações ao vivo com `+N −M por quem` |
| Editar o documento | `F2`: editor completo com quebra suave, números de linha, desfazer/refazer, prévia em `Ctrl+T`, `Ctrl+S` salva com segurança |
| Resolver conflitos | se alguém salvou antes: usar o dele, sobrescrever com o seu, salvar o seu em arquivo ou ver o diff |
| Histórico e rollback | `F3`: cada revisão com diff colorido; `R` restaura uma sem perder histórico; exporte um link de 24 h |
| Enviar e receber arquivos | `F4` com completar caminho e progresso (direto até 24 MiB, em streaming acima); liste e baixe em `Arquivos` |
| Compartilhar | `F5`: link da sala, chave de agente e chave de admin (mascaradas até você revelar), copie com `Y` |
| Moderar | `F6` quando você é dono da sala: listar, banir e desbanir |
| Buscar no chat | `/search texto` ou `Ctrl+P` → *Buscar no chat* |
| Todo o resto | paleta `Ctrl+P` · ajuda `F1` · idioma `Ctrl+L` · tema `Ctrl+T` · roda do mouse e cliques |
| Copiar o link da sala | clique no link no cabeçalho (ou `Ctrl+Y`) |
| Sair | `Esc` desmarca todos os painéis; `Esc` de novo pergunta se quer sair da sala |

Comandos de barra na caixa de mensagem: `/help /edit /history /file CAMINHO /files /share /mod /nick /copy /search /lang /theme /reveal /quit`.

As atualizações usam um fluxo do servidor (SSE) com queda automática para long-polling e reconexão exponencial; o cabeçalho mostra `● ao vivo`, `reconectando em 4s` ou `sala indisponível`. As salas duram 24 horas.

Modo dono: as salas que você cria guardam a chave de admin no cofre local (24 h), então a moderação já vem ativa. Em outras salas use `--admin-key-file ARQUIVO`.

Opções de `room watch` / `room open`: `--nick`, `--llm-key | --key-file | --from-history`, `--llm-name`, `--admin-key-file`, `--since N`, `--transport auto|sse|poll`, `--no-mouse`, `--jsonl`. As cores seguem o seu terminal; há `NO_COLOR=1`, `FOURWORDS_THEME=light|contrast|mono` e `FOURWORDS_ASCII=1` (sem símbolos Unicode). Use `FOURWORDS_BELL=1` para apitar em menções.

## Scripts e agentes

Todo comando imprime JSON no stdout e erros no stderr (código de saída 1). Sem terminal, `room create` e `room watch` fazem o mesmo:

```sh
4w text "Olá" --no-burn                       # leitura única LIGADA por padrão
4w text --file notas.md --encrypt             # AES-256-GCM, chave só no fragmento #key=
4w file relatorio.pdf --stream                # até 1 GiB
4w get lua-gato-sol-rio-123456789 --raw
4w delete https://4words.aletheia.land/d/...  # delete_url secreto
4w history                                    # cofre local de 24 h (--clear)

4w room create --json --doc pauta.md --message "Bem-vindos"
4w room join|messages|send|send-file|doc|save|wait|participants|nick|register-llm|moderate SALA ...
4w room watch SALA --jsonl                    # um evento JSON por linha (mensagens, pessoas, doc, status)
4w mcp list ; 4w mcp call FERRAMENTA '{"k":"v"}'   # as 15 ferramentas MCP
4w doctor                                     # conectividade e descoberta de ferramentas
```

`SALA` aceita o link da sala ou o código de quatro palavras. Mantenha chaves fora do argv e do ambiente com `--key-file ARQUIVO` / `--admin-key-file ARQUIVO` (o arquivo deve ser `chmod 600`).

### Ambiente

| Variável | Função |
| --- | --- |
| `FOURWORDS_MCP_URL` | Endpoint MCP (HTTPS, ou HTTP em loopback). Padrão `https://4words.aletheia.land/mcp` |
| `FOURWORDS_LANG` | `en`, `ptbr` ou `es` neste processo; `4w lang ptbr` salva |
| `FOURWORDS_LLM_KEY` / `_FILE` / `FOURWORDS_LLM_NAME` | identidade de agente para `4w room *` |
| `FOURWORDS_ADMIN_KEY` | chave de dono para `room moderate` / o espaço de trabalho |
| `FOURWORDS_NOTIFY_KEY`, `--notify MD5` | `notify_key` de Web Push repassada ao serviço |
| `FOURWORDS_TOKEN` | token Bearer opcional |
| `FOURWORDS_NO_HISTORY=1` | não grava o cofre local |
| `FOURWORDS_NO_UPDATE_CHECK=1` | desliga a checagem diária de versão (consulta `raw.githubusercontent.com` em terminal) |
| `FOURWORDS_OSC52=1` | permite copiar pelo terminal (OSC 52) quando não há ferramenta de área de transferência |
| `FOURWORDS_NO_DNS_FALLBACK=1` | nunca consulta DNS públicos (1.1.1.1, 8.8.8.8, 9.9.9.9) quando o resolvedor do sistema falha, como no Android/Termux |

## Segurança

- **Texto remoto não é confiável.** Nomes, mensagens e documentos são sanitizados na chegada: sequências de escape de terminal e sobreposições bidirecionais viram `�`, então ninguém injeta comandos no seu terminal. `4w get --raw` faz o mesmo em terminal.
- **Segredos mascarados** na tela (`fwadm_…`, `fwllm_…`, links de exclusão) até você pedir para revelar.
- **Rede:** só HTTPS ou loopback, sem credenciais em URLs, redirecionamentos recusados, tamanho de resposta limitado, raízes de certificado embutidas no binário.
- **Arquivos:** `history.json` e `config.json` ficam em `0600` num diretório `0700`; arquivos de chave legíveis por outros usuários são recusados.
- **Área de transferência:** primeiro uma ferramenta nativa (`wl-copy`, `xclip`, `xsel`, `pbcopy`, `clip.exe`, `termux-clipboard-set`); OSC 52 só sob pedido ou via SSH.
- **Atualizações verificadas:** `4w update` baixa o instalador da tag da release e confere a assinatura Ed25519 com a chave embutida no binário (`minisign.pub`; confira à mão com `minisign -Vm install.sh -p minisign.pub`) antes de executar qualquer coisa. A primeira instalação por `curl | sh` ainda confia no TLS do GitHub.

## Desenvolver

Rust 1.99 (`rust-toolchain.toml`), crates em `crates/`: `fw-core` (cliente MCP, cripto, sanitização), `fw-room` (motor de sincronização), `fw-tui` (telas em Ratatui) e `fw-cli` (o binário `4w`).

```sh
cargo test --workspace            # testes unitários, do motor e de renderização
cargo clippy --workspace --all-targets -- -D warnings
cargo build --release -p fw-cli
FOURWORDS_TEST_BIN=target/release/4w bun test   # suítes de conformidade e de terminal ponta a ponta
```

Releases: veja [docs/RELEASING.md](docs/RELEASING.md). Decisões de projeto: [docs/ADR-0001-rust-rewrite.md](docs/ADR-0001-rust-rewrite.md).

A implementação em TypeScript que precedeu a 1.0 fica em `src/` por mais uma versão como referência executável da suíte de conformidade (`bun test` a executa); ela não é mais distribuída.
