// @bun
// src/commands.ts
import { spawnSync } from "child_process";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname as dirname2, join as join2 } from "path";
import { parseArgs } from "util";

// src/help.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
var VERSION = "0.3.2";
var SITE = "https://4words.aletheia.land";
var REPO = "https://github.com/4words/4w-cli";
function configPath() {
  if (process.env.FOURWORDS_CONFIG_FILE)
    return process.env.FOURWORDS_CONFIG_FILE;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "4Words", "CLI", "config.json");
  }
  if (process.env.HOME) {
    return join(process.env.HOME, ".local", "share", "4words-cli", "config.json");
  }
  return;
}
function normalizeLang(raw) {
  if (!raw)
    return;
  const clean = raw.trim().toLowerCase().replace(/[_-]/g, "");
  if (clean === "en" || clean.startsWith("enus") || clean.startsWith("engb") || clean === "english")
    return "en";
  if (clean === "ptbr" || clean === "pt" || clean.startsWith("ptpt") || clean.startsWith("portugu"))
    return "ptbr";
  if (clean === "es" || clean.startsWith("eses") || clean.startsWith("es419") || clean.startsWith("espan"))
    return "es";
  return;
}
function compareSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0;i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb)
      return 1;
    if (na < nb)
      return -1;
  }
  return 0;
}
function readConfig() {
  const file = configPath();
  if (!file)
    return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed;
  } catch {}
  return {};
}
function updateConfig(patch) {
  const file = configPath();
  if (!file)
    return;
  const updated = { ...readConfig(), ...patch };
  mkdirSync(dirname(file), { recursive: true, mode: 448 });
  writeFileSync(file, JSON.stringify(updated, null, 2) + `
`, { mode: 384 });
  return file;
}
function readSavedLang() {
  const lang = readConfig().lang;
  return typeof lang === "string" ? normalizeLang(lang) : undefined;
}
function saveLang(lang) {
  return updateConfig({ lang, updated_at: Date.now() });
}
function resolveLang(explicit) {
  return normalizeLang(explicit) ?? normalizeLang(process.env.FOURWORDS_LANG) ?? readSavedLang() ?? "en";
}
var topicsPt = {
  tui: {
    label: "Painel interativo",
    usage: "4w  |  4w tui",
    details: "Abra o painel do FourWords em um terminal interativo. Com sa\xEDda redirecionada ou TERM=dumb, 4w sem argumentos imprime esta ajuda.",
    examples: ["4w", "4w tui"]
  },
  lang: {
    label: "Definir e salvar idioma (en, ptbr, es)",
    usage: "4w lang [en|ptbr|es]",
    details: "Consulta ou altera o idioma padr\xE3o da interface CLI e TUI (en, ptbr ou es). A escolha fica salva nesta m\xE1quina em ~/.local/share/4words-cli/config.json.",
    examples: ["4w lang", "4w lang en", "4w lang ptbr", "4w lang es"]
  },
  doctor: {
    label: "Diagnosticar conex\xE3o",
    usage: "4w doctor",
    details: "Conecta ao MCP, negocia a sess\xE3o e conta as ferramentas. Exibe JSON com ok, version e tools. A opera\xE7\xE3o n\xE3o publica conte\xFAdo.",
    examples: ["4w doctor"]
  },
  update: {
    label: "Atualizar o 4w",
    usage: "4w update [--check] [--force]",
    details: "Compara a vers\xE3o instalada com o instalador publicado no reposit\xF3rio. Se houver vers\xE3o nova, baixa e executa o instalador oficial, que verifica o SHA-256, compila, faz o autoteste e troca o execut\xE1vel. Se ocorrer uma falha, a vers\xE3o anterior fica instalada. --check s\xF3 consulta e n\xE3o altera nada. --force reinstala a vers\xE3o publicada, mesmo que seja igual ou que este 4w n\xE3o seja a c\xF3pia gerenciada pelo instalador. Uma vez a cada 24 horas, o 4w avisa no stderr quando existe vers\xE3o nova. Para desativar o aviso, defina FOURWORDS_NO_UPDATE_CHECK=1.",
    examples: ["4w update --check", "4w update", "4w update --force"]
  },
  text: {
    label: "Publicar texto",
    usage: "4w text TEXTO | 4w text --file ARQUIVO | 4w text - [--burn] [--encrypt]",
    details: "Publica at\xE9 100.000 bytes de texto UTF-8, inclusive Markdown. Use aspas em TEXTO, --file para um arquivo ou - para stdin. --burn ativa leitura \xFAnica. --encrypt aplica criptografia local AES-256-GCM Zero-Knowledge e anexa #key= ao link.",
    examples: ['4w text "Ol\xE1, FourWords!"', "4w text --file notas.md --burn", "4w text --file segredo.md --burn --encrypt", 'printf "%s\\n" "Texto do pipe" | 4w text -', '4w text -- "--texto iniciado por h\xEDfen"']
  },
  file: {
    label: "Publicar arquivo",
    usage: "4w file ARQUIVO [--burn] [--stream] [--encrypt] [--type MIME]",
    details: "Envia um arquivo regular de at\xE9 24 MiB pelo MCP ou at\xE9 1 GiB via streaming HTTP (--stream ou autom\xE1tico acima de 24 MiB). --burn ativa leitura \xFAnica. --encrypt criptografa localmente com AES-256-GCM antes do upload.",
    examples: ['4w file "relat\xF3rio final.pdf" --burn', "4w file backup.zip --stream", "4w file chaves.tar.gz --burn --encrypt"]
  },
  get: {
    label: "Abrir ou baixar link de 4 palavras",
    usage: "4w get LINK_OU_COMBO [--output ARQUIVO] [--raw] [--key CHAVE]",
    details: "Recupera texto ou arquivo a partir de uma URL FourWords ou c\xF3digo de 4 palavras e 9 d\xEDgitos. Se a URL contiver #key= (ou --key for informado), descriptografa automaticamente no cliente. Use --raw para enviar o conte\xFAdo puro ao stdout ou --output para salvar em arquivo.",
    examples: ["4w get lua-gato-sol-rio-123456789", "4w get lua-gato-sol-rio-123456789 --raw", "4w get https://4words.aletheia.land/lua-gato-sol-rio-123456789 --output relatorio.pdf"]
  },
  delete: {
    label: "Destruir conte\xFAdo imediatamente",
    usage: "4w delete URL_DE_DESTRUICAO",
    details: "Purga irreversivelmente um texto ou arquivo antes da expira\xE7\xE3o de 24 horas usando a delete_url secreta (/d/<sha512>) emitida na publica\xE7\xE3o.",
    examples: ['4w delete "https://4words.aletheia.land/d/..."']
  },
  history: {
    label: "Consultar cofre local de 24 horas",
    usage: "4w history [--clear]",
    details: "Lista os links, delete_url, admin_key e llm_key gerados neste perfil nas \xFAltimas 24 horas. Registros expirados s\xE3o removidos automaticamente. Use --clear para apagar o hist\xF3rico local.",
    examples: ["4w history", "4w history --clear"]
  },
  room: {
    label: "Trabalhar em salas",
    usage: "4w room <create|join|send|send-file|messages|doc|save|wait|participants|nick|register-llm|moderate> [ARGUMENTOS]",
    details: "SALA aceita uma URL de sala ou seu c\xF3digo de quatro palavras e nove d\xEDgitos. Consulte os t\xF3picos abaixo para argumentos e exemplos.",
    examples: ["4w room create", "4w help room save", "4w help room wait"]
  },
  "room create": {
    label: "Criar sala",
    usage: "4w room create [--doc ARQUIVO] [--message TEXTO] [--llm-name NOME]",
    details: "Cria uma sala e devolve links e credenciais quando emitidas pelo servidor. --doc carrega Markdown inicial UTF-8 de at\xE9 50.000 unidades UTF-16 (use --doc - para stdin). --message publica uma mensagem inicial e --llm-name identifica o agente autor.",
    examples: ["4w room create --doc pauta.md", '4w room create --doc pauta.md --message "Sala iniciada" --llm-name claude']
  },
  "room join": {
    label: "Entrar na sala",
    usage: "4w room join SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Registra sua entrada e retorna o apelido, participantes e o estado inicial da sala.",
    examples: ['4w room join "$SALA"', '4w room join "$SALA" --llm-key "$LLM_KEY" --llm-name gemini']
  },
  "room send": {
    label: "Enviar mensagem",
    usage: "4w room send SALA TEXTO [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Envia uma mensagem \xE0 sala. Informe a mensagem em um \xFAnico argumento entre aspas.",
    examples: ['4w room send "$SALA" "Come\xE7amos em cinco minutos."', '4w room send "$SALA" "An\xE1lise conclu\xEDda." --llm-key "$LLM_KEY" --llm-name claude']
  },
  "room send-file": {
    label: "Enviar arquivo na sala",
    usage: "4w room send-file SALA ARQUIVO [--text MENSAGEM] [--nick APELIDO] [--burn] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Envia um arquivo de at\xE9 24 MiB diretamente para os participantes da sala e retorna a delete_url privada ao remetente.",
    examples: ['4w room send-file "$SALA" relatorio.pdf --text "Segue o PDF" --burn']
  },
  "room messages": {
    label: "Ler mensagens",
    usage: "4w room messages SALA [--since N] [--mentions-only] [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "L\xEA as mensagens dispon\xEDveis. --since aceita uma sequ\xEAncia n\xE3o negativa e consulta apenas mensagens posteriores a ela. --mentions-only filtra apenas men\xE7\xF5es @apelido.",
    examples: ['4w room messages "$SALA" --since 42', '4w room messages "$SALA" --mentions-only --llm-key "$LLM_KEY"']
  },
  "room doc": {
    label: "Ler Markdown",
    usage: "4w room doc SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Exibe o Markdown compartilhado, hist\xF3rico de revis\xF5es e sua revis\xE3o updated_at. Guarde essa revis\xE3o para salvar uma edi\xE7\xE3o com controle de concorr\xEAncia.",
    examples: ['4w room doc "$SALA"']
  },
  "room save": {
    label: "Salvar Markdown",
    usage: "4w room save SALA [ARQUIVO|-] --base N [--rollback-version V] [--rollback-ts TS] [--export-link] [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Salva Markdown UTF-8 de at\xE9 50.000 unidades UTF-16 ou restaura uma vers\xE3o anterior. Passe em --base o updated_at da vers\xE3o que voc\xEA editou, ou 0 para uma sala sem revis\xE3o. Use - no lugar do arquivo para ler stdin. Se houver conflito, releia o documento e incorpore as mudan\xE7as.",
    examples: ['4w room doc "$SALA"', '4w room save "$SALA" revisado.md --base 1780000000000', '4w room save "$SALA" --rollback-version 1']
  },
  "room wait": {
    label: "Aguardar eventos em tempo real",
    usage: "4w room wait SALA [--since N] [--since-doc TS] [--timeout SEGUNDOS] [--all] [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Realiza long-polling aguardando novas mensagens, men\xE7\xF5es @apelido ou edi\xE7\xF5es no documento Markdown colaborativo. Use --all para receber todas as mensagens mesmo quando autenticado com --llm-key.",
    examples: ['4w room wait "$SALA" --since 0 --timeout 20', '4w room wait "$SALA" --llm-key "$LLM_KEY" --llm-name claude']
  },
  "room participants": {
    label: "Listar participantes ativos",
    usage: "4w room participants SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Lista todos os participantes humanos e agentes LLM ativos na sala.",
    examples: ['4w room participants "$SALA"']
  },
  "room nick": {
    label: "Sortear novo apelido",
    usage: "4w room nick SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Sorteia um novo apelido aleat\xF3rio vinculado ao IP ou sess\xE3o atual na sala.",
    examples: ['4w room nick "$SALA"']
  },
  "room register-llm": {
    label: "Registrar agente LLM",
    usage: "4w room register-llm SALA --llm-key CHAVE [--llm-name NOME]",
    details: "Autentica um agente de IA usando a llm_key da sala para exibir o selo dourado de LLM e receber eventos.",
    examples: ['4w room register-llm "$SALA" --llm-key "$LLM_KEY" --llm-name claude']
  },
  "room moderate": {
    label: "Moderar sala",
    usage: "4w room moderate SALA <ban|unban|list|verify> --admin-key CHAVE [--nick APELIDO] [--ban-id ID]",
    details: "Verifica a admin_key, lista banimentos ativos, bane ou desbane participantes abusivos por apelido ou ban_id.",
    examples: ['4w room moderate "$SALA" list --admin-key "$ADMIN_KEY"', '4w room moderate "$SALA" ban --admin-key "$ADMIN_KEY" --nick invasor']
  },
  mcp: {
    label: "Explorar o MCP",
    usage: "4w mcp <list|call> [ARGUMENTOS]",
    details: "Descubra o contrato atual do servidor e invoque ferramentas pelo nome. O cat\xE1logo vem do endpoint MCP durante a consulta.",
    examples: ["4w mcp list", "4w help mcp call"]
  },
  "mcp list": {
    label: "Listar ferramentas",
    usage: "4w mcp list",
    details: "Consulta o cat\xE1logo atual e exibe um array JSON com ferramentas, descri\xE7\xF5es e esquemas de entrada.",
    examples: ["4w mcp list"]
  },
  "mcp call": {
    label: "Chamar ferramenta",
    usage: "4w mcp call FERRAMENTA [OBJETO_JSON|-]",
    details: "Envia um objeto JSON como argumentos. O padr\xE3o \xE9 {}. Use - para ler de stdin, especialmente quando o JSON contiver chaves. Consulte mcp list para ver os campos exigidos por cada opera\xE7\xE3o.",
    examples: [`4w mcp call upload_text '{"content":"Ol\xE1","burn":true}'`, "4w mcp call chat_participants - < argumentos.json"]
  }
};
var topicsEn = {
  tui: {
    label: "Interactive panel",
    usage: "4w  |  4w tui",
    details: "Open the FourWords interactive terminal panel. When output is redirected or TERM=dumb, 4w with no arguments prints this help.",
    examples: ["4w", "4w tui"]
  },
  lang: {
    label: "Set and save language (en, ptbr, es)",
    usage: "4w lang [en|ptbr|es]",
    details: "Shows or changes the default CLI and TUI language (en, ptbr, or es). The selected option is saved and remembered on this machine in ~/.local/share/4words-cli/config.json.",
    examples: ["4w lang", "4w lang en", "4w lang ptbr", "4w lang es"]
  },
  doctor: {
    label: "Diagnose connection",
    usage: "4w doctor",
    details: "Connects to the MCP endpoint, negotiates protocol and counts available tools. Outputs JSON with ok, version and tools.",
    examples: ["4w doctor"]
  },
  update: {
    label: "Update 4w",
    usage: "4w update [--check] [--force]",
    details: "Compares the installed version with the installer published in the repository. If a newer version exists, downloads and runs the official installer, which verifies the SHA-256, compiles, runs the self-test and replaces the executable. If a step fails, the previous version stays installed. --check only reports and changes nothing. --force reinstalls the published version, also when it is the same version or when this 4w is not the copy managed by the installer. Once every 24 hours, 4w writes a notice to stderr when a newer version exists. Set FOURWORDS_NO_UPDATE_CHECK=1 to disable the notice.",
    examples: ["4w update --check", "4w update", "4w update --force"]
  },
  text: {
    label: "Publish text",
    usage: "4w text TEXT | 4w text --file FILE | 4w text - [--burn] [--encrypt]",
    details: "Publishes up to 100,000 bytes of UTF-8 text or Markdown. Use --burn for burn-after-reading and --encrypt for client-side AES-256-GCM Zero-Knowledge encryption.",
    examples: ['4w text "Hello, FourWords!"', "4w text --file notes.md --burn", "4w text --file secret.md --burn --encrypt"]
  },
  file: {
    label: "Publish file",
    usage: "4w file FILE [--burn] [--stream] [--encrypt] [--type MIME]",
    details: "Uploads a regular file up to 24 MiB via MCP or up to 1 GiB via HTTP streaming (--stream or automatic above 24 MiB). --burn enables single read. --encrypt encrypts locally with AES-256-GCM.",
    examples: ['4w file "final report.pdf" --burn', "4w file archive.zip --stream"]
  },
  get: {
    label: "Open or download 4-word link",
    usage: "4w get LINK_OR_COMBO [--output FILE] [--raw] [--key KEY]",
    details: "Fetches text or binary file from a FourWords URL or 4-word + 9-digit combo. Automatically decrypts if #key= or --key is provided. Use --raw to write raw content to stdout or --output to save to a file.",
    examples: ["4w get lua-gato-sol-rio-123456789", "4w get lua-gato-sol-rio-123456789 --raw"]
  },
  delete: {
    label: "Destroy content immediately",
    usage: "4w delete DELETE_URL",
    details: "Irreversibly purges published text or file before the 24-hour expiration using its secret delete_url (/d/<sha512>).",
    examples: ['4w delete "https://4words.aletheia.land/d/..."']
  },
  history: {
    label: "Inspect local 24-hour vault",
    usage: "4w history [--clear]",
    details: "Lists links, delete_url, admin_key and llm_key created in this user profile within the last 24 hours. Use --clear to wipe local history.",
    examples: ["4w history", "4w history --clear"]
  },
  room: {
    label: "Collaborate in rooms",
    usage: "4w room <create|join|send|send-file|messages|doc|save|wait|participants|nick|register-llm|moderate> [ARGS]",
    details: "ROOM accepts a room URL or its four-word + nine-digit code. See subcommands below for details.",
    examples: ["4w room create", "4w help room save", "4w help room wait"]
  },
  "room create": {
    label: "Create room",
    usage: "4w room create [--doc FILE] [--message TEXT] [--llm-name NAME]",
    details: "Creates a collaboration room and returns URLs and keys. --doc loads initial UTF-8 Markdown up to 50,000 UTF-16 code units.",
    examples: ["4w room create --doc agenda.md"]
  },
  "room join": {
    label: "Join room",
    usage: "4w room join ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Joins the room and returns your assigned nickname, participants and initial state.",
    examples: ['4w room join "$ROOM"']
  },
  "room send": {
    label: "Send message",
    usage: "4w room send ROOM TEXT [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Posts a message to the room.",
    examples: ['4w room send "$ROOM" "Starting in five minutes."']
  },
  "room send-file": {
    label: "Send file to room",
    usage: "4w room send-file ROOM FILE [--text MESSAGE] [--nick NICK] [--burn] [--llm-key KEY] [--llm-name NAME]",
    details: "Uploads a file up to 24 MiB to the room and returns the private delete_url.",
    examples: ['4w room send-file "$ROOM" report.pdf --text "Attached report" --burn']
  },
  "room messages": {
    label: "Read messages",
    usage: "4w room messages ROOM [--since N] [--mentions-only] [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Polls messages since sequence cursor N.",
    examples: ['4w room messages "$ROOM" --since 42']
  },
  "room doc": {
    label: "Read Markdown",
    usage: "4w room doc ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Fetches the shared Markdown document and its updated_at revision.",
    examples: ['4w room doc "$ROOM"']
  },
  "room save": {
    label: "Save Markdown",
    usage: "4w room save ROOM [FILE|-] --base N [--rollback-version V] [--rollback-ts TS] [--export-link] [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Saves UTF-8 Markdown up to 50,000 UTF-16 units with optimistic concurrency (--base updated_at) or rolls back to a prior version.",
    examples: ['4w room doc "$ROOM"', '4w room save "$ROOM" revised.md --base 1780000000000']
  },
  "room wait": {
    label: "Wait for live room events",
    usage: "4w room wait ROOM [--since N] [--since-doc TS] [--timeout SECONDS] [--all] [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Long-polls for new messages, @mentions or collaborative Markdown edits.",
    examples: ['4w room wait "$ROOM" --since 0 --timeout 20']
  },
  "room participants": {
    label: "List active participants",
    usage: "4w room participants ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Lists active human and LLM participants in the room.",
    examples: ['4w room participants "$ROOM"']
  },
  "room nick": {
    label: "Roll random nickname",
    usage: "4w room nick ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Rolls a new random animal-noun nickname for the caller.",
    examples: ['4w room nick "$ROOM"']
  },
  "room register-llm": {
    label: "Register LLM agent",
    usage: "4w room register-llm ROOM --llm-key KEY [--llm-name NAME]",
    details: "Authenticates with the room llm_key to appear as a golden LLM agent.",
    examples: ['4w room register-llm "$ROOM" --llm-key "$LLM_KEY" --llm-name claude']
  },
  "room moderate": {
    label: "Moderate room",
    usage: "4w room moderate ROOM <ban|unban|list|verify> --admin-key KEY [--nick NICK] [--ban-id ID]",
    details: "Verifies admin_key, lists active bans, or bans/unbans abusive IPs.",
    examples: ['4w room moderate "$ROOM" list --admin-key "$ADMIN_KEY"']
  },
  mcp: {
    label: "Explore MCP",
    usage: "4w mcp <list|call> [ARGS]",
    details: "Discover the live server contract and invoke tools by name.",
    examples: ["4w mcp list", "4w help mcp call"]
  },
  "mcp list": {
    label: "List tools",
    usage: "4w mcp list",
    details: "Queries the live catalog and outputs a JSON array of tools and input schemas.",
    examples: ["4w mcp list"]
  },
  "mcp call": {
    label: "Call tool",
    usage: "4w mcp call TOOL [JSON_OBJECT|-]",
    details: "Sends a JSON object as arguments. Defaults to {}. Use - to read from stdin.",
    examples: [`4w mcp call upload_text '{"content":"Hello","burn":true}'`, "4w mcp call chat_participants - < args.json"]
  }
};
var topicsEs = {
  tui: {
    label: "Panel interactivo",
    usage: "4w  |  4w tui",
    details: "Abre el panel interactivo de FourWords. Con salida redirigida o TERM=dumb, 4w sin argumentos imprime esta ayuda.",
    examples: ["4w", "4w tui"]
  },
  lang: {
    label: "Definir y guardar idioma (en, ptbr, es)",
    usage: "4w lang [en|ptbr|es]",
    details: "Consulta o cambia el idioma predeterminado de la interfaz CLI y TUI (en, ptbr o es). La preferencia se guarda en esta m\xE1quina en ~/.local/share/4words-cli/config.json.",
    examples: ["4w lang", "4w lang en", "4w lang ptbr", "4w lang es"]
  },
  doctor: {
    label: "Diagnosticar conexi\xF3n",
    usage: "4w doctor",
    details: "Conecta al MCP, negocia la sesi\xF3n y cuenta las herramientas disponibles.",
    examples: ["4w doctor"]
  },
  update: {
    label: "Actualizar 4w",
    usage: "4w update [--check] [--force]",
    details: "Compara la versi\xF3n instalada con el instalador publicado en el repositorio. Si hay una versi\xF3n nueva, descarga y ejecuta el instalador oficial, que verifica el SHA-256, compila, ejecuta la autoprueba y reemplaza el ejecutable. Si un paso falla, la versi\xF3n anterior queda instalada. --check solo consulta y no cambia nada. --force reinstala la versi\xF3n publicada, tambi\xE9n si es la misma versi\xF3n o si este 4w no es la copia gestionada por el instalador. Una vez cada 24 horas, 4w avisa en stderr cuando hay una versi\xF3n nueva. Defina FOURWORDS_NO_UPDATE_CHECK=1 para desactivar el aviso.",
    examples: ["4w update --check", "4w update", "4w update --force"]
  },
  text: {
    label: "Publicar texto",
    usage: "4w text TEXTO | 4w text --file ARCHIVO | 4w text - [--burn] [--encrypt]",
    details: "Publica hasta 100.000 bytes de texto UTF-8 o Markdown. Use --burn para lectura \xFAnica y --encrypt para cifrado local AES-256-GCM Zero-Knowledge.",
    examples: ['4w text "\xA1Hola, FourWords!"', "4w text --file notas.md --burn", "4w text --file secreto.md --burn --encrypt"]
  },
  file: {
    label: "Publicar archivo",
    usage: "4w file ARCHIVO [--burn] [--stream] [--encrypt] [--type MIME]",
    details: "Sube un archivo de hasta 24 MiB por MCP o hasta 1 GiB por streaming HTTP (--stream o autom\xE1tico sobre 24 MiB). --burn activa lectura \xFAnica. --encrypt cifra localmente con AES-256-GCM.",
    examples: ['4w file "informe final.pdf" --burn', "4w file copia.zip --stream"]
  },
  get: {
    label: "Abrir o descargar enlace de 4 palabras",
    usage: "4w get ENLACE_O_CODIGO [--output ARCHIVO] [--raw] [--key CLAVE]",
    details: "Recupera texto o archivo desde una URL de FourWords o c\xF3digo de 4 palabras y 9 d\xEDgitos. Descifra autom\xE1ticamente si incluye #key= o --key.",
    examples: ["4w get lua-gato-sol-rio-123456789", "4w get lua-gato-sol-rio-123456789 --raw"]
  },
  delete: {
    label: "Destruir contenido inmediatamente",
    usage: "4w delete URL_DE_DESTRUCCION",
    details: "Elimina irreversiblemente un texto o archivo antes de las 24 horas usando su delete_url secreta (/d/<sha512>).",
    examples: ['4w delete "https://4words.aletheia.land/d/..."']
  },
  history: {
    label: "Consultar b\xF3veda local de 24 horas",
    usage: "4w history [--clear]",
    details: "Lista los enlaces, delete_url, admin_key y llm_key generados en este perfil en las \xFAltimas 24 horas. Use --clear para limpiar el historial.",
    examples: ["4w history", "4w history --clear"]
  },
  room: {
    label: "Colaborar en salas",
    usage: "4w room <create|join|send|send-file|messages|doc|save|wait|participants|nick|register-llm|moderate> [ARGUMENTOS]",
    details: "SALA acepta una URL de sala o su c\xF3digo de cuatro palabras y nueve d\xEDgitos.",
    examples: ["4w room create", "4w help room save", "4w help room wait"]
  },
  "room create": {
    label: "Crear sala",
    usage: "4w room create [--doc ARCHIVO] [--message TEXTO] [--llm-name NOMBRE]",
    details: "Crea una sala colaborativa y devuelve enlaces y credenciales.",
    examples: ["4w room create --doc agenda.md"]
  },
  "room join": {
    label: "Entrar en la sala",
    usage: "4w room join SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Registra su entrada y devuelve su apodo, participantes y estado inicial.",
    examples: ['4w room join "$SALA"']
  },
  "room send": {
    label: "Enviar mensaje",
    usage: "4w room send SALA TEXTO [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Env\xEDa un mensaje a la sala.",
    examples: ['4w room send "$SALA" "Empezamos en cinco minutos."']
  },
  "room send-file": {
    label: "Enviar archivo a la sala",
    usage: "4w room send-file SALA ARCHIVO [--text MENSAJE] [--nick APODO] [--burn] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Env\xEDa un archivo de hasta 24 MiB directamente a la sala y devuelve la delete_url privada.",
    examples: ['4w room send-file "$SALA" informe.pdf --text "Adjunto informe" --burn']
  },
  "room messages": {
    label: "Leer mensajes",
    usage: "4w room messages SALA [--since N] [--mentions-only] [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Lee los mensajes disponibles desde la secuencia N.",
    examples: ['4w room messages "$SALA" --since 42']
  },
  "room doc": {
    label: "Leer Markdown",
    usage: "4w room doc SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Obtiene el documento Markdown compartido y su revisi\xF3n updated_at.",
    examples: ['4w room doc "$SALA"']
  },
  "room save": {
    label: "Guardar Markdown",
    usage: "4w room save SALA [ARCHIVO|-] --base N [--rollback-version V] [--rollback-ts TS] [--export-link] [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Guarda Markdown UTF-8 con control de concurrencia (--base updated_at) o restaura una versi\xF3n anterior.",
    examples: ['4w room doc "$SALA"', '4w room save "$SALA" revisado.md --base 1780000000000']
  },
  "room wait": {
    label: "Esperar eventos en tiempo real",
    usage: "4w room wait SALA [--since N] [--since-doc TS] [--timeout SEGUNDOS] [--all] [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Realiza long-polling esperando nuevos mensajes, menciones @apodo o ediciones en el Markdown.",
    examples: ['4w room wait "$SALA" --since 0 --timeout 20']
  },
  "room participants": {
    label: "Listar participantes activos",
    usage: "4w room participants SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Lista todos los participantes humanos y agentes LLM activos en la sala.",
    examples: ['4w room participants "$SALA"']
  },
  "room nick": {
    label: "Sortear nuevo apodo",
    usage: "4w room nick SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Sortea un nuevo apodo aleatorio en la sala.",
    examples: ['4w room nick "$SALA"']
  },
  "room register-llm": {
    label: "Registrar agente LLM",
    usage: "4w room register-llm SALA --llm-key CLAVE [--llm-name NOMBRE]",
    details: "Autentica un agente usando la llm_key de la sala.",
    examples: ['4w room register-llm "$SALA" --llm-key "$LLM_KEY" --llm-name claude']
  },
  "room moderate": {
    label: "Moderar sala",
    usage: "4w room moderate SALA <ban|unban|list|verify> --admin-key CLAVE [--nick APODO] [--ban-id ID]",
    details: "Verifica la admin_key, lista bloqueos activos, bloquea o desbloquea participantes.",
    examples: ['4w room moderate "$SALA" list --admin-key "$ADMIN_KEY"']
  },
  mcp: {
    label: "Explorar MCP",
    usage: "4w mcp <list|call> [ARGUMENTOS]",
    details: "Descubre el contrato actual del servidor e invoca herramientas por su nombre.",
    examples: ["4w mcp list", "4w help mcp call"]
  },
  "mcp list": {
    label: "Listar herramientas",
    usage: "4w mcp list",
    details: "Consulta el cat\xE1logo actual y muestra un array JSON con herramientas y esquemas.",
    examples: ["4w mcp list"]
  },
  "mcp call": {
    label: "Llamar herramienta",
    usage: "4w mcp call HERRAMIENTA [OBJETO_JSON|-]",
    details: "Env\xEDa un objeto JSON como argumentos. Por defecto es {}. Use - para leer desde stdin.",
    examples: [`4w mcp call upload_text '{"content":"Hola","burn":true}'`, "4w mcp call chat_participants - < args.json"]
  }
};
function catalogFor(lang) {
  if (lang === "en")
    return topicsEn;
  if (lang === "es")
    return topicsEs;
  return topicsPt;
}
function help(topic, lang = resolveLang()) {
  const dict = catalogFor(lang);
  if (topic) {
    if (!Object.hasOwn(dict, topic)) {
      if (lang === "en")
        throw new Error(`Unknown topic: ${topic}. See 4w --help.`);
      if (lang === "es")
        throw new Error(`Tema desconocido: ${topic}. Consulte 4w --help.`);
      throw new Error(`T\xF3pico desconhecido: ${topic}. Consulte 4w --help.`);
    }
    const entry = dict[topic];
    const children = Object.entries(dict).filter(([key]) => key.startsWith(topic + " "));
    const usageHeading = lang === "en" ? "USAGE" : "USO";
    const examplesHeading = lang === "en" ? "EXAMPLES" : lang === "es" ? "EJEMPLOS" : "EXEMPLOS";
    const subHeading = lang === "en" ? "SUBCOMMANDS" : "SUBCOMANDOS";
    const footer = lang === "en" ? "General help  4w --help" : lang === "es" ? "Ayuda general  4w --help" : "Ajuda geral  4w --help";
    return [
      `4w ${VERSION} \xB7 ${entry.label}`,
      "",
      usageHeading,
      "  " + entry.usage,
      "",
      entry.details,
      "",
      examplesHeading,
      ...entry.examples.map((line) => "  " + line),
      ...children.length ? ["", subHeading, ...children.map(([key, child]) => `  ${key.padEnd(18)} ${child.label}`)] : [],
      "",
      footer
    ].join(`
`);
  }
  if (lang === "en") {
    return `4w ${VERSION} \xB7 FourWords in the terminal

Share text and files with four-word links, collaborate in real-time rooms,
and drive MCP tools in automations. Run 4w with no arguments to open the panel.

USAGE
  4w                            Open the interactive panel
  4w COMMAND [ARGS]             Execute a command and write JSON to stdout
  4w lang [en|ptbr|es]          Show or change and save the interface language
  4w update [--check] [--force] Check for updates and update 4w
  4w help [COMMAND ...]         Show help for a command
  4w --version                  Show installed version

SHARING & VAULT
  4w text TEXT | --file FILE | -       Publish text or Markdown [--burn] [--encrypt]
  4w file FILE                         Publish file up to 24 MiB or 1 GiB [--burn] [--stream] [--encrypt]
  4w get LINK_OR_COMBO                 Fetch or download 4-word link [--output FILE] [--raw] [--key KEY]
  4w delete DELETE_URL                 Destroy content immediately using its secret delete_url
  4w history [--clear]                 List or clear local 24h credentials vault

ROOMS
  4w room create [--doc FILE]          Create a room with optional Markdown and message
  4w room join ROOM                    Join the room
  4w room send ROOM TEXT               Send a chat message
  4w room send-file ROOM FILE          Upload and send a file to the room
  4w room messages ROOM [--since N]    Read messages and track the sequence cursor
  4w room doc ROOM                     Read shared Markdown and current revision
  4w room save ROOM FILE --base N      Save Markdown with optimistic concurrency or rollback
  4w room wait ROOM [--since N]        Long-poll for new messages, @mentions or Markdown edits
  4w room participants ROOM            List active human and LLM participants
  4w room nick ROOM                    Roll a new random nickname
  4w room register-llm ROOM            Authenticate an LLM agent with --llm-key
  4w room moderate ROOM ACTION         Moderate room (ban, unban, list, verify) with --admin-key

MCP & DIAGNOSTICS
  4w mcp list                          List tools and input schemas
  4w mcp call TOOL [JSON|-]            Invoke an MCP tool directly
  4w doctor                            Test connection to FourWords

EXAMPLES
  4w text "Hello, FourWords!"
  4w file "report.pdf" --burn
  4w get lua-gato-sol-rio-123456789 --raw
  4w lang ptbr
  4w help room save

ROOM accepts a room URL or its four-word and nine-digit combo.
FOURWORDS_MCP_URL overrides the MCP endpoint (default ${SITE}/mcp).
Language (default: en) can be persisted via '4w lang <en|ptbr|es>' or overridden via FOURWORDS_LANG.
Install, update and uninstall   ${REPO}`;
  }
  if (lang === "es") {
    return `4w ${VERSION} \xB7 FourWords en la terminal

Comparta texto y archivos con enlaces de cuatro palabras, colabore en salas en
tiempo real y ejecute herramientas MCP. Ejecute 4w sin argumentos para abrir el panel.

USO
  4w                            Abre el panel interactivo
  4w COMANDO [ARGUMENTOS]       Ejecuta un comando y escribe JSON en stdout
  4w lang [en|ptbr|es]          Muestra o cambia y guarda el idioma en esta m\xE1quina
  4w update [--check] [--force] Consulta actualizaciones y actualiza 4w
  4w help [COMANDO ...]         Muestra la ayuda de un comando
  4w --version                  Muestra la versi\xF3n instalada

COMPARTIR Y B\xD3VEDA
  4w text TEXTO | --file ARCHIVO | -   Publica texto o Markdown [--burn] [--encrypt]
  4w file ARCHIVO                      Publica archivo de hasta 24 MiB o 1 GiB [--burn] [--stream] [--encrypt]
  4w get ENLACE_O_CODIGO               Abre o descarga enlace de 4 palabras [--output ARCH] [--raw] [--key CLAVE]
  4w delete URL_DE_DESTRUCCION         Elimina contenido inmediatamente con su delete_url secreta
  4w history [--clear]                 Lista o limpia la b\xF3veda local de claves de las \xFAltimas 24h

SALAS
  4w room create [--doc ARCHIVO]       Crea una sala con Markdown opcional
  4w room join SALA                    Entra en la sala
  4w room send SALA TEXTO              Env\xEDa un mensaje
  4w room send-file SALA ARCHIVO       Env\xEDa un archivo a la sala [--burn]
  4w room messages SALA [--since N]    Lee mensajes y sigue el cursor de secuencia
  4w room doc SALA                     Lee el Markdown compartido y su revisi\xF3n actual
  4w room save SALA ARCHIVO --base N   Guarda Markdown con control de concurrencia
  4w room wait SALA [--since N]        Espera mensajes, @menciones o ediciones en vivo
  4w room participants SALA            Lista participantes humanos y LLMs activos
  4w room nick SALA                    Sortea un nuevo apodo en la sala
  4w room register-llm SALA            Registra agente LLM con --llm-key
  4w room moderate SALA ACCION         Modera la sala (ban, unban, list, verify) con --admin-key

MCP Y DIAGN\xD3STICO
  4w mcp list                          Lista herramientas y esquemas de entrada
  4w mcp call HERRAMIENTA [JSON|-]     Invoca una herramienta MCP directamente
  4w doctor                            Prueba la conexi\xF3n con FourWords

EJEMPLOS
  4w text "\xA1Hola, FourWords!"
  4w file "informe.pdf" --burn
  4w get lua-gato-sol-rio-123456789 --raw
  4w lang es
  4w help room save

SALA acepta el enlace de una sala o su c\xF3digo de cuatro palabras y nueve d\xEDgitos.
FOURWORDS_MCP_URL cambia el endpoint MCP (por defecto ${SITE}/mcp).
El idioma (por defecto: en) se guarda con '4w lang <en|ptbr|es>' o con FOURWORDS_LANG.
Instalaci\xF3n, actualizaci\xF3n y eliminaci\xF3n   ${REPO}`;
  }
  return `4w ${VERSION} \xB7 FourWords no terminal

Compartilhe texto e arquivos com links de quatro palavras, colabore em salas
e use o MCP em automa\xE7\xF5es. Execute 4w sem argumentos para abrir o painel.

USO
  4w                            Abre o painel interativo
  4w COMANDO [ARGUMENTOS]       Executa um comando e escreve o resultado em JSON
  4w lang [en|ptbr|es]          Mostra ou altera e salva o idioma nesta m\xE1quina
  4w update [--check] [--force] Verifica atualiza\xE7\xF5es e atualiza o 4w
  4w help [COMANDO ...]         Abre a ajuda de um comando
  4w --version                  Mostra a vers\xE3o instalada

COMPARTILHAMENTO E COFRE
  4w text TEXTO | --file ARQUIVO | -   Publica texto ou Markdown [--burn] [--encrypt]
  4w file ARQUIVO                      Publica arquivo de at\xE9 24 MiB ou 1 GiB [--burn] [--stream] [--encrypt]
  4w get LINK_OU_COMBO                 Abre ou baixa link de 4 palavras [--output ARQ] [--raw] [--key CHAVE]
  4w delete URL_DE_DESTRUICAO          Apaga conte\xFAdo imediatamente com a delete_url secreta
  4w history [--clear]                 Lista ou limpa o cofre local de chaves das \xFAltimas 24h

SALAS
  4w room create [--doc ARQUIVO]       Cria uma sala com Markdown opcional
  4w room join SALA                    Entra na sala
  4w room send SALA TEXTO              Envia uma mensagem
  4w room send-file SALA ARQUIVO       Envia um arquivo para a sala [--burn]
  4w room messages SALA [--since N]    L\xEA mensagens e acompanha o cursor
  4w room doc SALA                     L\xEA Markdown e a revis\xE3o atual
  4w room save SALA ARQUIVO --base N   Salva Markdown com controle de revis\xE3o
  4w room wait SALA [--since N]        Aguarda mensagens, @men\xE7\xF5es ou edi\xE7\xF5es ao vivo
  4w room participants SALA            Lista participantes humanos e LLMs ativos
  4w room nick SALA                    Sorteia um novo apelido na sala
  4w room register-llm SALA            Registra agente LLM com --llm-key
  4w room moderate SALA ACAO           Modera a sala (ban, unban, list, verify) com --admin-key

MCP E DIAGN\xD3STICO
  4w mcp list                          Lista ferramentas e esquemas de entrada
  4w mcp call FERRAMENTA [JSON|-]      Invoca uma ferramenta do MCP
  4w doctor                            Testa a conex\xE3o com o FourWords

EXEMPLOS
  4w text "Ol\xE1, FourWords!"
  4w file "meu relat\xF3rio.pdf" --burn
  4w get lua-gato-sol-rio-123456789 --raw
  4w lang ptbr
  4w help room save

SALA aceita o link de uma sala ou o c\xF3digo de quatro palavras e nove d\xEDgitos.
--burn ativa a leitura \xFAnica. --encrypt aplica criptografia local AES-256-GCM.
Resultados e chaves saem em JSON no stdout. Erros v\xE3o para stderr com c\xF3digo 1.
FOURWORDS_MCP_URL altera o endpoint MCP. O padr\xE3o \xE9 ${SITE}/mcp.
O idioma (padr\xE3o: en) pode ser salvo com '4w lang <en|ptbr|es>' ou definido via FOURWORDS_LANG.
Instala\xE7\xE3o, atualiza\xE7\xE3o e remo\xE7\xE3o   ${REPO}`;
}
function helpTopic(args) {
  if (args[0] === "help")
    return args.slice(1).join(" ");
  const end = args.indexOf("--");
  const options = end < 0 ? args : args.slice(0, end);
  if (options[0] === "--help" || options[0] === "-h")
    return "";
  const subcommand = ["room", "mcp"].includes(options[0]) && options[1] && !options[1].startsWith("-");
  const offset = subcommand ? 2 : 1;
  if (options.length === offset + 1 && ["--help", "-h"].includes(options[offset])) {
    return options.slice(0, offset).join(" ");
  }
}

