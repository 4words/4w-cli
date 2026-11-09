# 4w · FourWords no Terminal

**Idioma:** [English](README.md) | Português (Brasil)

Cliente oficial de linha de comando (CLI) e painel interativo (TUI) do [FourWords](https://4words.aletheia.land) para compartilhar texto e arquivos com links de quatro palavras, criptografar conteúdos localmente com `AES-256-GCM` Zero-Knowledge, colaborar em salas em tempo real e operar todas as 15 ferramentas MCP em automações e agentes de IA.

```text
4w                 abre o painel interativo (TUI)
4w --help          lista todos os comandos
4w lang ptbr       altera e salva o idioma nesta máquina (en, ptbr, es)
4w doctor          verifica a conexão e o catálogo MCP
```

## Instalar

**Linux & macOS** · Ubuntu, Debian, Fedora, Arch, distros glibc e macOS (`x64` ou Apple Silicon `arm64`). Requer `curl`, `unzip` e `sha256sum` (ou `shasum` no macOS).

```sh
curl -fsSL https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.sh | sh
```

**Alpine** · Em instalações mínimas, execute a instalação das dependências com permissão para usar `apk`.

```sh
apk add --no-cache curl unzip libstdc++ libgcc && curl -fsSL https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.sh | sh
```

**NixOS** · Use a linha do Linux. Se `curl` ou `unzip` estiverem ausentes, disponibilize-os para a sessão de instalação.

```sh
nix --extra-experimental-features 'nix-command flakes' shell nixpkgs#curl nixpkgs#unzip -c sh -c 'curl -fsSL https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.sh | sh'
```

**Termux** · Use Termux e Android de 64 bits, no armazenamento interno do app.

```sh
pkg install -y curl unzip && curl -fsSL https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.sh | sh
```

**Windows PowerShell** · Windows 10 1809 ou posterior em x64, ou Windows em ARM64. A instalação usa o perfil atual.

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.ps1)))
```

O instalador executa sete etapas: detecta a plataforma, baixa a fonte versionada e o Bun oficial (`1.4.4`), verifica o `SHA-256` dos dois artefatos, compila o executável único, roda um autoteste (`--self-test`) e ativa o binário no perfil do usuário. Se o repositório estiver privado durante testes, exporte `GITHUB_TOKEN` antes de executar o instalador.

## Painel interativo (TUI)

Execute `4w` ou `4w tui` em um terminal interativo. O painel se adapta à largura da janela e usa um layout compacto em telas menores. `NO_COLOR=1` desativa a paleta mantendo a indicação do campo ativo.

> **Política Padrão de Leitura Única (`Burn ON`):** A leitura única (`--burn`) vem **ativada (`ON`) por padrão** em todas as publicações de `text`, `file` e `room send-file`. Para manter o link disponível pelas 24 horas sem queimar na primeira leitura, desmarque a opção com `Espaço` no painel ou passe `--no-burn` na linha de comando.

| Seção | O que você pode fazer |
| --- | --- |
| **Publicar** | Publicar texto/Markdown ou arquivo (até 24 MiB via MCP ou até 1 GiB via streaming), leitura única ativada por padrão (`ON`), criptografia local Zero-Knowledge (`--encrypt`), abrir/baixar links de 4 palavras e destruir conteúdos com `delete_url`. |
| **Salas** | Criar ou entrar em salas, ler e enviar mensagens/arquivos, consultar e editar o Markdown colaborativo com controle de concorrência (`--base`), escutar eventos em tempo real (`wait`), listar participantes, sortear apelido, autenticar agentes LLM e moderar com `admin_key`. |
| **Ferramentas & MCP** | Consultar o cofre local de 24h (`history`), inspecionar o catálogo ao vivo de ferramentas MCP, testar o diagnóstico da conexão (`doctor`) e trocar/salvar o idioma da interface (`en`, `ptbr`, `es`). |
| **Resultados** | Rolar a resposta, copiar o link público (`Y`), exibir credenciais sob demanda (`V`), abrir o Markdown retornado para edição (`E`) ou destruir imediatamente o item publicado (`D`). |

| Tecla | Ação |
| --- | --- |
| Setas ou `j` / `k`, `Enter` | Selecionar e abrir. |
| `L` | Alternar e salvar o idioma da interface nesta máquina (`EN` $\to$ `PTBR` $\to$ `ES`). |
| `Tab` / `Shift+Tab` | Mudar de campo ou alcançar o botão **Continuar**. |
| `Espaço` | Alternar controles de opção (leitura única, streaming, criptografia). |
| `F2` ou `Ctrl+S` | Continuar. Operações de escrita pedem confirmação. |
| `F1` | Abrir a ajuda do formulário ou o esquema da ferramenta MCP. |
| `?` | Abrir o guia de teclas no menu principal. |
| `V` | Exibir ou ocultar credenciais da resposta. |
| `Y` | Solicitar cópia do link via OSC 52, quando aceito pelo terminal. |
| `E` | Editar o Markdown da revisão exibida. |
| `D` | Destruir imediatamente o conteúdo exibido usando sua `delete_url`. |
| `Esc` / `Ctrl+C` | Voltar ou cancelar a espera / sair do painel. |

## Comandos e ajuda

```sh
4w --help
4w text --help
4w help room wait
4w mcp call --help