// src/commands.ts
var MAX_FILE = 24 * 1024 * 1024;
var MAX_STREAM_FILE = 1024 * 1024 * 1024;
var HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
var ENC_TEXT_PREFIX = "4WENC1:";
var ENC_BIN_MAGIC = new Uint8Array([52, 87, 69, 78, 67, 49, 0]);
function tr(en, ptbr, es = en) {
  const lang = resolveLang();
  if (lang === "ptbr")
    return ptbr;
  if (lang === "es")
    return es;
  return en;
}
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(tr("Expected a JSON object.", "Esperava um objeto JSON.", "Se esperaba un objeto JSON."));
  }
  return value;
}
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
function parseNonNegativeInt(raw, flag) {
  if (raw === undefined)
    return;
  const num = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(num)) {
    throw new Error(tr(`${flag} requires a non-negative integer.`, `${flag} requer um inteiro n\xE3o negativo.`, `${flag} requiere un entero no negativo.`));
  }
  return num;
}
function llmAuth(values) {
  const llm_key = values["llm-key"] ?? process.env.FOURWORDS_LLM_KEY;
  const llm_name = values["llm-name"] ?? process.env.FOURWORDS_LLM_NAME;
  return compact({ llm_key, llm_name });
}
function historyPath() {
  if (process.env.FOURWORDS_HISTORY_FILE)
    return process.env.FOURWORDS_HISTORY_FILE;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join2(process.env.LOCALAPPDATA, "4Words", "CLI", "history.json");
  }
  if (process.env.HOME) {
    return join2(process.env.HOME, ".local", "share", "4words-cli", "history.json");
  }
  return;
}
async function loadHistory() {
  const file = historyPath();
  if (!file)
    return [];
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
      return [];
    const now = Date.now();
    return parsed.filter((item) => Boolean(item && typeof item === "object" && typeof item.created_at === "number" && now - item.created_at <= HISTORY_TTL_MS));
  } catch {
    return [];
  }
}
async function saveHistoryEntry(command, output) {
  if (process.env.FOURWORDS_NO_HISTORY === "1")
    return;
  if (!output || typeof output !== "object" || Array.isArray(output))
    return;
  const data = output;
  const delete_url = typeof data.delete_url === "string" ? data.delete_url : typeof data.deleteUrl === "string" ? data.deleteUrl : undefined;
  const admin_key = typeof data.admin_key === "string" ? data.admin_key : undefined;
  const llm_key = typeof data.llm_key === "string" ? data.llm_key : undefined;
  const url = typeof data.url === "string" ? data.url : undefined;
  const fourwords_url = typeof data.fourwords_url === "string" ? data.fourwords_url : undefined;
  const combo = typeof data.combo === "string" ? data.combo : undefined;
  if (!delete_url && !admin_key && !llm_key && !url)
    return;
  const file = historyPath();
  if (!file)
    return;
  try {
    const current = await loadHistory();
    const entry = compact({
      created_at: Date.now(),
      command,
      url,
      fourwords_url,
      combo,
      delete_url,
      admin_key,
      llm_key,
      encrypted: data.encrypted === true ? true : undefined
    });
    const updated = [entry, ...current].slice(0, 200);
    await mkdir(dirname2(file), { recursive: true, mode: 448 });
    await writeFile(file, JSON.stringify(updated, null, 2), { mode: 384 });
  } catch {}
}
async function encryptBytes(plain) {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    iv,
    ciphertext: new Uint8Array(encrypted),
    keyBase64Url: Buffer.from(rawKey).toString("base64url")
  };
}
async function decryptBytes(iv, ciphertext, keyBase64Url) {
  const rawKey = Buffer.from(keyBase64Url, "base64url");
  if (rawKey.byteLength !== 32 || iv.byteLength !== 12) {
    throw new Error(tr("Invalid key or initialization vector for AES-256-GCM decryption.", "Chave ou vetor de inicializa\xE7\xE3o inv\xE1lido para descriptografia AES-256-GCM.", "Clave o vector de inicializaci\xF3n inv\xE1lido para descifrado AES-256-GCM."));
  }
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    throw new Error(tr("Decryption failed: wrong key or tampered ciphertext.", "Falha ao descriptografar: chave incorreta ou conte\xFAdo adulterado.", "Error al descifrar: clave incorrecta o contenido alterado."));
  }
}
function attachKeyFragment(output, keyBase64Url) {
  if (!output || typeof output !== "object" || Array.isArray(output))
    return output;
  const copy = { ...output, encrypted: true };
  if (typeof copy.url === "string")
    copy.url = `${copy.url.split("#")[0]}#key=${keyBase64Url}`;
  if (typeof copy.fourwords_url === "string")
    copy.fourwords_url = `${copy.fourwords_url.split("#")[0]}#key=${keyBase64Url}`;
  return copy;
}
function unescapeHtml(html) {
  return html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}
function normalizeComboTarget(rawInput, baseEndpoint) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error(tr("Provide a link or 4-word code.", "Informe um link ou c\xF3digo de 4 palavras.", "Indique un enlace o c\xF3digo de 4 palabras."));
  }
  let fragmentKey;
  let withoutHash = trimmed;
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    const hash = trimmed.slice(hashIndex + 1);
    withoutHash = trimmed.slice(0, hashIndex);
    const keyMatch = hash.match(/(?:^|&)key=([A-Za-z0-9_-]+)/);
    if (keyMatch)
      fragmentKey = keyMatch[1];
  }
  const normalizedCombo = withoutHash.replace(/([\p{L}\p{N}]+-[\p{L}\p{N}]+-[\p{L}\p{N}]+-[\p{L}\p{N}]+)-([0-9][0-9\s._-]*[0-9])$/u, (full, words, digits) => {
    const cleanDigits = digits.replace(/[\s._-]+/g, "");
    return cleanDigits.length === 9 ? `${words}-${cleanDigits}` : full;
  });
  if (/^https?:\/\//i.test(normalizedCombo)) {
    const parsed = new URL(normalizedCombo);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (!(parsed.protocol === "https:" || loopback && parsed.protocol === "http:") || parsed.username || parsed.password) {
      throw new Error(tr("URL must use HTTPS or loopback HTTP without credentials.", "A URL deve usar HTTPS ou HTTP em loopback, sem credenciais.", "La URL debe usar HTTPS o HTTP en loopback, sin credenciales."));
    }
    return { targetUrl: parsed, fragmentKey };
  }
  const cleanPath = normalizedCombo.replace(/^\/+/, "");
  const origin = new URL(baseEndpoint.origin);
  return { targetUrl: new URL(`/${cleanPath}`, origin), fragmentKey };
}