# Idioma e Persistência na Máquina (Padrão: en)
4w lang                  # Mostra o idioma atual e o salvo
4w lang ptbr             # Altera para Português (Brasil) e deixa salvo na máquina
4w lang es               # Altera para Espanhol e deixa salvo na máquina
4w lang en               # Volta para Inglês e deixa salvo na máquina

# Publicação, Criptografia Zero-Knowledge, Download e Destruição
# Nota: Leitura única (--burn) é ON por padrão; use --no-burn para reter por 24h.
4w text "Olá, FourWords!"
4w text --file notas.md --no-burn
4w text --file segredo.md --encrypt
4w file "relatório final.pdf"
4w file backup-grande.zip --stream --no-burn
4w get lua-gato-sol-rio-123456789 --raw
4w get "https://4words.aletheia.land/lua-gato-sol-rio-123456789#key=..." --output decifrado.md
4w delete "https://4words.aletheia.land/d/..."
4w history

# Salas Colaborativas (Humanos & Agentes LLM)
4w room create --doc pauta.md --message "Bem-vindos"
4w room join "$SALA"
4w room messages "$SALA" --since 0
4w room send "$SALA" "Começamos em cinco minutos."
4w room send-file "$SALA" diagrama.png --text "Arquitetura atual"
4w room doc "$SALA"
4w room save "$SALA" revisado.md --base 1780000000000
4w room save "$SALA" --rollback-version 1
4w room wait "$SALA" --since 0 --timeout 20
4w room participants "$SALA"
4w room nick "$SALA"
4w room register-llm "$SALA" --llm-key "$LLM_KEY" --llm-name claude
4w room moderate "$SALA" list --admin-key "$ADMIN_KEY"

# Introspecção e Chamada Direta MCP
4w mcp list
4w mcp call chat_participants - < argumentos.json
```

### Variáveis de Ambiente

| Variável | Descrição |
| --- | --- |
| `FOURWORDS_MCP_URL` | Endpoint MCP customizado (HTTPS ou HTTP em loopback). Padrão: `https://4words.aletheia.land/mcp`. |
| `FOURWORDS_LANG` | Sobrescreve o idioma para o processo atual (`en`, `ptbr`, `es`). Padrão: idioma salvo ou `en`. |
| `FOURWORDS_LLM_KEY` | Chave `fwllm_...` padrão para autenticar comandos `4w room *` como agente LLM. |
| `FOURWORDS_LLM_NAME` | Identificador curto do agente LLM (ex.: `claude`, `gemini`, `cursor`). |
| `FOURWORDS_ADMIN_KEY` | Chave `fwadm_...` padrão para `4w room moderate`. |
| `FOURWORDS_TOKEN` | Token Bearer opcional para autorização HTTP. |
| `FOURWORDS_NO_HISTORY` | Defina como `1` para desativar o registro automático no cofre local de 24h. |

## Atualizar ou remover

Linux, macOS e Termux:

```sh
curl -fsSL https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.sh | sh -s -- --uninstall
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/tallesdantas/4w-cli/main/install.ps1))) -Uninstall
```

## Desenvolvimento e distribuição

Use [Bun 1.4.4](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4).

```sh
bun src/cli.ts --help
bun test
bun scripts/release.mjs
sh -n install.sh
sh test_scripts/run_all_verifications.sh
```

Para instalar de um checkout local, rode `sh install.sh --source releases/0.3.0/cli.ts`. Em PowerShell, use `& .\install.ps1 -Source .\releases\0.3.0\cli.ts`.

| Ambiente | Carregamento |
| --- | --- |
| Linux glibc | Bun Linux oficial (`x64` / `aarch64`). |
| macOS (`Darwin`) | Bun Darwin oficial (`x64` / Apple Silicon `aarch64`). |
| Alpine | Bun musl e bibliotecas C++ do Alpine. |
| NixOS | Bun Linux oficial e lançador que aponta para a `glibc.out` do Nix store. |
| Termux | Bun Android Bionic oficial. |
| Windows | Bun Windows oficial e executável `4w.exe`. |