class FourWords {
  signal;
  id = 0;
  session;
  protocol = "2025-03-26";
  initialized = false;
  endpoint;
  loopback;
  constructor(signal) {
    this.signal = signal;
    this.endpoint = new URL(process.env.FOURWORDS_MCP_URL || `${SITE}/mcp`);
    this.loopback = ["localhost", "127.0.0.1", "[::1]"].includes(this.endpoint.hostname);
    if (!(this.endpoint.protocol === "https:" || this.loopback && this.endpoint.protocol === "http:") || this.endpoint.username || this.endpoint.password) {
      throw new Error(tr("FOURWORDS_MCP_URL must use HTTPS or loopback HTTP without embedded credentials.", "FOURWORDS_MCP_URL deve usar HTTPS ou HTTP em loopback, sem credenciais na URL.", "FOURWORDS_MCP_URL debe usar HTTPS o HTTP en loopback, sin credenciales en la URL."));
    }
  }
  authHeaders() {
    const token = process.env.FOURWORDS_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  async rpc(method, params, notification = false, stateless = false) {
    const id = notification ? undefined : ++this.id;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.authHeaders()
    };
    if (stateless) {
      headers["MCP-Protocol-Version"] = "2026-07-28";
      headers["Mcp-Method"] = method;
      if (method === "tools/call" && typeof params?.name === "string") {
        headers["Mcp-Name"] = params.name;
      }
    } else {
      if (method !== "initialize")
        headers["MCP-Protocol-Version"] = this.protocol;
      if (this.session)
        headers["Mcp-Session-Id"] = this.session;
    }
    const timeout = AbortSignal.timeout(method === "tools/call" ? 120000 : 30000);
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(tr(`MCP returned HTTP ${response.status} on ${method}.`, `MCP retornou HTTP ${response.status} em ${method}.`, `MCP devolvi\xF3 HTTP ${response.status} en ${method}.`));
    }
    if (method === "initialize")
      this.session = response.headers.get("Mcp-Session-Id") || undefined;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    const message = response.headers.get("Content-Type")?.includes("text/event-stream") ? await readEvent(response, id) : await response.json();
    if (message?.jsonrpc !== "2.0" || message.id !== id) {
      throw new Error(tr("Incompatible JSON-RPC response.", "Resposta JSON-RPC incompat\xEDvel.", "Respuesta JSON-RPC incompatible."));
    }
    if (message.error)
      throw new Error(message.error.message || tr("JSON-RPC error.", "Erro JSON-RPC.", "Error JSON-RPC."));
    if (!("result" in message)) {
      throw new Error(tr("MCP response missing result.", "Resposta MCP sem resultado.", "Respuesta MCP sin resultado."));
    }
    return message.result;
  }
  async initialize() {
    const server = record(await this.rpc("initialize", {
      protocolVersion: this.protocol,
      capabilities: {},
      clientInfo: { name: "4w", version: VERSION }
    }));
    if (typeof server.protocolVersion !== "string") {
      throw new Error(tr("MCP did not report a protocol version.", "MCP n\xE3o informou a vers\xE3o do protocolo.", "El MCP no inform\xF3 la versi\xF3n del protocolo."));
    }
    this.protocol = server.protocolVersion;
    await this.rpc("notifications/initialized", undefined, true);
    this.initialized = true;
    return server;
  }
  canUseStateless() {
    if (process.env.FOURWORDS_STATELESS === "1")
      return true;
    if (process.env.FOURWORDS_STATELESS === "0")
      return false;
    return !this.loopback && !this.initialized;
  }
  async list() {
    const tools = [];
    const cursors = new Set;
    let cursor;
    const stateless = this.canUseStateless();
    do {
      const page = record(await this.rpc("tools/list", cursor ? { cursor } : undefined, false, stateless && !cursor));
      if (!Array.isArray(page.tools)) {
        throw new Error(tr("MCP returned an invalid tool list.", "O MCP retornou uma lista de ferramentas inv\xE1lida.", "El MCP devolvi\xF3 una lista de herramientas inv\xE1lida."));
      }
      tools.push(...page.tools);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (cursor && cursors.has(cursor)) {
        throw new Error(tr("Repeated MCP cursor.", "Cursor MCP repetido.", "Cursor MCP repetido."));
      }
      if (cursor)
        cursors.add(cursor);
    } while (cursor);
    return tools;
  }
  async call(name, args) {
    const stateless = this.canUseStateless();
    const result = record(await this.rpc("tools/call", { name, arguments: args }, false, stateless));
    const content = Array.isArray(result.content) ? result.content : [];
    if (result.isError) {
      const message = content.find((item) => item?.type === "text")?.text;
      throw new Error(typeof message === "string" ? message : tr(`MCP rejected ${name}.`, `O MCP recusou ${name}.`, `El MCP rechaz\xF3 ${name}.`));
    }
    const text = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
    let output = result.structuredContent ?? result;
    if (result.structuredContent === undefined && typeof text === "string") {
      try {
        output = JSON.parse(text);
      } catch {
        output = text;
      }
    }
    if (output && typeof output === "object" && "conflict" in output && output.conflict) {
      throw new Error(tr("The document changed during editing (conflict). Run 4w room doc, merge changes, and try again.", "O documento mudou durante a edi\xE7\xE3o. Rode 4w room doc, incorpore as mudan\xE7as e tente novamente.", "El documento cambi\xF3 durante la edici\xF3n. Ejecute 4w room doc, incorpore los cambios e intente de nuevo."));
    }
    if (output && typeof output === "object" && "ok" in output && output.ok === false) {
      const detail = "error" in output && typeof output.error === "string" ? output.error : tr("operation rejected", "opera\xE7\xE3o recusada", "operaci\xF3n rechazada");
      throw new Error(`${name}: ${detail}`);
    }
    return output;
  }
  async uploadFileStream(filename, body, burn, contentType = "application/octet-stream") {
    const uploadUrl = new URL("/api/upload/file", this.endpoint.origin);
    uploadUrl.searchParams.set("name", filename);
    if (burn)
      uploadUrl.searchParams.set("burn", "1");
    const timeout = AbortSignal.timeout(600000);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        ...this.authHeaders()
      },
      redirect: "error",
      body,
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(tr(`Streaming upload returned HTTP ${response.status}.`, `Upload via streaming retornou HTTP ${response.status}.`, `Subida por streaming devolvi\xF3 HTTP ${response.status}.`));
    }
    const payload = record(await response.json());
    const delete_url = typeof payload.delete_url === "string" ? payload.delete_url : typeof payload.deleteUrl === "string" ? payload.deleteUrl : undefined;
    const expires_at = typeof payload.expires_at === "string" ? payload.expires_at : typeof payload.expiresAt === "number" ? new Date(payload.expiresAt).toISOString() : undefined;
    return compact({
      ...payload,
      delete_url,
      expires_at,
      burn
    });
  }
}
async function readEvent(response, id) {
  if (!response.body)
    throw new Error(tr("Empty MCP stream.", "Fluxo MCP vazio.", "Flujo MCP vac\xEDo."));
  const reader = response.body.pipeThrough(new TextDecoderStream).getReader();
  let buffer = "";
  try {
    for (;; ) {
      const { value, done } = await reader.read();
      buffer += value ?? "";
      if (done && buffer)
        buffer += `

`;
      for (let end = buffer.match(/\r?\n\r?\n/);end; end = buffer.match(/\r?\n\r?\n/)) {
        const data = buffer.slice(0, end.index).split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join(`
`);
        buffer = buffer.slice(end.index + end[0].length);
        if (data) {
          const candidate = JSON.parse(data);
          if (candidate.id === id)
            return candidate;
        }
      }
      if (done) {
        throw new Error(tr("MCP stream ended without the expected response.", "Fluxo MCP terminou sem a resposta esperada.", "El flujo MCP termin\xF3 sin la respuesta esperada."));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function fileStatSize(path, limit) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      throw new Error(tr("Provide a regular file.", "Informe um arquivo regular.", "Indique un archivo regular."));
    if (stat.size > limit) {
      throw new Error(tr(`File exceeds the ${limit} byte limit.`, `Arquivo excede o limite de ${limit} bytes.`, `El archivo supera el l\xEDmite de ${limit} bytes.`));
    }
    return stat.size;
  } finally {
    await file.close();
  }
}
async function fileBytes(path, limit) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      throw new Error(tr("Provide a regular file.", "Informe um arquivo regular.", "Indique un archivo regular."));
    if (stat.size > limit) {
      throw new Error(tr(`File exceeds the ${limit} byte limit.`, `Arquivo excede o limite de ${limit} bytes.`, `El archivo supera el l\xEDmite de ${limit} bytes.`));
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead)
        break;
      offset += bytesRead;
    }
    if (offset !== stat.size) {
      throw new Error(tr("File size changed while reading. Please try again.", "O tamanho do arquivo mudou durante a leitura. Tente novamente.", "El tama\xF1o del archivo cambi\xF3 durante la lectura. Intente de nuevo."));
    }
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}
async function readText(path, limit = 1e5, input) {
  if (path === "-" && input !== undefined) {
    if (Buffer.byteLength(input) > limit) {
      throw new Error(tr(`Input exceeds ${limit} bytes.`, `A entrada excede ${limit} bytes.`, `La entrada supera ${limit} bytes.`));
    }
    return input;
  }
  if (path !== "-")
    return new TextDecoder("utf-8", { fatal: true }).decode(await fileBytes(path, limit));
  const parts = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      throw new Error(tr(`Input exceeds ${limit} bytes.`, `A entrada excede ${limit} bytes.`, `La entrada supera ${limit} bytes.`));
    }
    parts.push(bytes);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
}
function exact(values, count, usage) {
  if (values.length !== count)
    throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w ${usage}`);
}
function hasBinaryMagic(bytes) {
  if (bytes.byteLength < ENC_BIN_MAGIC.byteLength + 12 + 16)
    return false;
  for (let i = 0;i < ENC_BIN_MAGIC.byteLength; i++) {
    if (bytes[i] !== ENC_BIN_MAGIC[i])
      return false;
  }
  return true;
}
async function fetchFourWordsLink(mcp, rawTarget, options, signal) {
  const { targetUrl, fragmentKey } = normalizeComboTarget(rawTarget, mcp.endpoint);
  const key = options.key ?? fragmentKey;
  const timeout = AbortSignal.timeout(120000);
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Accept: "text/html, text/plain, application/octet-stream, */*"
    },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(tr(`Failed to fetch ${targetUrl.pathname}: HTTP ${response.status}.`, `Falha ao acessar ${targetUrl.pathname}: HTTP ${response.status}.`, `Error al acceder a ${targetUrl.pathname}: HTTP ${response.status}.`));
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (contentType.includes("text/html")) {
    const html = await response.text();
    const storedMatch = html.match(/<pre[^>]*class="stored"[^>]*>([\s\S]*?)<\/pre>/i);
    if (!storedMatch) {
      throw new Error(tr("Content not found or link expired.", "Conte\xFAdo n\xE3o encontrado ou link expirado.", "Contenido no encontrado o enlace expirado."));
    }
    let text = unescapeHtml(storedMatch[1]);
    let decrypted = false;
    if (text.startsWith(ENC_TEXT_PREFIX)) {
      if (!key) {
        throw new Error(tr("Encrypted content. Provide the URL with #key= or pass --key KEY.", "Conte\xFAdo criptografado. Informe a URL com #key= ou use --key CHAVE.", "Contenido cifrado. Indique la URL con #key= o use --key CLAVE."));
      }
      const parts = text.slice(ENC_TEXT_PREFIX.length).split(":");
      if (parts.length !== 2) {
        throw new Error(tr("Invalid encrypted text format.", "Formato de texto criptografado inv\xE1lido.", "Formato de texto cifrado inv\xE1lido."));
      }
      const iv = Buffer.from(parts[0], "base64url");
      const cipher = Buffer.from(parts[1], "base64url");
      const plainBytes = await decryptBytes(iv, cipher, key);
      text = new TextDecoder("utf-8", { fatal: true }).decode(plainBytes);
      decrypted = true;
    }
    if (options.output) {
      await writeFile(options.output, text, "utf8");
    }
    return compact({
      ok: true,
      url: targetUrl.href,
      type: "text",
      decrypted: decrypted ? true : undefined,
      saved_to: options.output,
      content: text,
      __raw: options.raw ? text : undefined
    });
  }
  let bytes = new Uint8Array(await response.arrayBuffer());
  let decrypted = false;
  if (hasBinaryMagic(bytes)) {
    if (!key) {
      throw new Error(tr("Encrypted file. Provide the URL with #key= or pass --key KEY.", "Arquivo criptografado. Informe a URL com #key= ou use --key CHAVE.", "Archivo cifrado. Indique la URL con #key= o use --key CLAVE."));
    }
    const ivStart = ENC_BIN_MAGIC.byteLength;
    const iv = bytes.subarray(ivStart, ivStart + 12);
    const cipher = bytes.subarray(ivStart + 12);
    bytes = await decryptBytes(iv, cipher, key);
    decrypted = true;
  } else if (contentType.includes("text/plain")) {
    const maybeText = new TextDecoder("utf-8").decode(bytes);
    if (maybeText.startsWith(ENC_TEXT_PREFIX)) {
      if (!key) {
        throw new Error(tr("Encrypted content. Provide the URL with #key= or pass --key KEY.", "Conte\xFAdo criptografado. Informe a URL com #key= ou use --key CHAVE.", "Contenido cifrado. Indique la URL con #key= o use --key CLAVE."));
      }
      const parts = maybeText.slice(ENC_TEXT_PREFIX.length).split(":");
      if (parts.length !== 2) {
        throw new Error(tr("Invalid encrypted text format.", "Formato de texto criptografado inv\xE1lido.", "Formato de texto cifrado inv\xE1lido."));
      }
      const iv = Buffer.from(parts[0], "base64url");
      const cipher = Buffer.from(parts[1], "base64url");
      bytes = await decryptBytes(iv, cipher, key);
      decrypted = true;
    }
  }
  if (options.output) {
    await writeFile(options.output, bytes);
  }
  const isText = contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("markdown");
  const textContent = isText ? new TextDecoder("utf-8").decode(bytes) : undefined;
  return compact({
    ok: true,
    url: targetUrl.href,
    type: isText ? "text" : "file",
    content_type: contentType,
    size: bytes.byteLength,
    decrypted: decrypted ? true : undefined,
    saved_to: options.output,
    content: options.output ? undefined : textContent,
    content_base64: !options.output && !isText ? Buffer.from(bytes).toString("base64") : undefined,
    __raw: options.raw ? textContent ?? Buffer.from(bytes) : undefined
  });
}
async function fetchLatestVersion(signal) {
  const updateUrl = process.env.FOURWORDS_UPDATE_URL || "https://raw.githubusercontent.com/4words/4w-cli/main/package.json";
  const res = await fetch(updateUrl, { signal });
  if (!res.ok) {
    throw new Error(tr(`Failed to check for updates (HTTP ${res.status}).`, `Falha ao verificar atualiza\xE7\xF5es (HTTP ${res.status}).`, `Error al verificar actualizaciones (HTTP ${res.status}).`));
  }
  const data = await res.json();
  if (!data?.version || typeof data.version !== "string") {
    throw new Error(tr("Invalid release metadata received from repository.", "Metadados de release inv\xE1lidos recebidos do reposit\xF3rio.", "Metadatos de versi\xF3n no v\xE1lidos recibidos del repositorio."));
  }
  return { version: data.version, url: updateUrl };
}
async function handleUpdate(values, signal) {
  const { version: latestVersion } = await fetchLatestVersion(signal);
  const isNewer = compareSemver(latestVersion, VERSION) > 0;
  if (values.check) {
    return {
      ok: true,
      current_version: VERSION,
      latest_version: latestVersion,
      update_available: isNewer,
      command: isNewer ? "4w update" : undefined,
      message: isNewer ? tr(`A new version of 4w is available (${VERSION} -> ${latestVersion}). Run '4w update' to install.`, `Uma nova vers\xE3o do 4w est\xE1 dispon\xEDvel (${VERSION} -> ${latestVersion}). Execute '4w update' para instalar.`, `Hay una nueva versi\xF3n de 4w disponible (${VERSION} -> ${latestVersion}). Ejecute '4w update' para instalar.`) : tr(`4w is already at the latest version (${VERSION}).`, `O 4w j\xE1 est\xE1 na vers\xE3o mais recente (${VERSION}).`, `4w ya est\xE1 en la versi\xF3n m\xE1s reciente (${VERSION}).`)
    };
  }
  if (!isNewer && !values.force) {
    return {
      ok: true,
      current_version: VERSION,
      latest_version: latestVersion,
      update_available: false,
      message: tr(`4w is already at the latest version (${VERSION}). Use --force to reinstall.`, `O 4w j\xE1 est\xE1 na vers\xE3o mais recente (${VERSION}). Use --force para reinstalar.`, `4w ya est\xE1 en la versi\xF3n m\xE1s reciente (${VERSION}). Use --force para reinstalar.`)
    };
  }
  const isWindows = process.platform === "win32";
  const defaultScriptUrl = isWindows ? "https://raw.githubusercontent.com/4words/4w-cli/main/install.ps1" : "https://raw.githubusercontent.com/4words/4w-cli/main/install.sh";
  const scriptUrl = process.env.FOURWORDS_INSTALLER_URL || defaultScriptUrl;
  let scriptPath = process.env.FOURWORDS_INSTALLER_SCRIPT;
  let tempDirToClean;
  if (!scriptPath) {
    const res = await fetch(scriptUrl, { signal });
    if (!res.ok) {
      throw new Error(tr(`Failed to download installer from ${scriptUrl} (HTTP ${res.status}).`, `Falha ao baixar o instalador de ${scriptUrl} (HTTP ${res.status}).`, `Error al descargar el instalador desde ${scriptUrl} (HTTP ${res.status}).`));
    }
    const scriptContent = await res.text();
    const tmpBase = await mkdtemp(join2(tmpdir(), "4w-update-"));
    tempDirToClean = tmpBase;
    scriptPath = join2(tmpBase, isWindows ? "install.ps1" : "install.sh");
    await writeFile(scriptPath, scriptContent, { mode: 448 });
  }
  try {
    let result;
    if (isWindows) {
      const proc = spawnSync("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
        encoding: "utf8",
        env: { ...process.env }
      });
      result = { status: proc.status, stdout: proc.stdout || "", stderr: proc.stderr || "" };
    } else {
      const proc = spawnSync("sh", [scriptPath], {
        encoding: "utf8",
        env: { ...process.env }
      });
      result = { status: proc.status, stdout: proc.stdout || "", stderr: proc.stderr || "" };
    }
    if (result.status !== 0) {
      const errMsg = result.stderr.trim() || result.stdout.trim() || `Installer exited with code ${result.status}`;
      throw new Error(tr(`Update failed: ${errMsg}`, `Atualiza\xE7\xE3o falhou: ${errMsg}`, `La actualizaci\xF3n fall\xF3: ${errMsg}`));
    }
    return {
      ok: true,
      previous_version: VERSION,
      updated_version: latestVersion,
      message: tr(`Successfully updated 4w from ${VERSION} to ${latestVersion}.`, `4w atualizado com sucesso de ${VERSION} para ${latestVersion}.`, `4w actualizado con \xE9xito de ${VERSION} a ${latestVersion}.`),
      output: result.stdout.trim()
    };
  } finally {
    if (tempDirToClean) {
      await rm(tempDirToClean, { recursive: true, force: true }).catch(() => {});
    }
  }
}
async function execute(args, signal, input) {
  const [command, ...rest] = args;
  let invoke;
  let forceInitialize = false;
  let skipMcp = false;
  if (command === "doctor") {
    exact(rest, 0, "doctor");
    forceInitialize = true;
    invoke = async (mcp) => ({ ok: true, version: VERSION, tools: (await mcp.list()).length });
  } else if (command === "update") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        check: { type: "boolean" },
        force: { type: "boolean" }
      }
    });
    exact(positionals, 0, "update [--check] [--force]");
    skipMcp = true;
    invoke = () => handleUpdate(values, signal);
  } else if (command === "lang") {
    if (rest.length > 1)
      throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w lang [en|ptbr|es]`);
    skipMcp = true;
    invoke = async () => {
      if (rest.length === 0) {
        return {
          ok: true,
          lang: resolveLang(),
          saved: readSavedLang() ?? null,
          available: ["en", "ptbr", "es"],
          config_file: configPath() ?? null
        };
      }
      const target = normalizeLang(rest[0]);
      if (!target) {
        throw new Error(`Invalid language / Idioma inv\xE1lido: ${rest[0]}. Use: en, ptbr, es.`);
      }
      const config_file = saveLang(target) ?? null;
      const messages = {
        en: "Default language updated and saved on this machine: English (en).",
        ptbr: "Idioma padr\xE3o alterado e salvo nesta m\xE1quina: Portugu\xEAs (ptbr).",
        es: "Idioma predeterminado cambiado y guardado en esta m\xE1quina: Espa\xF1ol (es)."
      };
      return {
        ok: true,
        lang: target,
        saved: true,
        available: ["en", "ptbr", "es"],
        config_file,
        message: messages[target]
      };
    };
  } else if (command === "history") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { clear: { type: "boolean" } }
    });
    exact(positionals, 0, "history [--clear]");
    skipMcp = true;
    invoke = async () => {
      if (values.clear) {
        const file = historyPath();
        if (file)
          await rm(file, { force: true }).catch(() => {});
        return { ok: true, cleared: true };
      }
      const items = await loadHistory();
      return { ok: true, count: items.length, items };
    };
  } else if (command === "get") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        raw: { type: "boolean" },
        key: { type: "string" }
      }
    });
    exact(positionals, 1, "get LINK_OR_COMBO [--output FILE] [--raw] [--key KEY]");
    skipMcp = true;
    invoke = (mcp) => fetchFourWordsLink(mcp, positionals[0], values, signal);
  } else if (command === "delete") {
    exact(rest, 1, "delete DELETE_URL");
    invoke = (mcp) => mcp.call("delete_content", { delete_url: rest[0] });
  } else if (command === "text" || command === "file") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        burn: { type: "boolean" },
        "no-burn": { type: "boolean" },
        encrypt: { type: "boolean" },
        ...command === "text" ? { file: { type: "string" } } : { stream: { type: "boolean" }, type: { type: "string" } }
      }
    });
    const burn = values["no-burn"] ? false : values.burn ?? true;
    const encrypt = values.encrypt ?? false;
    if (command === "file") {
      exact(positionals, 1, "file FILE [--burn|--no-burn] [--stream] [--encrypt] [--type MIME]");
      const path = positionals[0];
      const useStreamFlag = Boolean(values.stream);
      const mimeType = typeof values.type === "string" ? values.type : undefined;
      const size = await fileStatSize(path, MAX_STREAM_FILE);
      if (!encrypt && (useStreamFlag || size > MAX_FILE)) {
        skipMcp = true;
        invoke = async (mcp) => {
          const stream = typeof Bun !== "undefined" ? Bun.file(path).stream() : await fileBytes(path, MAX_STREAM_FILE);
          return mcp.uploadFileStream(basename(path), stream, burn, mimeType);
        };
      } else {
        const rawBytes = await fileBytes(path, encrypt ? MAX_FILE - 64 : MAX_FILE);
        let payloadBytes = rawBytes;
        let keyBase64Url;
        if (encrypt) {
          const enc = await encryptBytes(rawBytes);
          keyBase64Url = enc.keyBase64Url;
          payloadBytes = Buffer.concat([Buffer.from(ENC_BIN_MAGIC), Buffer.from(enc.iv), Buffer.from(enc.ciphertext)]);
        }
        if (useStreamFlag) {
          skipMcp = true;
          invoke = async (mcp) => {
            const out = await mcp.uploadFileStream(basename(path), payloadBytes, burn, mimeType);
            return keyBase64Url ? attachKeyFragment(out, keyBase64Url) : out;
          };
        } else {
          const content_base64 = Buffer.from(payloadBytes).toString("base64");
          invoke = async (mcp) => {
            const out = await mcp.call("upload_file", compact({
              filename: basename(path),
              content_base64,
              content_type: mimeType,
              burn
            }));
            return keyBase64Url ? attachKeyFragment(out, keyBase64Url) : out;
          };
        }
      }
    } else {
      const path = typeof values.file === "string" ? values.file : undefined;
      exact(positionals, path === undefined ? 1 : 0, "text TEXT|-|--file FILE [--burn|--no-burn] [--encrypt]");
      let content = path !== undefined ? await readText(path, 1e5, input) : positionals[0] === "-" ? await readText("-", 1e5, input) : positionals[0];
      if (!content.trim() || Buffer.byteLength(content) > 1e5) {
        throw new Error(tr("Provide UTF-8 text from 1 to 100,000 bytes.", "Informe texto UTF-8 de 1 a 100.000 bytes.", "Indique texto UTF-8 de 1 a 100.000 bytes."));
      }
      let keyBase64Url;
      if (encrypt) {
        const enc = await encryptBytes(new TextEncoder().encode(content));
        keyBase64Url = enc.keyBase64Url;
        content = `${ENC_TEXT_PREFIX}${Buffer.from(enc.iv).toString("base64url")}:${Buffer.from(enc.ciphertext).toString("base64url")}`;
      }
      invoke = async (mcp) => {
        const out = await mcp.call("upload_text", { content, burn });
        return keyBase64Url ? attachKeyFragment(out, keyBase64Url) : out;
      };
    }
  } else if (command === "room") {
    const [action, ...roomArgs] = rest;
    const llmOptions = {
      "llm-key": { type: "string" },
      "llm-name": { type: "string" }
    };
    if (action === "create") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          doc: { type: "string" },
          message: { type: "string" },
          "llm-name": { type: "string" }
        }
      });
      exact(positionals, 0, "room create [--doc FILE] [--message TEXT] [--llm-name NAME]");
      const initial_markdown = values.doc === undefined ? undefined : await readText(values.doc, 200000, input);
      if (initial_markdown && initial_markdown.length > 50000) {
        throw new Error(tr("Markdown exceeds 50,000 UTF-16 code units.", "Markdown excede 50.000 unidades UTF-16.", "El Markdown supera las 50.000 unidades UTF-16."));
      }
      const initial_message = values.message;
      const llm_name = values["llm-name"] ?? process.env.FOURWORDS_LLM_NAME;
      const createArgs = { initial_markdown };
      if (initial_message !== undefined)
        createArgs.initial_message = initial_message;
      if (llm_name !== undefined)
        createArgs.llm_name = llm_name;
      invoke = (mcp) => mcp.call("chat_create", createArgs);
    } else if (action === "messages") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          since: { type: "string" },
          "mentions-only": { type: "boolean" },
          nick: { type: "string" },
          ...llmOptions
        }
      });
      exact(positionals, 1, "room messages ROOM [--since N] [--mentions-only] [--nick NICK]");
      const since = parseNonNegativeInt(values.since, "--since");
      const extra = compact({
        mentions_only: values["mentions-only"],
        nick: values.nick,
        ...llmAuth(values)
      });
      invoke = (mcp) => mcp.call("chat_messages", { url: positionals[0], since, ...extra });
    } else if (action === "join" || action === "doc" || action === "participants" || action === "nick") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: llmOptions
      });
      exact(positionals, 1, `room ${action} ROOM`);
      const toolMap = {
        join: "chat_join",
        doc: "chat_get_doc",
        participants: "chat_participants",
        nick: "chat_roll_nick"
      };
      invoke = (mcp) => mcp.call(toolMap[action], { url: positionals[0], ...llmAuth(values) });
    } else if (action === "register-llm") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: llmOptions
      });
      exact(positionals, 1, "room register-llm ROOM --llm-key KEY [--llm-name NAME]");
      const auth = llmAuth(values);
      if (typeof auth.llm_key !== "string" || !auth.llm_key.trim()) {
        throw new Error(tr("Provide --llm-key or set FOURWORDS_LLM_KEY.", "Informe --llm-key ou defina FOURWORDS_LLM_KEY.", "Indique --llm-key o defina FOURWORDS_LLM_KEY."));
      }
      invoke = (mcp) => mcp.call("chat_register_llm", { url: positionals[0], ...auth });
    } else if (action === "send") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          nick: { type: "string" },
          ...llmOptions
        }
      });
      exact(positionals, 2, "room send ROOM TEXT [--nick NICK]");
      const extra = compact({ nick: values.nick, ...llmAuth(values) });
      invoke = (mcp) => mcp.call("chat_send", { url: positionals[0], text: positionals[1], ...extra });
    } else if (action === "send-file") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          text: { type: "string" },
          nick: { type: "string" },
          burn: { type: "boolean" },
          "no-burn": { type: "boolean" },
          ...llmOptions
        }
      });
      exact(positionals, 2, "room send-file ROOM FILE [--text MESSAGE] [--burn|--no-burn]");
      const [url, filePath] = positionals;
      const content_base64 = (await fileBytes(filePath, MAX_FILE)).toString("base64");
      const burn = values["no-burn"] ? false : values.burn ?? true;
      const extra = compact({
        text: values.text,
        nick: values.nick,
        burn,
        ...llmAuth(values)
      });
      invoke = (mcp) => mcp.call("chat_send_file", {
        url,
        filename: basename(filePath),
        content_base64,
        ...extra
      });
    } else if (action === "save") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          base: { type: "string" },
          "rollback-version": { type: "string" },
          "rollback-ts": { type: "string" },
          "export-link": { type: "boolean" },
          nick: { type: "string" },
          ...llmOptions
        }
      });
      const rollback_to_version = parseNonNegativeInt(values["rollback-version"], "--rollback-version");
      const rollback_to_ts = parseNonNegativeInt(values["rollback-ts"], "--rollback-ts");
      const isRollback = rollback_to_version !== undefined || rollback_to_ts !== undefined;
      if (isRollback) {
        if (positionals.length < 1 || positionals.length > 2) {
          throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w room save ROOM [FILE] [--base N] [--rollback-version V | --rollback-ts TS]`);
        }
        const base_updated_at = parseNonNegativeInt(values.base, "--base");
        const content = positionals[1] ? await readText(positionals[1], 200000, input) : undefined;
        if (content && content.length > 50000) {
          throw new Error(tr("Markdown exceeds 50,000 UTF-16 code units.", "Markdown excede 50.000 unidades UTF-16.", "El Markdown supera las 50.000 unidades UTF-16."));
        }
        const saveArgs = compact({
          url: positionals[0],
          content,
          base_updated_at,
          rollback_to_version,
          rollback_to_ts,
          export_fourwords_link: values["export-link"],
          nick: values.nick,
          ...llmAuth(values)
        });
        invoke = (mcp) => mcp.call("chat_save_doc", saveArgs);
      } else {
        exact(positionals, 2, "room save ROOM FILE --base N");
        const base_updated_at = Number(values.base);
        if (values.base === undefined || !/^\d+$/.test(values.base) || !Number.isSafeInteger(base_updated_at)) {
          throw new Error(tr("Provide --base with the updated_at from 4w room doc. Use 0 for an unrevised room.", "Informe --base com o updated_at de 4w room doc. Use 0 para uma sala sem revis\xE3o.", "Indique --base con el updated_at de 4w room doc. Use 0 para una sala sin revisi\xF3n."));
        }
        const content = await readText(positionals[1], 200000, input);
        if (content.length > 50000) {
          throw new Error(tr("Markdown exceeds 50,000 UTF-16 code units.", "Markdown excede 50.000 unidades UTF-16.", "El Markdown supera las 50.000 unidades UTF-16."));
        }
        const extra = compact({
          export_fourwords_link: values["export-link"],
          nick: values.nick,
          ...llmAuth(values)
        });
        invoke = (mcp) => mcp.call("chat_save_doc", { url: positionals[0], content, base_updated_at, ...extra });
      }
    } else if (action === "wait") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          since: { type: "string" },
          "since-doc": { type: "string" },
          "no-watch-doc": { type: "boolean" },
          timeout: { type: "string" },
          "mentions-only": { type: "boolean" },
          all: { type: "boolean" },
          nick: { type: "string" },
          ...llmOptions
        }
      });
      exact(positionals, 1, "room wait ROOM [--since N] [--since-doc TS] [--timeout S] [--all]");
      const since = parseNonNegativeInt(values.since, "--since");
      const since_doc_ts = parseNonNegativeInt(values["since-doc"], "--since-doc");
      const timeout_seconds = parseNonNegativeInt(values.timeout, "--timeout");
      if (timeout_seconds !== undefined && (timeout_seconds < 1 || timeout_seconds > 25)) {
        throw new Error(tr("--timeout must be between 1 and 25 seconds.", "--timeout deve estar entre 1 e 25 segundos.", "--timeout debe estar entre 1 y 25 segundos."));
      }
      const mentions_only = values.all ? false : values["mentions-only"];
      const watch_doc = values["no-watch-doc"] ? false : undefined;
      invoke = (mcp) => mcp.call("chat_wait_events", compact({
        url: positionals[0],
        since,
        since_doc_ts,
        watch_doc,
        timeout_seconds,
        mentions_only,
        nick: values.nick,
        ...llmAuth(values)
      }));
    } else if (action === "moderate") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          "admin-key": { type: "string" },
          nick: { type: "string" },
          "ban-id": { type: "string" },
          ...llmOptions
        }
      });
      exact(positionals, 2, "room moderate ROOM <ban|unban|list|verify> --admin-key KEY [--nick NICK] [--ban-id ID]");
      const [url, modAction] = positionals;
      if (!["ban", "unban", "list", "verify"].includes(modAction)) {
        throw new Error(tr("Invalid moderation action. Use ban, unban, list, or verify.", "A\xE7\xE3o de modera\xE7\xE3o inv\xE1lida. Use ban, unban, list ou verify.", "Acci\xF3n de moderaci\xF3n inv\xE1lida. Use ban, unban, list o verify."));
      }
      const admin_key = values["admin-key"] ?? process.env.FOURWORDS_ADMIN_KEY;
      if (!admin_key || !admin_key.trim()) {
        throw new Error(tr("Provide --admin-key or set FOURWORDS_ADMIN_KEY.", "Informe --admin-key ou defina FOURWORDS_ADMIN_KEY.", "Indique --admin-key o defina FOURWORDS_ADMIN_KEY."));
      }
      invoke = (mcp) => mcp.call("chat_moderate", compact({
        url,
        action: modAction,
        admin_key,
        nick: values.nick,
        ban_id: values["ban-id"],
        ...llmAuth(values)
      }));
    } else {
      throw new Error(tr("Unknown room action. See 4w --help.", "A\xE7\xE3o de sala desconhecida. Consulte 4w --help.", "Acci\xF3n de sala desconocida. Consulte 4w --help."));
    }
  } else if (command === "mcp") {
    if (rest[0] === "list") {
      exact(rest, 1, "mcp list");
      invoke = (mcp) => mcp.list();
    } else if (rest[0] === "call" && rest.length >= 2 && rest.length <= 3) {
      const [, name, raw = "{}"] = rest;
      const params = record(JSON.parse(raw === "-" ? await readText("-", 40 * 1024 * 1024, input) : raw));
      invoke = (mcp) => mcp.call(name, params);
    } else
      throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w mcp list | 4w mcp call TOOL [JSON|-]`);
  } else {
    throw new Error(tr(`Unknown command: ${command}. See 4w --help.`, `Comando desconhecido: ${command}. Consulte 4w --help.`, `Comando desconocido: ${command}. Consulte 4w --help.`));
  }
  const mcp = new FourWords(signal);
  if (!skipMcp && (forceInitialize || mcp.loopback && process.env.FOURWORDS_STATELESS !== "1" || process.env.FOURWORDS_STATELESS === "0")) {
    await mcp.initialize();
  }
  const output = await invoke(mcp);
  const fullCommand = command === "room" && rest[0] ? `room ${rest[0]}` : command;
  await saveHistoryEntry(fullCommand, output);
  return output;
}

// src/tui.ts
import { emitKeypressEvents } from "readline";

// src/tui-model.ts
var burnFlag = (values) => values.burn === "off" ? ["--no-burn"] : ["--burn"];
var encryptFlag = (values) => values.encrypt === "on" ? ["--encrypt"] : [];
var streamFlag = (values) => values.stream === "on" ? ["--stream"] : [];
var llmFlags = (values) => [
  ...values.llm_key?.trim() ? ["--llm-key", values.llm_key.trim()] : [],
  ...values.llm_name?.trim() ? ["--llm-name", values.llm_name.trim()] : []
];
var copyByLang = {
  en: {
    secPublish: "PUBLISH",
    secRooms: "ROOMS",
    secTools: "TOOLS",
    roomLabel: "Room",
    roomHint: "Room URL or four-word code",
    burnLabel: "Burn after reading",
    burnHint: "The link expires after the first read",
    encryptLabel: "Zero-Knowledge Encryption",
    encryptHint: "Encrypts locally with AES-256-GCM and appends #key= to the link",
    streamLabel: "Streaming upload (up to 1 GiB)",
    streamHint: "Uploads via PUT /api/upload/file bypassing the 24 MiB MCP limit",
    fileLabel: "File path",
    fileHint: "Paste the path without quotes",
    llmKeyLabel: "LLM Key (optional)",
    llmKeyHint: "fwllm_... to authenticate as an agent",
    llmNameLabel: "LLM Agent Name (optional)",
    llmNameHint: "e.g., claude, gemini, cursor",
    textTitle: "Publish text",
    textDesc: "Create a four-word link for text or Markdown. Use burn-after-reading when the link should expire once opened.",
    textField: "Text or Markdown",
    fileTitle: "Publish file",
    fileDesc: "Select a local file (up to 24 MiB via MCP or 1 GiB via streaming) and receive a four-word share link.",
    roomCreateTitle: "Create room",
    roomCreateDesc: "Open a collaborative room and optionally initialize the shared Markdown document.",
    initialMd: "Initial Markdown",
    initialMsg: "Initial message",
    optional: "Optional",
    roomJoinTitle: "Join room",
    roomJoinDesc: "Register your entry and view your nickname and initial room state.",
    roomMessagesTitle: "Read messages",
    roomMessagesDesc: "Read message history or provide a sequence cursor to fetch only newer messages.",
    sinceLabel: "From sequence",
    sinceHint: "Optional. Use the cursor from the previous query.",
    mentionsLabel: "Only @mentions",
    roomSendTitle: "Send message",
    roomSendDesc: "Write and post a message to an existing room.",
    msgLabel: "Message",
    roomDocTitle: "Read Markdown",
    roomDocDesc: "Read the shared document and keep the revision number for subsequent edits.",
    roomSaveTitle: "Save Markdown",
    roomSaveDesc: "Edit the document and save over the revision you read. Concurrent edits prevent overwriting.",
    baseLabel: "Base revision",
    baseHint: "Document updated_at. Use 0 for an unrevised document.",
    mcpListTitle: "MCP Explorer",
    mcpListDesc: "Browse the live tool catalog, inspect schemas, and invoke any tool with JSON arguments.",
    doctorTitle: "Diagnose connection",
    doctorDesc: "Verify connectivity, protocol negotiation, and MCP tool discovery.",
    getTitle: "Open 4-word link",
    getDesc: "Download or view the content of a four-word link (automatically decrypting #key= links).",
    getTargetLabel: "Link or 4 words + 9 digits",
    getTargetHint: "e.g., lua-gato-sol-rio-123456789",
    getOutputLabel: "Save to file (optional)",
    getOutputHint: "Local file path to write the content",
    getKeyLabel: "Decryption key (optional)",
    getKeyHint: "Only needed if not included in #key= in the URL",
    deleteTitle: "Destroy content",
    deleteDesc: "Immediately purge published text or file using its secret delete_url (/d/<sha512>).",
    deleteUrlLabel: "Delete URL",
    roomSendFileTitle: "Send file to room",
    roomSendFileDesc: "Upload a file up to 24 MiB directly to active room participants.",
    optMsgLabel: "Optional message",
    optMsgHint: "Text displayed alongside the attachment",
    roomWaitTitle: "Listen to room live",
    roomWaitDesc: "Wait for new messages, @mentions, or collaborative Markdown edits via long-polling.",
    timeoutLabel: "Timeout in seconds (1-25)",
    allMsgLabel: "Receive all messages",
    roomPartTitle: "List participants",
    roomPartDesc: "View currently active human and LLM participants in the room.",
    roomNickTitle: "Roll nickname",
    roomNickDesc: "Roll a new random nickname bound to your current IP or session in the room.",
    roomRegLlmTitle: "Register LLM Agent",
    roomRegLlmDesc: "Authenticate with the room llm_key to display the golden LLM agent badge.",
    llmKeyReqLabel: "LLM Key",
    roomModTitle: "Moderate room",
    roomModDesc: "Verify admin_key, list active bans, or ban/unban participants.",
    modActionLabel: "Action (list, verify, ban, unban)",
    adminKeyLabel: "Admin key",
    targetNickLabel: "Target nickname (for ban/unban)",
    banIdLabel: "Ban ID (for unban)",
    historyTitle: "Local 24h vault",
    historyDesc: "View links, delete_url, admin_key, and llm_key saved locally in the last 24 hours.",
    langTitle: "Language (en / ptbr / es)",
    langDesc: "Change and save the default interface language on this machine (or press L in the main menu).",
    langFieldLabel: "Language code (en, ptbr, es)",
    langFieldHint: "en = English (default), ptbr = Portugu\xEAs, es = Espa\xF1ol",
    updateTitle: "Update 4w",
    updateDesc: "Check for updates and reinstall the latest official release.",
    updateCheckLabel: "Only check (--check)",
    updateCheckHint: "Check if an update is available without modifying files",
    updateForceLabel: "Force reinstall (--force)",
    updateForceHint: "Reinstall even if the version is already up to date"
  },
  ptbr: {
    secPublish: "PUBLICAR",
    secRooms: "SALAS",
    secTools: "FERRAMENTAS",
    roomLabel: "Sala",
    roomHint: "URL da sala ou c\xF3digo de quatro palavras",
    burnLabel: "Leitura \xFAnica",
    burnHint: "O link expira ap\xF3s a primeira leitura",
    encryptLabel: "Criptografia Zero-Knowledge",
    encryptHint: "Criptografa localmente com AES-256-GCM e anexa #key= ao link",
    streamLabel: "Upload por streaming (at\xE9 1 GiB)",
    streamHint: "Envia via PUT /api/upload/file sem limite de 24 MiB do MCP",
    fileLabel: "Caminho do arquivo",
    fileHint: "Cole o caminho sem aspas",
    llmKeyLabel: "Chave LLM (opcional)",
    llmKeyHint: "fwllm_... para autenticar como agente",
    llmNameLabel: "Nome do agente LLM (opcional)",
    llmNameHint: "Ex.: claude, gemini, cursor",
    textTitle: "Publicar texto",
    textDesc: "Crie um link de quatro palavras para texto ou Markdown. Use leitura \xFAnica quando o link deva expirar ao ser aberto.",
    textField: "Texto ou Markdown",
    fileTitle: "Publicar arquivo",
    fileDesc: "Selecione um arquivo local (at\xE9 24 MiB pelo MCP ou at\xE9 1 GiB via streaming) e receba o link de compartilhamento.",
    roomCreateTitle: "Criar sala",
    roomCreateDesc: "Abra uma sala colaborativa e, se quiser, inicie o documento compartilhado com Markdown.",
    initialMd: "Markdown inicial",
    initialMsg: "Mensagem inicial",
    optional: "Opcional",
    roomJoinTitle: "Entrar na sala",
    roomJoinDesc: "Registre sua entrada e consulte o apelido e o estado inicial da sala.",
    roomMessagesTitle: "Ler mensagens",
    roomMessagesDesc: "Leia o hist\xF3rico de mensagens ou informe um cursor para ver apenas as mais recentes.",
    sinceLabel: "A partir da sequ\xEAncia",
    sinceHint: "Opcional. Use o cursor da consulta anterior.",
    mentionsLabel: "Apenas @men\xE7\xF5es",
    roomSendTitle: "Enviar mensagem",
    roomSendDesc: "Escreva e envie uma mensagem para uma sala existente.",
    msgLabel: "Mensagem",
    roomDocTitle: "Ler Markdown",
    roomDocDesc: "Leia o documento compartilhado e guarde a revis\xE3o para uma edi\xE7\xE3o posterior.",
    roomSaveTitle: "Salvar Markdown",
    roomSaveDesc: "Edite o documento e salve sobre a revis\xE3o que voc\xEA leu. Uma revis\xE3o concorrente impede a grava\xE7\xE3o.",
    baseLabel: "Revis\xE3o de origem",
    baseHint: "updated_at do documento. Use 0 para um documento sem revis\xE3o.",
    mcpListTitle: "Explorador MCP",
    mcpListDesc: "Consulte o cat\xE1logo ao vivo, examine esquemas e invoque qualquer ferramenta com argumentos JSON.",
    doctorTitle: "Diagnosticar conex\xE3o",
    doctorDesc: "Verifique a conex\xE3o, a negocia\xE7\xE3o do protocolo e a descoberta de ferramentas do MCP.",
    getTitle: "Abrir link de 4 palavras",
    getDesc: "Baixe ou exiba o conte\xFAdo de um link de quatro palavras (descriptografando automaticamente links com #key=).",
    getTargetLabel: "Link ou 4 palavras + 9 d\xEDgitos",
    getTargetHint: "Ex.: lua-gato-sol-rio-123456789",
    getOutputLabel: "Salvar no arquivo (opcional)",
    getOutputHint: "Caminho local para gravar o conte\xFAdo",
    getKeyLabel: "Chave de descriptografia (opcional)",
    getKeyHint: "Necess\xE1ria apenas se n\xE3o estiver em #key= na URL",
    deleteTitle: "Destruir conte\xFAdo",
    deleteDesc: "Apague imediatamente um texto ou arquivo publicado usando sua delete_url secreta (/d/<sha512>).",
    deleteUrlLabel: "URL de destrui\xE7\xE3o",
    roomSendFileTitle: "Enviar arquivo na sala",
    roomSendFileDesc: "Envie um arquivo de at\xE9 24 MiB diretamente para os participantes de uma sala ativa.",
    optMsgLabel: "Mensagem opcional",
    optMsgHint: "Texto exibido junto ao anexo",
    roomWaitTitle: "Escutar sala em tempo real",
    roomWaitDesc: "Aguarde novas mensagens, @men\xE7\xF5es ou edi\xE7\xF5es no documento Markdown via long-polling.",
    timeoutLabel: "Timeout em segundos (1-25)",
    allMsgLabel: "Receber todas as mensagens",
    roomPartTitle: "Listar participantes",
    roomPartDesc: "Consulte os humanos e agentes LLM ativos na sala no momento.",
    roomNickTitle: "Sortear apelido",
    roomNickDesc: "Troque seu apelido aleat\xF3rio vinculado ao IP ou sess\xE3o atual na sala.",
    roomRegLlmTitle: "Registrar agente LLM",
    roomRegLlmDesc: "Autentique-se com a llm_key da sala para exibir o selo dourado de agente LLM.",
    llmKeyReqLabel: "Chave LLM",
    roomModTitle: "Moderar sala",
    roomModDesc: "Verifique a admin_key, liste banimentos ativos, bana ou desbana participantes.",
    modActionLabel: "A\xE7\xE3o (list, verify, ban, unban)",
    adminKeyLabel: "Chave de administra\xE7\xE3o",
    targetNickLabel: "Apelido alvo (para ban/unban)",
    banIdLabel: "ID do banimento (para unban)",
    historyTitle: "Cofre local de 24h",
    historyDesc: "Consulte links, delete_url, admin_key e llm_key salvos localmente nas \xFAltimas 24 horas.",
    langTitle: "Idioma (en / ptbr / es)",
    langDesc: "Altere e salve o idioma padr\xE3o da interface nesta m\xE1quina (ou pressione L na tela inicial).",
    langFieldLabel: "C\xF3digo do idioma (en, ptbr, es)",
    langFieldHint: "en = English (padr\xE3o), ptbr = Portugu\xEAs, es = Espa\xF1ol",
    updateTitle: "Atualizar 4w",
    updateDesc: "Verifica novas vers\xF5es e atualiza o 4w usando o instalador oficial.",
    updateCheckLabel: "Apenas verificar (--check)",
    updateCheckHint: "Consulta se h\xE1 vers\xE3o mais recente sem alterar arquivos",
    updateForceLabel: "For\xE7ar reinstala\xE7\xE3o (--force)",
    updateForceHint: "Reinstala mesmo se j\xE1 estiver na vers\xE3o mais recente"
  },
  es: {
    secPublish: "PUBLICAR",
    secRooms: "SALAS",
    secTools: "HERRAMIENTAS",
    roomLabel: "Sala",
    roomHint: "URL de la sala o c\xF3digo de cuatro palabras",
    burnLabel: "Lectura \xFAnica",
    burnHint: "El enlace expira tras la primera lectura",
    encryptLabel: "Cifrado Zero-Knowledge",
    encryptHint: "Cifra localmente con AES-256-GCM y a\xF1ade #key= al enlace",
    streamLabel: "Subida por streaming (hasta 1 GiB)",
    streamHint: "Env\xEDa v\xEDa PUT /api/upload/file sin el l\xEDmite de 24 MiB del MCP",
    fileLabel: "Ruta del archivo",
    fileHint: "Pegue la ruta sin comillas",
    llmKeyLabel: "Clave LLM (opcional)",
    llmKeyHint: "fwllm_... para autenticar como agente",
    llmNameLabel: "Nombre del agente LLM (opcional)",
    llmNameHint: "Ej.: claude, gemini, cursor",
    textTitle: "Publicar texto",
    textDesc: "Cree un enlace de cuatro palabras para texto o Markdown. Use lectura \xFAnica para que expire al abrirse.",
    textField: "Texto o Markdown",
    fileTitle: "Publicar archivo",
    fileDesc: "Seleccione un archivo local (hasta 24 MiB por MCP o 1 GiB por streaming) y reciba el enlace.",
    roomCreateTitle: "Crear sala",
    roomCreateDesc: "Abra una sala colaborativa e inicie opcionalmente el documento compartido con Markdown.",
    initialMd: "Markdown inicial",
    initialMsg: "Mensaje inicial",
    optional: "Opcional",
    roomJoinTitle: "Entrar en la sala",
    roomJoinDesc: "Registre su entrada y consulte el apodo y el estado inicial de la sala.",
    roomMessagesTitle: "Leer mensajes",
    roomMessagesDesc: "Lea el historial de mensajes o indique un cursor para ver solo los m\xE1s recientes.",
    sinceLabel: "Desde la secuencia",
    sinceHint: "Opcional. Use el cursor de la consulta anterior.",
    mentionsLabel: "Solo @menciones",
    roomSendTitle: "Enviar mensaje",
    roomSendDesc: "Escriba y env\xEDe un mensaje a una sala existente.",
    msgLabel: "Mensaje",
    roomDocTitle: "Leer Markdown",
    roomDocDesc: "Lea el documento compartido y guarde la revisi\xF3n para una edici\xF3n posterior.",
    roomSaveTitle: "Guardar Markdown",
    roomSaveDesc: "Edite el documento y guarde sobre la revisi\xF3n le\xEDda. Una revisi\xF3n concurrente impide sobrescribir.",
    baseLabel: "Revisi\xF3n de origen",
    baseHint: "updated_at del documento. Use 0 para un documento sin revisi\xF3n.",
    mcpListTitle: "Explorador MCP",
    mcpListDesc: "Consulte el cat\xE1logo en vivo, examine esquemas e invoque cualquier herramienta con JSON.",
    doctorTitle: "Diagnosticar conexi\xF3n",
    doctorDesc: "Verifique la conexi\xF3n, la negociaci\xF3n del protocolo y el descubrimiento de herramientas MCP.",
    getTitle: "Abrir enlace de 4 palabras",
    getDesc: "Descargue o muestre el contenido de un enlace de cuatro palabras (descifrando #key= autom\xE1ticamente).",
    getTargetLabel: "Enlace o 4 palabras + 9 d\xEDgitos",
    getTargetHint: "Ej.: lua-gato-sol-rio-123456789",
    getOutputLabel: "Guardar en archivo (opcional)",
    getOutputHint: "Ruta local donde guardar el contenido",
    getKeyLabel: "Clave de descifrado (opcional)",
    getKeyHint: "Solo necesaria si no est\xE1 en #key= en la URL",
    deleteTitle: "Destruir contenido",
    deleteDesc: "Elimine inmediatamente un texto o archivo publicado usando su delete_url secreta (/d/<sha512>).",
    deleteUrlLabel: "URL de destrucci\xF3n",
    roomSendFileTitle: "Enviar archivo a la sala",
    roomSendFileDesc: "Env\xEDe un archivo de hasta 24 MiB directamente a los participantes de una sala activa.",
    optMsgLabel: "Mensaje opcional",
    optMsgHint: "Texto mostrado junto al archivo adjunto",
    roomWaitTitle: "Escuchar sala en vivo",
    roomWaitDesc: "Espere nuevos mensajes, @menciones o ediciones en el Markdown mediante long-polling.",
    timeoutLabel: "Timeout en segundos (1-25)",
    allMsgLabel: "Recibir todos los mensajes",
    roomPartTitle: "Listar participantes",
    roomPartDesc: "Consulte los humanos y agentes LLM activos en la sala.",
    roomNickTitle: "Sortear apodo",
    roomNickDesc: "Cambie su apodo aleatorio vinculado a la sesi\xF3n actual en la sala.",
    roomRegLlmTitle: "Registrar agente LLM",
    roomRegLlmDesc: "Autent\xEDquese con la llm_key de la sala para mostrar la insignia dorada de agente LLM.",
    llmKeyReqLabel: "Clave LLM",
    roomModTitle: "Moderar sala",
    roomModDesc: "Verifique la admin_key, liste bloqueos activos, bloquee o desbloquee participantes.",
    modActionLabel: "Acci\xF3n (list, verify, ban, unban)",
    adminKeyLabel: "Clave de administraci\xF3n",
    targetNickLabel: "Apodo objetivo (para ban/unban)",
    banIdLabel: "ID de bloqueo (para unban)",
    historyTitle: "B\xF3veda local de 24h",
    historyDesc: "Consulte enlaces, delete_url, admin_key y llm_key guardados localmente en las \xFAltimas 24 horas.",
    langTitle: "Idioma (en / ptbr / es)",
    langDesc: "Cambie y guarde el idioma predeterminado en esta m\xE1quina (o presione L en el men\xFA principal).",
    langFieldLabel: "C\xF3digo de idioma (en, ptbr, es)",
    langFieldHint: "en = English (por defecto), ptbr = Portugu\xEAs, es = Espa\xF1ol",
    updateTitle: "Actualizar 4w",
    updateDesc: "Verifica nuevas versiones y actualiza 4w usando el instalador oficial.",
    updateCheckLabel: "Solo verificar (--check)",
    updateCheckHint: "Consulta si hay una versi\xF3n m\xE1s reciente sin modificar archivos",
    updateForceLabel: "Forzar reinstalaci\xF3n (--force)",
    updateForceHint: "Reinstala incluso si ya est\xE1 en la versi\xF3n m\xE1s reciente"
  }
};
function actionsFor(lang = resolveLang()) {
  const c = copyByLang[lang];
  const room = { id: "room", label: c.roomLabel, hint: c.roomHint, required: true };
  const burn = { id: "burn", label: c.burnLabel, mode: "toggle", initial: "on", hint: c.burnHint };
  const encrypt = { id: "encrypt", label: c.encryptLabel, mode: "toggle", hint: c.encryptHint };
  const stream = { id: "stream", label: c.streamLabel, mode: "toggle", hint: c.streamHint };
  const markdown = { id: "markdown", label: "Markdown", mode: "multiline" };
  const file = { id: "file", label: c.fileLabel, hint: c.fileHint, required: true };
  const llmKey = { id: "llm_key", label: c.llmKeyLabel, hint: c.llmKeyHint };
  const llmName = { id: "llm_name", label: c.llmNameLabel, hint: c.llmNameHint };
  return [
    {
      id: "text",
      section: c.secPublish,
      title: c.textTitle,
      description: c.textDesc,
      fields: [{ id: "text", label: c.textField, mode: "multiline", required: true }, burn, encrypt],
      write: true,
      job: (v) => ({ args: ["text", ...burnFlag(v), ...encryptFlag(v), "-"], input: v.text })
    },
    {
      id: "file",
      section: c.secPublish,
      title: c.fileTitle,
      description: c.fileDesc,
      fields: [file, burn, stream, encrypt],
      write: true,
      job: (v) => ({ args: ["file", ...burnFlag(v), ...streamFlag(v), ...encryptFlag(v), "--", v.file] })
    },
    {
      id: "room create",
      section: c.secRooms,
      title: c.roomCreateTitle,
      description: c.roomCreateDesc,
      fields: [
        { ...markdown, label: c.initialMd, hint: c.optional },
        { id: "message", label: c.initialMsg, hint: c.optional },
        llmName
      ],
      write: true,
      job: (v) => ({
        args: [
          "room",
          "create",
          ...v.markdown ? ["--doc", "-"] : [],
          ...v.message?.trim() ? ["--message", v.message.trim()] : [],
          ...v.llm_name?.trim() ? ["--llm-name", v.llm_name.trim()] : []
        ],
        input: v.markdown || undefined
      })
    },
    {
      id: "room join",
      section: c.secRooms,
      title: c.roomJoinTitle,
      description: c.roomJoinDesc,
      fields: [room, llmKey, llmName],
      write: true,
      job: (v) => ({ args: ["room", "join", v.room, ...llmFlags(v)] })
    },
    {
      id: "room messages",
      section: c.secRooms,
      title: c.roomMessagesTitle,
      description: c.roomMessagesDesc,
      fields: [
        room,
        { id: "since", label: c.sinceLabel, hint: c.sinceHint },
        { id: "mentions", label: c.mentionsLabel, mode: "toggle" },
        llmKey,
        llmName
      ],
      job: (v) => ({
        args: [
          "room",
          "messages",
          v.room,
          ...v.since ? ["--since", v.since] : [],
          ...v.mentions === "on" ? ["--mentions-only"] : [],
          ...llmFlags(v)
        ]
      })
    },
    {
      id: "room send",
      section: c.secRooms,
      title: c.roomSendTitle,
      description: c.roomSendDesc,
      fields: [room, { id: "text", label: c.msgLabel, mode: "multiline", required: true }, llmKey, llmName],
      write: true,
      job: (v) => ({ args: ["room", "send", v.room, v.text, ...llmFlags(v)] })
    },
    {
      id: "room doc",
      section: c.secRooms,
      title: c.roomDocTitle,
      description: c.roomDocDesc,
      fields: [room, llmKey, llmName],
      job: (v) => ({ args: ["room", "doc", v.room, ...llmFlags(v)] })
    },
    {
      id: "room save",
      section: c.secRooms,
      title: c.roomSaveTitle,
      description: c.roomSaveDesc,
      fields: [
        room,
        { id: "base", label: c.baseLabel, hint: c.baseHint, required: true },
        markdown,
        llmKey,
        llmName
      ],
      write: true,
      job: (v) => ({ args: ["room", "save", v.room, "-", "--base", v.base, ...llmFlags(v)], input: v.markdown })
    },
    {
      id: "mcp list",
      section: c.secTools,
      title: c.mcpListTitle,
      description: c.mcpListDesc,
      job: () => ({ args: ["mcp", "list"] })
    },
    {
      id: "doctor",
      section: c.secTools,
      title: c.doctorTitle,
      description: c.doctorDesc,
      job: () => ({ args: ["doctor"] })
    },
    {
      id: "get",
      section: c.secPublish,
      title: c.getTitle,
      description: c.getDesc,
      fields: [
        { id: "target", label: c.getTargetLabel, hint: c.getTargetHint, required: true },
        { id: "output", label: c.getOutputLabel, hint: c.getOutputHint },
        { id: "key", label: c.getKeyLabel, hint: c.getKeyHint }
      ],
      job: (v) => ({
        args: [
          "get",
          v.target,
          ...v.output?.trim() ? ["--output", v.output.trim()] : [],
          ...v.key?.trim() ? ["--key", v.key.trim()] : []
        ]
      })
    },
    {
      id: "delete",
      section: c.secPublish,
      title: c.deleteTitle,
      description: c.deleteDesc,
      fields: [{ id: "delete_url", label: c.deleteUrlLabel, hint: "https://4words.aletheia.land/d/...", required: true }],
      write: true,
      job: (v) => ({ args: ["delete", v.delete_url.trim()] })
    },
    {
      id: "room send-file",
      section: c.secRooms,
      title: c.roomSendFileTitle,
      description: c.roomSendFileDesc,
      fields: [
        room,
        file,
        { id: "text", label: c.optMsgLabel, hint: c.optMsgHint },
        burn,
        llmKey,
        llmName
      ],
      write: true,
      job: (v) => ({
        args: [
          "room",
          "send-file",
          v.room,
          v.file,
          ...v.text?.trim() ? ["--text", v.text.trim()] : [],
          ...burnFlag(v),
          ...llmFlags(v)
        ]
      })
    },
    {
      id: "room wait",
      section: c.secRooms,
      title: c.roomWaitTitle,
      description: c.roomWaitDesc,
      fields: [
        room,
        { id: "since", label: c.sinceLabel, hint: "Optional (last_seq)" },
        { id: "timeout", label: c.timeoutLabel, initial: "20" },
        { id: "all", label: c.allMsgLabel, mode: "toggle", initial: "on" },
        llmKey,
        llmName
      ],
      job: (v) => ({
        args: [
          "room",
          "wait",
          v.room,
          ...v.since?.trim() ? ["--since", v.since.trim()] : [],
          ...v.timeout?.trim() ? ["--timeout", v.timeout.trim()] : [],
          ...v.all === "on" ? ["--all"] : [],
          ...llmFlags(v)
        ]
      })
    },
    {
      id: "room participants",
      section: c.secRooms,
      title: c.roomPartTitle,
      description: c.roomPartDesc,
      fields: [room, llmKey, llmName],
      job: (v) => ({ args: ["room", "participants", v.room, ...llmFlags(v)] })
    },
    {
      id: "room nick",
      section: c.secRooms,
      title: c.roomNickTitle,
      description: c.roomNickDesc,
      fields: [room, llmKey, llmName],
      write: true,
      job: (v) => ({ args: ["room", "nick", v.room, ...llmFlags(v)] })
    },
    {
      id: "room register-llm",
      section: c.secRooms,
      title: c.roomRegLlmTitle,
      description: c.roomRegLlmDesc,
      fields: [
        room,
        { ...llmKey, label: c.llmKeyReqLabel, required: true },
        llmName
      ],
      write: true,
      job: (v) => ({ args: ["room", "register-llm", v.room, ...llmFlags(v)] })
    },
    {
      id: "room moderate",
      section: c.secRooms,
      title: c.roomModTitle,
      description: c.roomModDesc,
      fields: [
        room,
        { id: "mod_action", label: c.modActionLabel, initial: "list", required: true },
        { id: "admin_key", label: c.adminKeyLabel, hint: "fwadm_...", required: true },
        { id: "nick", label: c.targetNickLabel, hint: c.optional },
        { id: "ban_id", label: c.banIdLabel, hint: c.optional }
      ],
      write: true,
      job: (v) => ({
        args: [
          "room",
          "moderate",
          v.room,
          v.mod_action.trim(),
          "--admin-key",
          v.admin_key.trim(),
          ...v.nick?.trim() ? ["--nick", v.nick.trim()] : [],
          ...v.ban_id?.trim() ? ["--ban-id", v.ban_id.trim()] : []
        ]
      })
    },
    {
      id: "history",
      section: c.secTools,
      title: c.historyTitle,
      description: c.historyDesc,
      job: () => ({ args: ["history"] })
    },
    {
      id: "lang",
      section: c.secTools,
      title: c.langTitle,
      description: c.langDesc,
      fields: [{ id: "lang", label: c.langFieldLabel, hint: c.langFieldHint, initial: lang, required: true }],
      job: (v) => ({ args: ["lang", v.lang.trim()] })
    },
    {
      id: "update",
      section: c.secTools,
      title: c.updateTitle,
      description: c.updateDesc,
      fields: [
        { id: "check", label: c.updateCheckLabel, mode: "toggle", initial: "on", hint: c.updateCheckHint },
        { id: "force", label: c.updateForceLabel, mode: "toggle", hint: c.updateForceHint }
      ],
      write: true,
      job: (v) => ({
        args: [
          "update",
          ...v.check === "on" ? ["--check"] : [],
          ...v.force === "on" ? ["--force"] : []
        ]
      })
    }
  ];
}
var actions = actionsFor();
function keyGuideFor(lang = resolveLang()) {
  if (lang === "en") {
    return [
      "NAVIGATION",
      "\u2191 / \u2193  or  j / k     Select item or scroll",
      "Enter               Open item",
      "L                   Switch & save language (en / ptbr / es)",
      "Tab / Shift+Tab     Switch field in forms",
      "Esc                 Back or cancel",
      "Ctrl+C              Quit",
      "",
      "FORMS",
      "\u2191 / \u2193 / \u2190 / \u2192       Move cursor in text",
      "Home / End          Start / end of line",
      "Space               Toggle burn / option",
      "F2 / Ctrl+S         Proceed to submit",
      "Tab to Continue     Alternative to F2 on Termux",
      "F1                  Command help or MCP schema",
      "",
      "RESULTS",
      "Page Up / Down      Scroll pages",
      "V                   Show or hide response credentials",
      "E                   Edit the displayed Markdown revision",
      "D                   Destroy recently published content",
      "Y                   Copy public link if terminal supports OSC 52"
    ].join(`
`);
  }
  if (lang === "es") {
    return [
      "NAVEGACI\xD3N",
      "\u2191 / \u2193  o  j / k      Seleccionar elemento o desplazar",
      "Enter               Abrir elemento",
      "L                   Cambiar y guardar idioma (en / ptbr / es)",
      "Tab / Shift+Tab     Cambiar campo en formularios",
      "Esc                 Volver o cancelar",
      "Ctrl+C              Salir",
      "",
      "FORMULARIOS",
      "\u2191 / \u2193 / \u2190 / \u2192       Mover el cursor en el texto",
      "Home / End          Inicio / fin de l\xEDnea",
      "Espacio             Alternar lectura \xFAnica / opci\xF3n",
      "F2 / Ctrl+S         Avanzar para enviar",
      "Tab hasta Continuar Alternativa a F2 en Termux",
      "F1                  Ayuda del comando o esquema MCP",
      "",
      "RESULTADOS",
      "Page Up / Down      Desplazar p\xE1ginas",
      "V                   Mostrar u ocultar credenciales de la respuesta",
      "E                   Editar el Markdown de la revisi\xF3n mostrada",
      "D                   Destruir el contenido reci\xE9n publicado",
      "Y                   Copiar enlace p\xFAblico si la terminal acepta OSC 52"
    ].join(`
`);
  }
  return [
    "NAVEGA\xC7\xC3O",
    "\u2191 / \u2193  ou  j / k     Selecionar item ou rolar",
    "Enter               Abrir item",
    "L                   Trocar e salvar idioma (en / ptbr / es)",
    "Tab / Shift+Tab     Trocar campo em formul\xE1rios",
    "Esc                 Voltar ou cancelar",
    "Ctrl+C              Sair",
    "",
    "FORMUL\xC1RIOS",
    "\u2191 / \u2193 / \u2190 / \u2192       Mover o cursor no texto",
    "Home / End          In\xEDcio / fim da linha",
    "Espa\xE7o              Alternar leitura \xFAnica / op\xE7\xE3o",
    "F2 / Ctrl+S         Avan\xE7ar para envio",
    "Tab at\xE9 Continuar   Alternativa ao F2 no Termux",
    "F1                  Ajuda do comando ou esquema MCP",
    "",
    "RESULTADOS",
    "Page Up / Down      Rolar p\xE1ginas",
    "V                   Mostrar ou ocultar credenciais da resposta",
    "E                   Editar o Markdown da revis\xE3o exibida",
    "D                   Destruir o conte\xFAdo rec\xE9m-publicado",
    "Y                   Copiar link p\xFAblico se o terminal aceitar OSC 52"
  ].join(`
`);
}
var keyGuide = keyGuideFor();
function textSafe(text) {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "\uFFFD");
}
function secretKey(key) {
  return /(?:^|[_-])(?:key|token|secret|password|authorization|delete_url)(?:$|[_-])/i.test(key) || /^(?:apiKey|deleteUrl|accessToken|llmKey|adminKey)$/i.test(key);
}
function maskSecrets(value, lang = resolveLang()) {
  const token = lang === "en" ? "[hidden]" : "[oculto]";
  return value.replace(/\bfw(?:adm|llm)_[0-9a-f]+\b|https:\/\/[^\s"<>]+\/d\/[0-9a-f]{32,}\b/gi, token);
}
function resultJson(value, reveal, lang = resolveLang()) {
  const token = lang === "en" ? "[hidden]" : "[oculto]";
  return JSON.stringify(value, (key, field) => {
    if (reveal)
      return field;
    if (secretKey(key))
      return token;
    return typeof field === "string" ? maskSecrets(field, lang) : field;
  }, 2) ?? "null";
}
function object(value) {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value;
}
function publicLink(value, roomAction = false) {
  const item = object(value);
  for (const key of ["fourwords_url", "url"]) {
    const raw = item?.[key];
    if (typeof raw !== "string" || /[\x00-\x20\x7f]/.test(raw))
      continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.search)
        continue;
      if (url.hash && !/^#key=[A-Za-z0-9_-]+$/.test(url.hash))
        continue;
      if (/^\/(?:[\p{L}\p{N}]+-){4}\d{9}$/u.test(decodeURIComponent(url.pathname)) || roomAction && /^\/chat\/[a-f\d]{128}$/i.test(url.pathname))
        return url.href;
    } catch {}
  }
}
function deleteLink(value) {
  const item = object(value);
  const raw = item?.delete_url ?? item?.deleteUrl;
  if (typeof raw !== "string" || /[\x00-\x20\x7f]/.test(raw))
    return;
  try {
    const url = new URL(raw);
    if ((url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost") && /^\/d\/[a-f\d]{32,}$/i.test(url.pathname)) {
      return url.href;
    }
  } catch {}
}

// src/tui-screen.ts
var segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
function fallbackWidth(value) {
  const plain = value.replace(/\x1b\[[\d;]*m/g, "");
  let cells = 0;
  for (const { segment } of segmenter.segment(plain)) {
    const code = segment.codePointAt(0) ?? 0;
    const wide = code >= 4352 && (code <= 4447 || code === 9001 || code === 9002 || code >= 11904 && code <= 42191 && code !== 12351 || code >= 44032 && code <= 55203 || code >= 63744 && code <= 64255 || code >= 65040 && code <= 65049 || code >= 65072 && code <= 65135 || code >= 65280 && code <= 65376 || code >= 65504 && code <= 65510 || code >= 126976);
    cells += wide ? 2 : 1;
  }
  return cells;
}
function width(value) {
  if (typeof Bun !== "undefined" && typeof Bun.stringWidth === "function") {
    return Bun.stringWidth(value);
  }
  return fallbackWidth(value);
}
function clip(value, size) {
  if (size <= 0)
    return "";
  if (width(value) <= size)
    return value;
  let line = "";
  let cells = 0;
  for (const { segment } of segmenter.segment(value)) {
    const next = width(segment);
    if (cells + next > size)
      break;
    line += segment;
    cells += next;
  }
  return line;
}
function pad(value, size) {
  return value + " ".repeat(Math.max(0, size - width(value)));
}
function wrap(value, size) {
  if (size < 2)
    return [""];
  return textSafe(value).split(`
`).flatMap((logical) => {
    if (width(logical) <= size)
      return [logical];
    const lines = [];
    let line = "";
    let cells = 0;
    let breakAt = -1;
    for (const { segment } of segmenter.segment(logical)) {
      const next = width(segment);
      if (cells + next > size) {
        if (breakAt > line.length / 2) {
          lines.push(line.slice(0, breakAt));
          line = line.slice(breakAt + 1);
          cells = width(line);
        } else {
          lines.push(line);
          line = "";
          cells = 0;
        }
        breakAt = line.lastIndexOf(" ");
      }
      if (segment === " ")
        breakAt = line.length;
      line += segment;
      cells += next;
    }
    return [...lines, line];
  });
}
var enableColor = process.env.NO_COLOR === undefined;
var palette = {
  brand: "1;95",
  accent: "1;96",
  selected: "1;97;45",
  bright: "1;97",
  dim: "90",
  success: "1;92",
  error: "1;91",
  cursor: "7"
};
function paint(value, tone) {
  if (!enableColor && tone !== "cursor")
    return value;
  return `\x1B[${palette[tone]}m${value}\x1B[0m`;
}
function cleanLine(value) {
  return textSafe(value).replace(/\n/g, " ");
}
function line(value, size, tone) {
  const output = clip(cleanLine(value), size);
  return tone ? paint(output, tone) : output;
}
function fieldLine(before, after, size) {
  let left = before;
  if (width(left) >= size) {
    left = "";
    let cells = 0;
    const parts = [...segmenter.segment(before)];
    for (let i = parts.length - 1;i >= 0; i--) {
      const segment = parts[i].segment;
      cells += width(segment);
      if (cells >= size - 1)
        break;
      left = segment + left;
    }
    left = "\u2039" + left;
  }
  const available = Math.max(1, size - width(left));
  const current = segmenter.segment(after)[Symbol.iterator]().next().value?.segment ?? " ";
  const cursor = width(current) <= available ? current : " ";
  return left + paint(cursor, "cursor") + clip(after.slice(current.length), available - width(cursor));
}

// src/tui.ts
var uiByLang = {
  en: {
    subtitle: "Sharing  /  Rooms  /  MCP",
    navigation: "\u2191\u2193 Navigate   Enter Open   L Lang   ? Help   Esc Quit",
    navCompactTiny: "\u2191\u2193  Enter  ? Help  Esc",
    navCompactMid: "\u2191\u2193 Menu  Enter Open  ? Help  Esc",
    enterToOpen: "Press Enter to open",
    fillField: (label) => `Please fill in the ${label} field.`,
    mcpToolDefault: "Tool advertised by MCP.",
    jsonArgsLabel: "JSON Arguments",
    jsonArgsHint: "F1 shows description and input schema.",
    waitCancelled: "Wait cancelled. A request already received by the server may still apply.",
    cmdHelpTitle: "Command help",
    maxCharsError: "The editor accepts up to 200,000 characters in this field.",
    panelGuideTitle: "Panel guide",
    mcpExplorerTitle: "MCP Explorer",
    mcpCatalogHeader: (n) => `MCP Explorer \xB7 ${n} tools`,
    catalogFooter: "\u2191\u2193 Navigate   Enter Open   F1 Help   Esc Back",
    clipboardNotice: "Link sent to clipboard. Your terminal may block OSC 52 copy.",
    toggleOn: "  \u25C9 Enabled",
    toggleOff: "  \u25CB Disabled",
    continueBtn: "Continue",
    resizeWindow: "4w \xB7 Enlarge terminal window",
    formFooterWide: "Tab Fields   F2 / Ctrl+S Continue   F1 Help   Esc Back",
    formFooterCompact: "Tab Fields  Ctrl+S Submit  Esc Back",
    confirmHeader: "CONFIRM OPERATION",
    confirmBody: "Form data will be sent to the configured MCP endpoint.",
    confirmFooter: "Enter Confirm   Esc Review",
    busyHeader: "CONNECTING TO FOURWORDS",
    busyBody: "Waiting for MCP response\u2026",
    busyFooter: "Esc Cancel wait   Ctrl+C Quit",
    statusSuccessRevealed: "RESPONSE \xB7 CREDENTIALS VISIBLE",
    statusSuccess: "RESPONSE",
    statusError: "ERROR",
    statusHelp: "HELP",
    revisionPrefix: "Revision",
    btnCopy: "Y Copy",
    btnEdit: "E Edit",
    btnDestroy: "D Destroy",
    btnCredentials: "V Credentials",
    btnBack: "Esc Back",
    btnScroll: "\u2191\u2193 Scroll",
    langSavedNotice: (code) => `Language saved on this machine: ${code.toUpperCase()}`
  },
  ptbr: {
    subtitle: "Compartilhamento  /  Salas  /  MCP",
    navigation: "\u2191\u2193 Navegar   Enter Abrir   L Idioma   ? Ajuda   Esc Sair",
    navCompactTiny: "\u2191\u2193  Enter  ? Ajuda  Esc",
    navCompactMid: "\u2191\u2193 Menu  Enter Abrir  ? Ajuda  Esc",
    enterToOpen: "Enter para abrir",
    fillField: (label) => `Preencha o campo ${label}.`,
    mcpToolDefault: "Ferramenta anunciada pelo MCP.",
    jsonArgsLabel: "Argumentos JSON",
    jsonArgsHint: "F1 mostra a descri\xE7\xE3o e o esquema.",
    waitCancelled: "Espera cancelada. Uma solicita\xE7\xE3o j\xE1 recebida pelo servidor pode ter sido aplicada.",
    cmdHelpTitle: "Ajuda do comando",
    maxCharsError: "O editor aceita at\xE9 200.000 caracteres neste campo.",
    panelGuideTitle: "Guia do painel",
    mcpExplorerTitle: "Explorador MCP",
    mcpCatalogHeader: (n) => `Explorador MCP \xB7 ${n} ferramentas`,
    catalogFooter: "\u2191\u2193 Navegar   Enter Abrir   F1 Ajuda   Esc Voltar",
    clipboardNotice: "Link enviado \xE0 \xE1rea de transfer\xEAncia. O terminal pode bloquear a c\xF3pia.",
    toggleOn: "  \u25C9 Ativada",
    toggleOff: "  \u25CB Desativada",
    continueBtn: "Continuar",
    resizeWindow: "4w \xB7 Amplie a janela",
    formFooterWide: "Tab Campos   F2 / Ctrl+S Continuar   F1 Ajuda   Esc Voltar",
    formFooterCompact: "Tab Campos  Ctrl+S Enviar  Esc Voltar",
    confirmHeader: "CONFIRMAR OPERA\xC7\xC3O",
    confirmBody: "Os dados do formul\xE1rio ser\xE3o enviados ao endpoint MCP configurado.",
    confirmFooter: "Enter Confirmar   Esc Revisar",
    busyHeader: "CONECTANDO AO FOURWORDS",
    busyBody: "Aguardando a resposta do MCP\u2026",
    busyFooter: "Esc Cancelar espera   Ctrl+C Sair",
    statusSuccessRevealed: "RESPOSTA \xB7 CREDENCIAIS VIS\xCDVEIS",
    statusSuccess: "RESPOSTA",
    statusError: "ERRO",
    statusHelp: "AJUDA",
    revisionPrefix: "Revis\xE3o",
    btnCopy: "Y Copiar",
    btnEdit: "E Editar",
    btnDestroy: "D Destruir",
    btnCredentials: "V Credenciais",
    btnBack: "Esc Voltar",
    btnScroll: "\u2191\u2193 Rolar",
    langSavedNotice: (code) => `Idioma salvo nesta m\xE1quina: ${code.toUpperCase()}`
  },
  es: {
    subtitle: "Compartir  /  Salas  /  MCP",
    navigation: "\u2191\u2193 Navegar   Enter Abrir   L Idioma   ? Ayuda   Esc Salir",
    navCompactTiny: "\u2191\u2193  Enter  ? Ayuda  Esc",
    navCompactMid: "\u2191\u2193 Men\xFA  Enter Abrir  ? Ayuda  Esc",
    enterToOpen: "Enter para abrir",
    fillField: (label) => `Complete el campo ${label}.`,
    mcpToolDefault: "Herramienta anunciada por el MCP.",
    jsonArgsLabel: "Argumentos JSON",
    jsonArgsHint: "F1 muestra la descripci\xF3n y el esquema.",
    waitCancelled: "Espera cancelada. Una solicitud ya recibida por el servidor puede haberse aplicado.",
    cmdHelpTitle: "Ayuda del comando",
    maxCharsError: "El editor acepta hasta 200.000 caracteres en este campo.",
    panelGuideTitle: "Gu\xEDa del panel",
    mcpExplorerTitle: "Explorador MCP",
    mcpCatalogHeader: (n) => `Explorador MCP \xB7 ${n} herramientas`,
    catalogFooter: "\u2191\u2193 Navegar   Enter Abrir   F1 Ayuda   Esc Volver",
    clipboardNotice: "Enlace enviado al portapapeles. La terminal puede bloquear la copia.",
    toggleOn: "  \u25C9 Activada",
    toggleOff: "  \u25CB Desactivada",
    continueBtn: "Continuar",
    resizeWindow: "4w \xB7 Ampl\xEDe la ventana",
    formFooterWide: "Tab Campos   F2 / Ctrl+S Continuar   F1 Ayuda   Esc Volver",
    formFooterCompact: "Tab Campos  Ctrl+S Enviar  Esc Volver",
    confirmHeader: "CONFIRMAR OPERACI\xD3N",
    confirmBody: "Los datos del formulario se enviar\xE1n al endpoint MCP configurado.",
    confirmFooter: "Enter Confirmar   Esc Revisar",
    busyHeader: "CONECTANDO A FOURWORDS",
    busyBody: "Esperando respuesta del MCP\u2026",
    busyFooter: "Esc Cancelar espera   Ctrl+C Salir",
    statusSuccessRevealed: "RESPUESTA \xB7 CREDENCIALES VISIBLES",
    statusSuccess: "RESPUESTA",
    statusError: "ERROR",
    statusHelp: "AYUDA",
    revisionPrefix: "Revisi\xF3n",
    btnCopy: "Y Copiar",
    btnEdit: "E Editar",
    btnDestroy: "D Destruir",
    btnCredentials: "V Credenciales",
    btnBack: "Esc Volver",
    btnScroll: "\u2191\u2193 Desplazar",
    langSavedNotice: (code) => `Idioma guardado en esta m\xE1quina: ${code.toUpperCase()}`
  }
};
function viewer(title, back, status, text) {
  return { kind: "viewer", title, back, status, text, reveal: false, offset: 0 };
}
function lastLineStart(value, cursor) {
  return cursor <= 0 ? 0 : value.lastIndexOf(`
`, cursor - 1) + 1;
}
function nextLineEnd(value, cursor) {
  const end = value.indexOf(`
`, cursor);
  return end < 0 ? value.length : end;
}
function editField(value, cursor, key, inserted = "") {
  if (inserted)
    return [value.slice(0, cursor) + inserted + value.slice(cursor), cursor + inserted.length];
  const start = lastLineStart(value, cursor);
  const end = nextLineEnd(value, cursor);
  const segments = segmenter.segment(value);
  const left = cursor > 0 ? segments.containing(cursor - 1)?.index ?? cursor - 1 : 0;
  const right = segments.containing(cursor)?.segment.length ?? 0;
  switch (key.name) {
    case "left":
      return [value, left];
    case "right":
      return [value, cursor + right];
    case "home":
      return [value, start];
    case "end":
      return [value, end];
    case "up": {
      if (!start)
        return [value, cursor];
      const previous = lastLineStart(value, start - 1);
      const next = Math.min(previous + cursor - start, start - 1);
      return [value, segments.containing(next)?.index ?? next];
    }
    case "down": {
      if (end === value.length)
        return [value, cursor];
      const next = Math.min(end + 1 + cursor - start, nextLineEnd(value, end + 1));
      return [value, segments.containing(next)?.index ?? next];
    }
    case "backspace":
      return [value.slice(0, left) + value.slice(cursor), left];
    case "delete":
      return [value.slice(0, cursor) + value.slice(cursor + right), cursor];
    default:
      return [value, cursor];
  }
}
var appTitle = "F O U R W O R D S";
var langOrder = ["en", "ptbr", "es"];

class Tui {
  execute;
  done;
  screen = { kind: "home", index: 0 };
  lang = resolveLang();
  lastRoom = "";
  lastLlmKey = "";
  lastAdminKey = "";
  notice = "";
  paste = false;
  scheduled;
  renderedScroll = 0;
  closed = false;
  constructor(execute, done) {
    this.execute = execute;
    this.done = done;
  }
  ui() {
    return uiByLang[this.lang];
  }
  currentActions() {
    return actionsFor(this.lang);
  }
  cycleLang() {
    const nextIndex = (langOrder.indexOf(this.lang) + 1) % langOrder.length;
    this.lang = langOrder[nextIndex];
    try {
      saveLang(this.lang);
    } catch {}
    this.notice = this.ui().langSavedNotice(this.lang);
    this.redraw();
  }
  change(screen) {
    this.screen = screen;
    this.notice = "";
    this.redraw();
  }
  form(action, back, defaults = {}, tool) {
    const fields = action.fields ?? [];
    const values = Object.fromEntries(fields.map((f) => {
      const sessionDefault = f.id === "room" ? this.lastRoom : f.id === "llm_key" ? this.lastLlmKey : f.id === "admin_key" ? this.lastAdminKey : undefined;
      return [
        f.id,
        defaults[f.id] ?? sessionDefault ?? f.initial ?? (f.mode === "toggle" ? "off" : "")
      ];
    }));
    return {
      kind: "form",
      action,
      fields,
      values,
      focus: 0,
      back,
      tool,
      cursors: Object.fromEntries(fields.map((f) => [f.id, values[f.id].length]))
    };
  }
  start(title, job, back) {
    const state = { kind: "busy", title, back, controller: new AbortController };
    this.change(state);
    this.execute(job.args, state.controller.signal, job.input).then((value) => {
      if (this.closed || this.screen !== state)
        return;
      if (job.args.join(" ") === "mcp list" && back.kind === "home" && Array.isArray(value)) {
        const tools = value.filter((tool) => typeof tool?.name === "string");
        if (tools.length)
          return this.change({ kind: "catalog", tools, index: 0, back });
      }
      const result = viewer(title, back, "success");
      result.value = value;
      const id = back.kind === "form" ? back.action.id : undefined;
      const data = object(value);
      if (job.args[0] === "lang" && typeof data?.lang === "string") {
        const updatedLang = normalizeLang(data.lang);
        if (updatedLang)
          this.lang = updatedLang;
      }
      result.link = publicLink(value, id?.startsWith("room ") ?? false);
      result.deleteUrl = deleteLink(value);
      result.room = back.kind === "form" ? back.values.room : undefined;
      if (id === "room create" && result.link)
        result.room = result.link;
      if (result.room)
        this.lastRoom = result.room;
      if (typeof data?.llm_key === "string")
        this.lastLlmKey = data.llm_key;
      if (typeof data?.admin_key === "string")
        this.lastAdminKey = data.admin_key;
      if (id === "room doc" && result.room && typeof data?.content === "string" && typeof data.updated_at === "number" && Number.isSafeInteger(data.updated_at)) {
        result.edit = { room: result.room, revision: data.updated_at, content: data.content };
      }
      this.change(result);
    }).catch((error) => {
      if (this.closed || this.screen !== state)
        return;
      const message = error instanceof Error ? error.message : String(error);
      this.change(viewer(title, back, "error", maskSecrets(message, this.lang)));
    });
  }
  advance(form) {
    const missing = form.fields.findIndex((field) => field.required && !form.values[field.id].trim());
    if (missing >= 0) {
      form.focus = missing;
      form.issue = this.ui().fillField(form.fields[missing].label);
      return this.redraw();
    }
    if (form.action.write)
      return this.change({ kind: "confirm", form });
    this.start(form.action.title, form.action.job(form.values), form);
  }
  toolForm(catalog) {
    const tool = catalog.tools[catalog.index];
    const ui = this.ui();
    const action = {
      id: "mcp call",
      section: "MCP",
      title: tool.name,
      description: tool.title ?? ui.mcpToolDefault,
      fields: [{ id: "json", label: ui.jsonArgsLabel, mode: "multiline", initial: "{}", hint: ui.jsonArgsHint }],
      write: true,
      job: (v) => ({ args: ["mcp", "call", tool.name, "-"], input: v.json || "{}" })
    };
    return this.form(action, catalog, {}, tool);
  }
  leave() {
    const screen = this.screen;
    if (screen.kind === "home")
      return this.done();
    if (screen.kind === "busy") {
      screen.controller.abort();
      this.change(screen.back);
      this.notice = this.ui().waitCancelled;
      return this.redraw();
    }
    return this.change(screen.kind === "confirm" ? screen.form : screen.back);
  }
  inputForm(form, text, key) {
    const ui = this.ui();
    if (!this.paste && key.name === "f1") {
      const description = form.tool ? [form.tool.description ?? "", "", resultJson(form.tool.inputSchema ?? {}, false, this.lang)].join(`
`) : help(form.action.id, this.lang);
      return this.change(viewer(ui.cmdHelpTitle, form, "guide", description));
    }
    if (!this.paste && (key.name === "f2" || key.ctrl && key.name === "s"))
      return this.advance(form);
    if (!this.paste && key.name === "tab") {
      const length = form.fields.length + 1;
      form.focus = (form.focus + (key.shift ? length - 1 : 1)) % length;
      return this.redraw();
    }
    const field = form.fields[form.focus];
    if (!field) {
      if (!this.paste && key.name === "return")
        return this.advance(form);
      return;
    }
    if (field.mode === "toggle") {
      if (!this.paste && key.name === "space") {
        form.values[field.id] = form.values[field.id] === "on" ? "off" : "on";
      } else if (!this.paste && key.name === "return")
        form.focus++;
      return this.redraw();
    }
    const value = form.values[field.id];
    let inserted = "";
    if (key.name === "return" || key.name === "enter") {
      if (field.mode === "multiline")
        inserted = `
`;
      else if (this.paste)
        inserted = " ";
      else {
        form.focus++;
        return this.redraw();
      }
    } else if (this.paste && key.name === "tab") {
      inserted = "  ";
    } else if (text && !key.ctrl && !key.meta) {
      inserted = text.replace(/\r\n?/g, `
`).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
      if (field.mode !== "multiline")
        inserted = inserted.replace(/\n/g, " ");
    }
    if (inserted.length + value.length <= 200000) {
      const [next, cursor] = editField(value, form.cursors[field.id], this.paste ? {} : key, inserted);
      form.values[field.id] = next;
      form.cursors[field.id] = cursor;
      if (next !== value)
        form.issue = undefined;
    } else
      form.issue = ui.maxCharsError;
    this.redraw();
  }
  onKey = (text = "", key = {}) => {
    if (this.closed)
      return;
    if (key.name === "paste-start" || key.sequence === "\x1B[200~") {
      this.paste = true;
      return;
    }
    if (key.name === "paste-end" || key.sequence === "\x1B[201~") {
      this.paste = false;
      return;
    }
    if (!this.paste && key.ctrl && key.name === "c")
      return this.done();
    if (!this.paste && key.name === "escape")
      return this.leave();
    const screen = this.screen;
    if (screen.kind === "form")
      return this.inputForm(screen, text, key);
    if (this.paste)
      return;
    const ui = this.ui();
    const list = this.currentActions();
    const direction = key.name === "up" || text === "k" ? -1 : key.name === "down" || text === "j" ? 1 : 0;
    if (screen.kind === "home") {
      if (text === "q")
        return this.done();
      if (text.toLowerCase() === "l")
        return this.cycleLang();
      if (text === "?" || key.name === "f1")
        return this.change(viewer(ui.panelGuideTitle, screen, "guide", keyGuideFor(this.lang)));
      if (direction)
        screen.index = (screen.index + direction + list.length) % list.length;
      if (key.name === "return") {
        const action = list[screen.index];
        if (action.fields)
          return this.change(this.form(action, screen));
        return this.start(action.title, action.job({}), screen);
      }
    } else if (screen.kind === "catalog") {
      if (direction)
        screen.index = (screen.index + direction + screen.tools.length) % screen.tools.length;
      if (key.name === "return")
        return this.change(this.toolForm(screen));
      if (text === "?" || key.name === "f1")
        return this.change(viewer(ui.mcpExplorerTitle, screen, "guide", help("mcp call", this.lang)));
    } else if (screen.kind === "confirm") {
      if (key.name === "return")
        return this.start(screen.form.action.title, screen.form.action.job(screen.form.values), screen.form);
    } else if (screen.kind === "viewer") {
      if (direction)
        screen.offset += direction;
      if (key.name === "pageup" || key.name === "pagedown") {
        screen.offset += (key.name === "pageup" ? -1 : 1) * Math.max(1, (process.stdout.rows ?? 24) - 8);
      }
      if (key.name === "home")
        screen.offset = 0;
      if (key.name === "end")
        screen.offset = this.renderedScroll;
      if (text.toLowerCase() === "v" && screen.status === "success") {
        screen.reveal = !screen.reveal;
        screen.offset = 0;
      }
      if (text.toLowerCase() === "e" && screen.edit) {
        const action = list.find((item) => item.id === "room save");
        const home = screen.back.kind === "form" ? screen.back.back : screen.back;
        const form = this.form(action, home, {
          room: screen.edit.room,
          base: String(screen.edit.revision),
          markdown: screen.edit.content
        });
        form.focus = 2;
        return this.change(form);
      }
      if (text.toLowerCase() === "d" && screen.deleteUrl) {
        const action = list.find((item) => item.id === "delete");
        const home = screen.back.kind === "form" ? screen.back.back : screen.back;
        const form = this.form(action, home, { delete_url: screen.deleteUrl });
        return this.change({ kind: "confirm", form });
      }
      if (text.toLowerCase() === "y" && screen.link) {
        process.stdout.write(`\x1B]52;c;${Buffer.from(screen.link).toString("base64")}\x07`);
        this.notice = ui.clipboardNotice;
      }
    }
    this.redraw();
  };
  redraw = () => {
    if (this.closed || this.scheduled)
      return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      if (this.closed)
        return;
      try {
        this.render();
      } catch (error) {
        this.done(error);
      }
    });
  };
  stop() {
    this.closed = true;
    if (this.scheduled)
      clearImmediate(this.scheduled);
    if (this.screen.kind === "busy")
      this.screen.controller.abort();
  }
  menu(items, selected, size, height) {
    const start = Math.max(0, Math.min(selected - Math.floor(height / 2), items.length - height));
    return items.slice(start, start + height).map((item, i) => {
      const active = i + start === selected;
      return line((active ? "\u203A " : "  ") + item, size, active ? "selected" : undefined);
    });
  }
  renderForm(form, size, height) {
    const ui = this.ui();
    const title = line(form.action.title, size, "accent");
    const available = Math.max(1, height - (form.issue ? 2 : 1));
    const fields = form.fields.flatMap((field, index) => {
      const active = form.focus === index;
      const value = form.values[field.id];
      const label = line((active ? "\u203A " : "  ") + field.label + (field.required ? " *" : ""), size, active ? "accent" : "bright");
      if (field.mode === "toggle")
        return [[label, line(value === "on" ? ui.toggleOn : ui.toggleOff, size, active ? "accent" : "dim")]];
      const cursor = form.cursors[field.id];
      const start = lastLineStart(value, cursor);
      const end = nextLineEnd(value, cursor);
      const preceding = value.slice(0, start).split(`
`).slice(0, -1).slice(-2);
      const following = end === value.length ? [] : value.slice(end + 1).split(`
`).slice(0, 1);
      const entries = active ? [
        ...preceding.map((text) => line("  " + text, size, "dim")),
        "  " + fieldLine(cleanLine(value.slice(start, cursor)), cleanLine(value.slice(cursor, end)), size - 2),
        ...following.map((text) => line("  " + text, size, "dim"))
      ] : [line("  " + (value.split(`
`)[0] || field.hint || "\u2014"), size, "dim")];
      return [[label, ...entries]];
    });
    fields.push([line((form.focus === form.fields.length ? "\u203A " : "  ") + ui.continueBtn, size, form.focus === form.fields.length ? "selected" : "dim")]);
    let start = 0;
    while (start < form.focus && fields.slice(start, form.focus + 1).flat().length > available)
      start++;
    const visible = fields.slice(start).flat().slice(0, available);
    return [title, ...visible, ...form.issue ? [line(form.issue, size, "error")] : []];
  }
  render() {
    const ui = this.ui();
    const list = this.currentActions();
    const columns = Math.max(2, process.stdout.columns || 80);
    const rows = Math.max(2, process.stdout.rows || 24);
    const size = columns - 1;
    const screen = this.screen;
    if (columns < 26 || rows < 8) {
      process.stdout.write("\x1B[H\x1B[2K" + line(ui.resizeWindow, size, "accent") + "\x1B[J");
      return;
    }
    const header = [
      line(appTitle, size, "brand"),
      line(`4w ${VERSION}  \xB7  ${ui.subtitle}  \xB7  [${this.lang.toUpperCase()}]`, size, "dim"),
      line("\u2500".repeat(size), size, "dim")
    ];
    const height = rows - header.length - 3;
    let body = [];
    let footer = ui.navigation;
    if (screen.kind === "home") {
      const action = list[screen.index];
      const wide = size >= 82;
      const labels = list.map((entry) => entry.title);
      if (wide) {
        const menuSize = 30;
        const detailsSize = size - menuSize - 4;
        const menu = this.menu(labels, screen.index, menuSize, height);
        const details = [
          line(action.section, detailsSize, "brand"),
          "",
          line(action.title, detailsSize, "accent"),
          "",
          ...wrap(action.description, detailsSize),
          "",
          line(ui.enterToOpen, detailsSize, "dim")
        ];
        body = Array.from({ length: Math.min(height, Math.max(menu.length, details.length)) }, (_, row) => {
          const label = menu[row] ?? "";
          const plain = label.replace(/\x1b\[[\d;]+m/g, "");
          return label + pad("", Math.max(0, menuSize - width(plain))) + paint(" \u2502  ", "dim") + (details[row] ?? "");
        });
      } else {
        body = [line(action.section, size, "brand"), ...this.menu(labels, screen.index, size, Math.max(1, height - 1))];
        footer = size < 34 ? ui.navCompactTiny : ui.navCompactMid;
      }
    } else if (screen.kind === "catalog") {
      body = [
        line(ui.mcpCatalogHeader(screen.tools.length), size, "accent"),
        ...this.menu(screen.tools.map((tool) => tool.name), screen.index, size, Math.max(1, height - 1))
      ];
      footer = ui.catalogFooter;
    } else if (screen.kind === "form") {
      body = this.renderForm(screen, size, height);
      footer = size >= 62 ? ui.formFooterWide : ui.formFooterCompact;
    } else if (screen.kind === "confirm") {
      body = [
        line(ui.confirmHeader, size, "brand"),
        "",
        line(screen.form.action.title, size, "bright"),
        "",
        ...wrap(ui.confirmBody, size)
      ];
      footer = ui.confirmFooter;
    } else if (screen.kind === "busy") {
      body = [
        line(ui.busyHeader, size, "brand"),
        "",
        line(screen.title, size, "accent"),
        ...wrap(ui.busyBody, size)
      ];
      footer = ui.busyFooter;
    } else {
      const status = screen.status === "success" ? screen.reveal ? ui.statusSuccessRevealed : ui.statusSuccess : screen.status === "error" ? ui.statusError : ui.statusHelp;
      body = [line(status, size, screen.status === "error" ? "error" : "brand"), line(screen.title, size, "accent")];
      if (screen.link && height > 4)
        body.push(line(screen.link, size, "success"));
      if (screen.cache?.size !== size || screen.cache.reveal !== screen.reveal) {
        const markdown = screen.edit && (screen.reveal ? screen.edit.content : maskSecrets(screen.edit.content, this.lang));
        const raw = screen.edit ? `${ui.revisionPrefix} ${screen.edit.revision}

${markdown}` : screen.text ?? resultJson(screen.value, screen.reveal, this.lang);
        screen.cache = { size, reveal: screen.reveal, lines: wrap(raw, size) };
      }
      const wrapped = screen.cache.lines;
      const page = Math.max(1, height - body.length);
      this.renderedScroll = Math.max(0, wrapped.length - page);
      screen.offset = Math.max(0, Math.min(screen.offset, this.renderedScroll));
      body.push(...wrapped.slice(screen.offset, screen.offset + page));
      const extra = [
        screen.link ? ui.btnCopy : "",
        screen.edit ? ui.btnEdit : "",
        screen.deleteUrl ? ui.btnDestroy : "",
        screen.status === "success" ? ui.btnCredentials : ""
      ].filter(Boolean);
      footer = [ui.btnBack, ui.btnScroll, ...extra].join("   ");
    }
    const status = this.notice ? line(this.notice, size, "accent") : line("\u2500".repeat(size), size, "dim");
    const visible = body.slice(0, height);
    const frame = [...header, ...visible, ...Array(height - visible.length).fill(""), status, line(footer, size, "dim")];
    process.stdout.write("\x1B[H" + frame.map((row) => "\x1B[2K" + row).join(`\r
`) + "\x1B[J");
  }
}
function openTui(execute) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    let closed = false;
    const cleanup = (error) => {
      if (closed)
        return;
      closed = true;
      app.stop();
      stdin.off("keypress", onKey);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      stdout.off("resize", app.redraw);
      process.off("SIGINT", onEnd);
      process.off("SIGTERM", onEnd);
      process.off("SIGHUP", onEnd);
      process.off("exit", restore);
      try {
        restore();
      } catch (cause) {
        error ??= cause;
      }
      stdin.pause();
      if (error)
        reject(error);
      else
        resolve();
    };
    const app = new Tui(execute, cleanup);
    const restore = () => {
      try {
        stdin.setRawMode(wasRaw);
      } finally {
        stdout.write("\x1B[?2004l\x1B[0m\x1B[?25h\x1B[?1049l");
      }
    };
    const onEnd = () => cleanup();
    const onError = (error) => cleanup(error);
    const onKey = (text, key) => {
      try {
        app.onKey(text, key);
      } catch (error) {
        cleanup(error);
      }
    };
    try {
      emitKeypressEvents(stdin);
      stdin.setRawMode(true);
      stdin.on("keypress", onKey);
      stdin.once("end", onEnd);
      stdin.once("error", onError);
      stdout.on("resize", app.redraw);
      process.once("SIGINT", onEnd);
      process.once("SIGTERM", onEnd);
      process.once("SIGHUP", onEnd);
      process.once("exit", restore);
      stdout.write("\x1B[?1049h\x1B[?25l\x1B[?2004h\x1B[2J");
      stdin.resume();
      app.redraw();
    } catch (error) {
      cleanup(error);
    }
  });
}

// src/cli.ts
async function checkUpdateNotice() {
  if (process.env.FOURWORDS_NO_UPDATE_CHECK === "1")
    return;
  if (process.env.CI || false || process.env.BUN_TEST)
    return;
  if (!process.stderr.isTTY && !process.stdin.isTTY)
    return;
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const cfg = readConfig();
  const lastCheck = typeof cfg.last_update_check === "number" ? cfg.last_update_check : 0;
  const cachedLatest = typeof cfg.cached_latest_version === "string" ? cfg.cached_latest_version : undefined;
  if (cachedLatest && compareSemver(cachedLatest, VERSION) > 0) {
    const lang = resolveLang();
    const notice = lang === "ptbr" ? `\x1B[33m[4w aviso] Nova vers\xE3o dispon\xEDvel (${VERSION} -> ${cachedLatest}). Execute '4w update' para atualizar.\x1B[0m
` : lang === "es" ? `\x1B[33m[4w aviso] Nueva versi\xF3n disponible (${VERSION} -> ${cachedLatest}). Ejecute '4w update' para actualizar.\x1B[0m
` : `\x1B[33m[4w notice] A new version is available (${VERSION} -> ${cachedLatest}). Run '4w update' to update.\x1B[0m
`;
    process.stderr.write(notice);
  }
  if (now - lastCheck > ONE_DAY_MS) {
    try {
      const updateUrl = process.env.FOURWORDS_UPDATE_URL || "https://raw.githubusercontent.com/4words/4w-cli/main/package.json";
      const res = await fetch(updateUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        if (data?.version && typeof data.version === "string") {
          updateConfig({ last_update_check: now, cached_latest_version: data.version });
        }
      }
    } catch {}
  }
}
function extractGlobalLang(rawArgs) {
  const dashDash = rawArgs.indexOf("--");
  const head = dashDash < 0 ? rawArgs : rawArgs.slice(0, dashDash);
  const tail = dashDash < 0 ? [] : rawArgs.slice(dashDash);
  const filtered = [];
  for (let i = 0;i < head.length; i++) {
    const token = head[i];
    if (token === "--lang") {
      const value = head[i + 1];
      const lang = normalizeLang(value);
      if (!lang)
        throw new Error(`Invalid language / Idioma inv\xE1lido: ${value ?? ""}. Use: en, ptbr, es.`);
      try {
        saveLang(lang);
      } catch {}
      process.env.FOURWORDS_LANG = lang;
      i++;
      continue;
    }
    if (token.startsWith("--lang=")) {
      const value = token.slice("--lang=".length);
      const lang = normalizeLang(value);
      if (!lang)
        throw new Error(`Invalid language / Idioma inv\xE1lido: ${value}. Use: en, ptbr, es.`);
      try {
        saveLang(lang);
      } catch {}
      process.env.FOURWORDS_LANG = lang;
      continue;
    }
    filtered.push(token);
  }
  return [...filtered, ...tail];
}
async function main(rawArgs) {
  const args = extractGlobalLang(rawArgs);
  const topic = helpTopic(args);
  if (topic !== undefined)
    return console.log(help(topic));
  if (args[0] === "--version" || args[0] === "version")
    return console.log(`4w ${VERSION}`);
  if (args[0] === "--self-test") {
    if (new TextDecoder().decode(new TextEncoder().encode("4Words \u2713")) !== "4Words \u2713")
      throw new Error("Self-test failed.");
    return console.log(`4w ${VERSION} OK`);
  }
  if (args[0] !== "update")
    checkUpdateNotice();
  if (!args.length || args.length === 1 && args[0] === "tui") {
    if (process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb") {
      return openTui(execute);
    }
    if (args.length) {
      const lang = resolveLang();
      if (lang === "en")
        throw new Error("The interactive panel requires a TTY terminal. Use 4w --help for commands.");
      if (lang === "es")
        throw new Error("El panel necesita una terminal interactiva. Use 4w --help para ver los comandos.");
      throw new Error("O painel precisa de um terminal interativo. Use 4w --help para os comandos.");
    }
    return console.log(help());
  }
  const result = await execute(args);
  if (result && typeof result === "object" && "__raw" in result && result.__raw !== undefined) {
    const raw = result.__raw;
    process.stdout.write(raw);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}
main(process.argv.slice(2)).catch((error) => {
  console.error(`4w: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
