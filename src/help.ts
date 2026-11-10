import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const VERSION = "0.3.2";
export const SITE = "https://4words.aletheia.land";
export const REPO = "https://github.com/4words/4w-cli";

export type Lang = "en" | "ptbr" | "es";

export function configPath(): string | undefined {
  if (process.env.FOURWORDS_CONFIG_FILE) return process.env.FOURWORDS_CONFIG_FILE;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "4Words", "CLI", "config.json");
  }
  if (process.env.HOME) {
    return join(process.env.HOME, ".local", "share", "4words-cli", "config.json");
  }
  return undefined;
}

export function normalizeLang(raw: string | undefined): Lang | undefined {
  if (!raw) return undefined;
  const clean = raw.trim().toLowerCase().replace(/[_-]/g, "");
  if (clean === "en" || clean.startsWith("enus") || clean.startsWith("engb") || clean === "english") return "en";
  if (clean === "ptbr" || clean === "pt" || clean.startsWith("ptpt") || clean.startsWith("portugu")) return "ptbr";
  if (clean === "es" || clean.startsWith("eses") || clean.startsWith("es419") || clean.startsWith("espan")) return "es";
  return undefined;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** Reads config.json as a plain object. Returns {} when the file is missing or invalid. */
export function readConfig(): Record<string, unknown> {
  const file = configPath();
  if (!file) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Missing or damaged file: start with an empty config object.
  }
  return {};
}

/** Merges `patch` into config.json and keeps all other keys. Returns the file path. */
export function updateConfig(patch: Record<string, unknown>): string | undefined {
  const file = configPath();
  if (!file) return undefined;
  const updated = { ...readConfig(), ...patch };
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(updated, null, 2) + "\n", { mode: 0o600 });
  return file;
}

export function readSavedLang(): Lang | undefined {
  const lang = readConfig().lang;
  return typeof lang === "string" ? normalizeLang(lang) : undefined;
}

export function saveLang(lang: Lang): string | undefined {
  return updateConfig({ lang, updated_at: Date.now() });
}

export function resolveLang(explicit?: string): Lang {
  return (
    normalizeLang(explicit) ??
    normalizeLang(process.env.FOURWORDS_LANG) ??
    readSavedLang() ??
    "en"
  );
}

type TopicEntry = {
  label: string;
  usage: string;
  details: string;
  examples: readonly string[];
};

const topicsPt = {
  tui: {
    label: "Painel interativo",
    usage: "4w  |  4w tui",
    details: "Abra o painel do FourWords em um terminal interativo. Com saída redirecionada ou TERM=dumb, 4w sem argumentos imprime esta ajuda.",
    examples: ["4w", "4w tui"],
  },
  lang: {
    label: "Definir e salvar idioma (en, ptbr, es)",
    usage: "4w lang [en|ptbr|es]",
    details: "Consulta ou altera o idioma padrão da interface CLI e TUI (en, ptbr ou es). A escolha fica salva nesta máquina em ~/.local/share/4words-cli/config.json.",
    examples: ["4w lang", "4w lang en", "4w lang ptbr", "4w lang es"],
  },
  doctor: {
    label: "Diagnosticar conexão",
    usage: "4w doctor",
    details: "Conecta ao MCP, negocia a sessão e conta as ferramentas. Exibe JSON com ok, version e tools. A operação não publica conteúdo.",
    examples: ["4w doctor"],
  },
  update: {
    label: "Atualizar o 4w",
    usage: "4w update [--check] [--force]",
    details: "Compara a versão instalada com o instalador publicado no repositório. Se houver versão nova, baixa e executa o instalador oficial, que verifica o SHA-256, compila, faz o autoteste e troca o executável. Se ocorrer uma falha, a versão anterior fica instalada. --check só consulta e não altera nada. --force reinstala a versão publicada, mesmo que seja igual ou que este 4w não seja a cópia gerenciada pelo instalador. Uma vez a cada 24 horas, o 4w avisa no stderr quando existe versão nova. Para desativar o aviso, defina FOURWORDS_NO_UPDATE_CHECK=1.",
    examples: ["4w update --check", "4w update", "4w update --force"],
  },
  text: {
    label: "Publicar texto",
    usage: "4w text TEXTO | 4w text --file ARQUIVO | 4w text - [--burn] [--encrypt]",
    details: "Publica até 100.000 bytes de texto UTF-8, inclusive Markdown. Use aspas em TEXTO, --file para um arquivo ou - para stdin. --burn ativa leitura única. --encrypt aplica criptografia local AES-256-GCM Zero-Knowledge e anexa #key= ao link.",
    examples: ['4w text "Olá, FourWords!"', "4w text --file notas.md --burn", "4w text --file segredo.md --burn --encrypt", 'printf "%s\\n" "Texto do pipe" | 4w text -', '4w text -- "--texto iniciado por hífen"'],
  },
  file: {
    label: "Publicar arquivo",
    usage: "4w file ARQUIVO [--burn] [--stream] [--encrypt] [--type MIME]",
    details: "Envia um arquivo regular de até 24 MiB pelo MCP ou até 1 GiB via streaming HTTP (--stream ou automático acima de 24 MiB). --burn ativa leitura única. --encrypt criptografa localmente com AES-256-GCM antes do upload.",
    examples: ['4w file "relatório final.pdf" --burn', "4w file backup.zip --stream", "4w file chaves.tar.gz --burn --encrypt"],
  },
  get: {
    label: "Abrir ou baixar link de 4 palavras",
    usage: "4w get LINK_OU_COMBO [--output ARQUIVO] [--raw] [--key CHAVE]",
    details: "Recupera texto ou arquivo a partir de uma URL FourWords ou código de 4 palavras e 9 dígitos. Se a URL contiver #key= (ou --key for informado), descriptografa automaticamente no cliente. Use --raw para enviar o conteúdo puro ao stdout ou --output para salvar em arquivo.",
    examples: ["4w get lua-gato-sol-rio-123456789", "4w get lua-gato-sol-rio-123456789 --raw", "4w get https://4words.aletheia.land/lua-gato-sol-rio-123456789 --output relatorio.pdf"],
  },
  delete: {
    label: "Destruir conteúdo imediatamente",
    usage: "4w delete URL_DE_DESTRUICAO",
    details: "Purga irreversivelmente um texto ou arquivo antes da expiração de 24 horas usando a delete_url secreta (/d/<sha512>) emitida na publicação.",
    examples: ['4w delete "https://4words.aletheia.land/d/..."'],
  },
  history: {
    label: "Consultar cofre local de 24 horas",
    usage: "4w history [--clear]",
    details: "Lista os links, delete_url, admin_key e llm_key gerados neste perfil nas últimas 24 horas. Registros expirados são removidos automaticamente. Use --clear para apagar o histórico local.",
    examples: ["4w history", "4w history --clear"],
  },
  room: {
    label: "Trabalhar em salas",
    usage: "4w room <create|join|send|send-file|messages|doc|save|wait|participants|nick|register-llm|moderate> [ARGUMENTOS]",
    details: "SALA aceita uma URL de sala ou seu código de quatro palavras e nove dígitos. Consulte os tópicos abaixo para argumentos e exemplos.",
    examples: ["4w room create", "4w help room save", "4w help room wait"],
  },
  "room create": {
    label: "Criar sala",
    usage: "4w room create [--doc ARQUIVO] [--message TEXTO] [--llm-name NOME]",
    details: "Cria uma sala e devolve links e credenciais quando emitidas pelo servidor. --doc carrega Markdown inicial UTF-8 de até 50.000 unidades UTF-16 (use --doc - para stdin). --message publica uma mensagem inicial e --llm-name identifica o agente autor.",
    examples: ["4w room create --doc pauta.md", '4w room create --doc pauta.md --message "Sala iniciada" --llm-name claude'],
  },
  "room join": {
    label: "Entrar na sala",
    usage: "4w room join SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Registra sua entrada e retorna o apelido, participantes e o estado inicial da sala.",
    examples: ['4w room join "$SALA"', '4w room join "$SALA" --llm-key "$LLM_KEY" --llm-name gemini'],
  },
  "room send": {
    label: "Enviar mensagem",
    usage: "4w room send SALA TEXTO [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Envia uma mensagem à sala. Informe a mensagem em um único argumento entre aspas.",
    examples: ['4w room send "$SALA" "Começamos em cinco minutos."', '4w room send "$SALA" "Análise concluída." --llm-key "$LLM_KEY" --llm-name claude'],
  },
  "room send-file": {
    label: "Enviar arquivo na sala",
    usage: "4w room send-file SALA ARQUIVO [--text MENSAGEM] [--nick APELIDO] [--burn] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Envia um arquivo de até 24 MiB diretamente para os participantes da sala e retorna a delete_url privada ao remetente.",
    examples: ['4w room send-file "$SALA" relatorio.pdf --text "Segue o PDF" --burn'],
  },
  "room messages": {
    label: "Ler mensagens",
    usage: "4w room messages SALA [--since N] [--mentions-only] [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Lê as mensagens disponíveis. --since aceita uma sequência não negativa e consulta apenas mensagens posteriores a ela. --mentions-only filtra apenas menções @apelido.",
    examples: ['4w room messages "$SALA" --since 42', '4w room messages "$SALA" --mentions-only --llm-key "$LLM_KEY"'],
  },
  "room doc": {
    label: "Ler Markdown",
    usage: "4w room doc SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Exibe o Markdown compartilhado, histórico de revisões e sua revisão updated_at. Guarde essa revisão para salvar uma edição com controle de concorrência.",
    examples: ['4w room doc "$SALA"'],
  },
  "room save": {
    label: "Salvar Markdown",
    usage: "4w room save SALA [ARQUIVO|-] --base N [--rollback-version V] [--rollback-ts TS] [--export-link] [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Salva Markdown UTF-8 de até 50.000 unidades UTF-16 ou restaura uma versão anterior. Passe em --base o updated_at da versão que você editou, ou 0 para uma sala sem revisão. Use - no lugar do arquivo para ler stdin. Se houver conflito, releia o documento e incorpore as mudanças.",
    examples: ['4w room doc "$SALA"', '4w room save "$SALA" revisado.md --base 1780000000000', '4w room save "$SALA" --rollback-version 1'],
  },
  "room wait": {
    label: "Aguardar eventos em tempo real",
    usage: "4w room wait SALA [--since N] [--since-doc TS] [--timeout SEGUNDOS] [--all] [--nick APELIDO] [--llm-key CHAVE] [--llm-name NOME]",
    details: "Realiza long-polling aguardando novas mensagens, menções @apelido ou edições no documento Markdown colaborativo. Use --all para receber todas as mensagens mesmo quando autenticado com --llm-key.",
    examples: ['4w room wait "$SALA" --since 0 --timeout 20', '4w room wait "$SALA" --llm-key "$LLM_KEY" --llm-name claude'],
  },
  "room participants": {
    label: "Listar participantes ativos",
    usage: "4w room participants SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Lista todos os participantes humanos e agentes LLM ativos na sala.",
    examples: ['4w room participants "$SALA"'],
  },
  "room nick": {
    label: "Sortear novo apelido",
    usage: "4w room nick SALA [--llm-key CHAVE] [--llm-name NOME]",
    details: "Sorteia um novo apelido aleatório vinculado ao IP ou sessão atual na sala.",
    examples: ['4w room nick "$SALA"'],
  },
  "room register-llm": {
    label: "Registrar agente LLM",
    usage: "4w room register-llm SALA --llm-key CHAVE [--llm-name NOME]",
    details: "Autentica um agente de IA usando a llm_key da sala para exibir o selo dourado de LLM e receber eventos.",
    examples: ['4w room register-llm "$SALA" --llm-key "$LLM_KEY" --llm-name claude'],
  },
  "room moderate": {
    label: "Moderar sala",
    usage: "4w room moderate SALA <ban|unban|list|verify> --admin-key CHAVE [--nick APELIDO] [--ban-id ID]",
    details: "Verifica a admin_key, lista banimentos ativos, bane ou desbane participantes abusivos por apelido ou ban_id.",
    examples: ['4w room moderate "$SALA" list --admin-key "$ADMIN_KEY"', '4w room moderate "$SALA" ban --admin-key "$ADMIN_KEY" --nick invasor'],
  },
  mcp: {
    label: "Explorar o MCP",
    usage: "4w mcp <list|call> [ARGUMENTOS]",
    details: "Descubra o contrato atual do servidor e invoque ferramentas pelo nome. O catálogo vem do endpoint MCP durante a consulta.",
    examples: ["4w mcp list", "4w help mcp call"],
  },
  "mcp list": {
    label: "Listar ferramentas",
    usage: "4w mcp list",
    details: "Consulta o catálogo atual e exibe um array JSON com ferramentas, descrições e esquemas de entrada.",
    examples: ["4w mcp list"],
  },
  "mcp call": {
    label: "Chamar ferramenta",
    usage: "4w mcp call FERRAMENTA [OBJETO_JSON|-]",
    details: "Envia um objeto JSON como argumentos. O padrão é {}. Use - para ler de stdin, especialmente quando o JSON contiver chaves. Consulte mcp list para ver os campos exigidos por cada operação.",
    examples: ['4w mcp call upload_text \'{"content":"Olá","burn":true}\'', "4w mcp call chat_participants - < argumentos.json"],
  },
} as const satisfies Record<string, TopicEntry>;

export type Topic = keyof typeof topicsPt;

const topicsEn: Record<Topic, TopicEntry> = {
  tui: {
    label: "Interactive panel",
    usage: "4w  |  4w tui",
    details: "Open the FourWords interactive terminal panel. When output is redirected or TERM=dumb, 4w with no arguments prints this help.",
    examples: ["4w", "4w tui"],
  },
  lang: {
    label: "Set and save language (en, ptbr, es)",
    usage: "4w lang [en|ptbr|es]",
    details: "Shows or changes the default CLI and TUI language (en, ptbr, or es). The selected option is saved and remembered on this machine in ~/.local/share/4words-cli/config.json.",
    examples: ["4w lang", "4w lang en", "4w lang ptbr", "4w lang es"],
  },
  doctor: {
    label: "Diagnose connection",
    usage: "4w doctor",
    details: "Connects to the MCP endpoint, negotiates protocol and counts available tools. Outputs JSON with ok, version and tools.",
    examples: ["4w doctor"],
  },
  update: {
    label: "Update 4w",
    usage: "4w update [--check] [--force]",
    details: "Compares the installed version with the installer published in the repository. If a newer version exists, downloads and runs the official installer, which verifies the SHA-256, compiles, runs the self-test and replaces the executable. If a step fails, the previous version stays installed. --check only reports and changes nothing. --force reinstalls the published version, also when it is the same version or when this 4w is not the copy managed by the installer. Once every 24 hours, 4w writes a notice to stderr when a newer version exists. Set FOURWORDS_NO_UPDATE_CHECK=1 to disable the notice.",
    examples: ["4w update --check", "4w update", "4w update --force"],
  },
  text: {
    label: "Publish text",
    usage: "4w text TEXT | 4w text --file FILE | 4w text - [--burn] [--encrypt]",
    details: "Publishes up to 100,000 bytes of UTF-8 text or Markdown. Use --burn for burn-after-reading and --encrypt for client-side AES-256-GCM Zero-Knowledge encryption.",
    examples: ['4w text "Hello, FourWords!"', "4w text --file notes.md --burn", "4w text --file secret.md --burn --encrypt"],
  },
  file: {
    label: "Publish file",
    usage: "4w file FILE [--burn] [--stream] [--encrypt] [--type MIME]",
    details: "Uploads a regular file up to 24 MiB via MCP or up to 1 GiB via HTTP streaming (--stream or automatic above 24 MiB). --burn enables single read. --encrypt encrypts locally with AES-256-GCM.",
    examples: ['4w file "final report.pdf" --burn', "4w file archive.zip --stream"],
  },
  get: {
    label: "Open or download 4-word link",
    usage: "4w get LINK_OR_COMBO [--output FILE] [--raw] [--key KEY]",
    details: "Fetches text or binary file from a FourWords URL or 4-word + 9-digit combo. Automatically decrypts if #key= or --key is provided. Use --raw to write raw content to stdout or --output to save to a file.",
    examples: ["4w get lua-gato-sol-rio-123456789", "4w get lua-gato-sol-rio-123456789 --raw"],
  },
  delete: {
    label: "Destroy content immediately",
    usage: "4w delete DELETE_URL",
    details: "Irreversibly purges published text or file before the 24-hour expiration using its secret delete_url (/d/<sha512>).",
    examples: ['4w delete "https://4words.aletheia.land/d/..."'],
  },
  history: {
    label: "Inspect local 24-hour vault",
    usage: "4w history [--clear]",
    details: "Lists links, delete_url, admin_key and llm_key created in this user profile within the last 24 hours. Use --clear to wipe local history.",
    examples: ["4w history", "4w history --clear"],
  },
  room: {
    label: "Collaborate in rooms",
    usage: "4w room <create|join|send|send-file|messages|doc|save|wait|participants|nick|register-llm|moderate> [ARGS]",
    details: "ROOM accepts a room URL or its four-word + nine-digit code. See subcommands below for details.",
    examples: ["4w room create", "4w help room save", "4w help room wait"],
  },
  "room create": {
    label: "Create room",
    usage: "4w room create [--doc FILE] [--message TEXT] [--llm-name NAME]",
    details: "Creates a collaboration room and returns URLs and keys. --doc loads initial UTF-8 Markdown up to 50,000 UTF-16 code units.",
    examples: ["4w room create --doc agenda.md"],
  },
  "room join": {
    label: "Join room",
    usage: "4w room join ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Joins the room and returns your assigned nickname, participants and initial state.",
    examples: ['4w room join "$ROOM"'],
  },
  "room send": {
    label: "Send message",
    usage: "4w room send ROOM TEXT [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Posts a message to the room.",
    examples: ['4w room send "$ROOM" "Starting in five minutes."'],
  },
  "room send-file": {
    label: "Send file to room",
    usage: "4w room send-file ROOM FILE [--text MESSAGE] [--nick NICK] [--burn] [--llm-key KEY] [--llm-name NAME]",
    details: "Uploads a file up to 24 MiB to the room and returns the private delete_url.",
    examples: ['4w room send-file "$ROOM" report.pdf --text "Attached report" --burn'],
  },
  "room messages": {
    label: "Read messages",
    usage: "4w room messages ROOM [--since N] [--mentions-only] [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Polls messages since sequence cursor N.",
    examples: ['4w room messages "$ROOM" --since 42'],
  },
  "room doc": {
    label: "Read Markdown",
    usage: "4w room doc ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Fetches the shared Markdown document and its updated_at revision.",
    examples: ['4w room doc "$ROOM"'],
  },
  "room save": {
    label: "Save Markdown",
    usage: "4w room save ROOM [FILE|-] --base N [--rollback-version V] [--rollback-ts TS] [--export-link] [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Saves UTF-8 Markdown up to 50,000 UTF-16 units with optimistic concurrency (--base updated_at) or rolls back to a prior version.",
    examples: ['4w room doc "$ROOM"', '4w room save "$ROOM" revised.md --base 1780000000000'],
  },
  "room wait": {
    label: "Wait for live room events",
    usage: "4w room wait ROOM [--since N] [--since-doc TS] [--timeout SECONDS] [--all] [--nick NICK] [--llm-key KEY] [--llm-name NAME]",
    details: "Long-polls for new messages, @mentions or collaborative Markdown edits.",
    examples: ['4w room wait "$ROOM" --since 0 --timeout 20'],
  },
  "room participants": {
    label: "List active participants",
    usage: "4w room participants ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Lists active human and LLM participants in the room.",
    examples: ['4w room participants "$ROOM"'],
  },
  "room nick": {
    label: "Roll random nickname",
    usage: "4w room nick ROOM [--llm-key KEY] [--llm-name NAME]",
    details: "Rolls a new random animal-noun nickname for the caller.",
    examples: ['4w room nick "$ROOM"'],
  },
  "room register-llm": {
    label: "Register LLM agent",
    usage: "4w room register-llm ROOM --llm-key KEY [--llm-name NAME]",
    details: "Authenticates with the room llm_key to appear as a golden LLM agent.",
    examples: ['4w room register-llm "$ROOM" --llm-key "$LLM_KEY" --llm-name claude'],
  },
  "room moderate": {
    label: "Moderate room",
    usage: "4w room moderate ROOM <ban|unban|list|verify> --admin-key KEY [--nick NICK] [--ban-id ID]",
    details: "Verifies admin_key, lists active bans, or bans/unbans abusive IPs.",
    examples: ['4w room moderate "$ROOM" list --admin-key "$ADMIN_KEY"'],
  },
  mcp: {
    label: "Explore MCP",
    usage: "4w mcp <list|call> [ARGS]",
    details: "Discover the live server contract and invoke tools by name.",
    examples: ["4w mcp list", "4w help mcp call"],
  },
  "mcp list": {
    label: "List tools",
    usage: "4w mcp list",
    details: "Queries the live catalog and outputs a JSON array of tools and input schemas.",
    examples: ["4w mcp list"],
  },
  "mcp call": {
    label: "Call tool",
    usage: "4w mcp call TOOL [JSON_OBJECT|-]",
    details: "Sends a JSON object as arguments. Defaults to {}. Use - to read from stdin.",
    examples: ['4w mcp call upload_text \'{"content":"Hello","burn":true}\'', "4w mcp call chat_participants - < args.json"],
  },
};

const topicsEs: Record<Topic, TopicEntry> = {
  tui: {
    label: "Panel interactivo",
    usage: "4w  |  4w tui",
    details: "Abre el panel interactivo de FourWords. Con salida redirigida o TERM=dumb, 4w sin argumentos imprime esta ayuda.",
    examples: ["4w", "4w tui"],
  },
  lang: {
    label: "Definir y guardar idioma (en, ptbr, es)",
    usage: "4w lang [en|ptbr|es]",
    details: "Consulta o cambia el idioma predeterminado de la interfaz CLI y TUI (en, ptbr o es). La preferencia se guarda en esta máquina en ~/.local/share/4words-cli/config.json.",
    examples: ["4w lang", "4w lang en", "4w lang ptbr", "4w lang es"],
  },
  doctor: {
    label: "Diagnosticar conexión",
    usage: "4w doctor",
    details: "Conecta al MCP, negocia la sesión y cuenta las herramientas disponibles.",
    examples: ["4w doctor"],
  },
  update: {
    label: "Actualizar 4w",
    usage: "4w update [--check] [--force]",
    details: "Compara la versión instalada con el instalador publicado en el repositorio. Si hay una versión nueva, descarga y ejecuta el instalador oficial, que verifica el SHA-256, compila, ejecuta la autoprueba y reemplaza el ejecutable. Si un paso falla, la versión anterior queda instalada. --check solo consulta y no cambia nada. --force reinstala la versión publicada, también si es la misma versión o si este 4w no es la copia gestionada por el instalador. Una vez cada 24 horas, 4w avisa en stderr cuando hay una versión nueva. Defina FOURWORDS_NO_UPDATE_CHECK=1 para desactivar el aviso.",
    examples: ["4w update --check", "4w update", "4w update --force"],
  },
  text: {
    label: "Publicar texto",
    usage: "4w text TEXTO | 4w text --file ARCHIVO | 4w text - [--burn] [--encrypt]",
    details: "Publica hasta 100.000 bytes de texto UTF-8 o Markdown. Use --burn para lectura única y --encrypt para cifrado local AES-256-GCM Zero-Knowledge.",
    examples: ['4w text "¡Hola, FourWords!"', "4w text --file notas.md --burn", "4w text --file secreto.md --burn --encrypt"],
  },
  file: {
    label: "Publicar archivo",
    usage: "4w file ARCHIVO [--burn] [--stream] [--encrypt] [--type MIME]",
    details: "Sube un archivo de hasta 24 MiB por MCP o hasta 1 GiB por streaming HTTP (--stream o automático sobre 24 MiB). --burn activa lectura única. --encrypt cifra localmente con AES-256-GCM.",
    examples: ['4w file "informe final.pdf" --burn', "4w file copia.zip --stream"],
  },
  get: {
    label: "Abrir o descargar enlace de 4 palabras",
    usage: "4w get ENLACE_O_CODIGO [--output ARCHIVO] [--raw] [--key CLAVE]",
    details: "Recupera texto o archivo desde una URL de FourWords o código de 4 palabras y 9 dígitos. Descifra automáticamente si incluye #key= o --key.",
    examples: ["4w get lua-gato-sol-rio-123456789", "4w get lua-gato-sol-rio-123456789 --raw"],
  },
  delete: {
    label: "Destruir contenido inmediatamente",
    usage: "4w delete URL_DE_DESTRUCCION",
    details: "Elimina irreversiblemente un texto o archivo antes de las 24 horas usando su delete_url secreta (/d/<sha512>).",
    examples: ['4w delete "https://4words.aletheia.land/d/..."'],
  },
  history: {
    label: "Consultar bóveda local de 24 horas",
    usage: "4w history [--clear]",
    details: "Lista los enlaces, delete_url, admin_key y llm_key generados en este perfil en las últimas 24 horas. Use --clear para limpiar el historial.",
    examples: ["4w history", "4w history --clear"],
  },
  room: {
    label: "Colaborar en salas",
    usage: "4w room <create|join|send|send-file|messages|doc|save|wait|participants|nick|register-llm|moderate> [ARGUMENTOS]",
    details: "SALA acepta una URL de sala o su código de cuatro palabras y nueve dígitos.",
    examples: ["4w room create", "4w help room save", "4w help room wait"],
  },
  "room create": {
    label: "Crear sala",
    usage: "4w room create [--doc ARCHIVO] [--message TEXTO] [--llm-name NOMBRE]",
    details: "Crea una sala colaborativa y devuelve enlaces y credenciales.",
    examples: ["4w room create --doc agenda.md"],
  },
  "room join": {
    label: "Entrar en la sala",
    usage: "4w room join SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Registra su entrada y devuelve su apodo, participantes y estado inicial.",
    examples: ['4w room join "$SALA"'],
  },
  "room send": {
    label: "Enviar mensaje",
    usage: "4w room send SALA TEXTO [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Envía un mensaje a la sala.",
    examples: ['4w room send "$SALA" "Empezamos en cinco minutos."'],
  },
  "room send-file": {
    label: "Enviar archivo a la sala",
    usage: "4w room send-file SALA ARCHIVO [--text MENSAJE] [--nick APODO] [--burn] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Envía un archivo de hasta 24 MiB directamente a la sala y devuelve la delete_url privada.",
    examples: ['4w room send-file "$SALA" informe.pdf --text "Adjunto informe" --burn'],
  },
  "room messages": {
    label: "Leer mensajes",
    usage: "4w room messages SALA [--since N] [--mentions-only] [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Lee los mensajes disponibles desde la secuencia N.",
    examples: ['4w room messages "$SALA" --since 42'],
  },
  "room doc": {
    label: "Leer Markdown",
    usage: "4w room doc SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Obtiene el documento Markdown compartido y su revisión updated_at.",
    examples: ['4w room doc "$SALA"'],
  },
  "room save": {
    label: "Guardar Markdown",
    usage: "4w room save SALA [ARCHIVO|-] --base N [--rollback-version V] [--rollback-ts TS] [--export-link] [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Guarda Markdown UTF-8 con control de concurrencia (--base updated_at) o restaura una versión anterior.",
    examples: ['4w room doc "$SALA"', '4w room save "$SALA" revisado.md --base 1780000000000'],
  },
  "room wait": {
    label: "Esperar eventos en tiempo real",
    usage: "4w room wait SALA [--since N] [--since-doc TS] [--timeout SEGUNDOS] [--all] [--nick APODO] [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Realiza long-polling esperando nuevos mensajes, menciones @apodo o ediciones en el Markdown.",
    examples: ['4w room wait "$SALA" --since 0 --timeout 20'],
  },
  "room participants": {
    label: "Listar participantes activos",
    usage: "4w room participants SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Lista todos los participantes humanos y agentes LLM activos en la sala.",
    examples: ['4w room participants "$SALA"'],
  },
  "room nick": {
    label: "Sortear nuevo apodo",
    usage: "4w room nick SALA [--llm-key CLAVE] [--llm-name NOMBRE]",
    details: "Sortea un nuevo apodo aleatorio en la sala.",
    examples: ['4w room nick "$SALA"'],
  },
  "room register-llm": {
    label: "Registrar agente LLM",
    usage: "4w room register-llm SALA --llm-key CLAVE [--llm-name NOMBRE]",
    details: "Autentica un agente usando la llm_key de la sala.",
    examples: ['4w room register-llm "$SALA" --llm-key "$LLM_KEY" --llm-name claude'],
  },
  "room moderate": {
    label: "Moderar sala",
    usage: "4w room moderate SALA <ban|unban|list|verify> --admin-key CLAVE [--nick APODO] [--ban-id ID]",
    details: "Verifica la admin_key, lista bloqueos activos, bloquea o desbloquea participantes.",
    examples: ['4w room moderate "$SALA" list --admin-key "$ADMIN_KEY"'],
  },
  mcp: {
    label: "Explorar MCP",
    usage: "4w mcp <list|call> [ARGUMENTOS]",
    details: "Descubre el contrato actual del servidor e invoca herramientas por su nombre.",
    examples: ["4w mcp list", "4w help mcp call"],
  },
  "mcp list": {
    label: "Listar herramientas",
    usage: "4w mcp list",
    details: "Consulta el catálogo actual y muestra un array JSON con herramientas y esquemas.",
    examples: ["4w mcp list"],
  },
  "mcp call": {
    label: "Llamar herramienta",
    usage: "4w mcp call HERRAMIENTA [OBJETO_JSON|-]",
    details: "Envía un objeto JSON como argumentos. Por defecto es {}. Use - para leer desde stdin.",
    examples: ['4w mcp call upload_text \'{"content":"Hola","burn":true}\'', "4w mcp call chat_participants - < args.json"],
  },
};

function catalogFor(lang: Lang): Record<Topic, TopicEntry> {
  if (lang === "en") return topicsEn;
  if (lang === "es") return topicsEs;
  return topicsPt;
}

export function help(topic?: string, lang = resolveLang()): string {
  const dict = catalogFor(lang);
  if (topic) {
    if (!Object.hasOwn(dict, topic)) {
      if (lang === "en") throw new Error(`Unknown topic: ${topic}. See 4w --help.`);
      if (lang === "es") throw new Error(`Tema desconocido: ${topic}. Consulte 4w --help.`);
      throw new Error(`Tópico desconhecido: ${topic}. Consulte 4w --help.`);
    }
    const entry = dict[topic as Topic];
    const children = Object.entries(dict).filter(([key]) => key.startsWith(topic + " "));
    const usageHeading = lang === "en" ? "USAGE" : "USO";
    const examplesHeading = lang === "en" ? "EXAMPLES" : lang === "es" ? "EJEMPLOS" : "EXEMPLOS";
    const subHeading = lang === "en" ? "SUBCOMMANDS" : "SUBCOMANDOS";
    const footer = lang === "en" ? "General help  4w --help" : lang === "es" ? "Ayuda general  4w --help" : "Ajuda geral  4w --help";
    return [
      `4w ${VERSION} · ${entry.label}`, "", usageHeading, "  " + entry.usage, "", entry.details,
      "", examplesHeading, ...entry.examples.map((line) => "  " + line),
      ...(children.length ? ["", subHeading, ...children.map(([key, child]) => `  ${key.padEnd(18)} ${child.label}`)] : []),
      "", footer,
    ].join("\n");
  }
  if (lang === "en") {
    return `4w ${VERSION} · FourWords in the terminal

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
    return `4w ${VERSION} · FourWords en la terminal

Comparta texto y archivos con enlaces de cuatro palabras, colabore en salas en
tiempo real y ejecute herramientas MCP. Ejecute 4w sin argumentos para abrir el panel.

USO
  4w                            Abre el panel interactivo
  4w COMANDO [ARGUMENTOS]       Ejecuta un comando y escribe JSON en stdout
  4w lang [en|ptbr|es]          Muestra o cambia y guarda el idioma en esta máquina
  4w update [--check] [--force] Consulta actualizaciones y actualiza 4w
  4w help [COMANDO ...]         Muestra la ayuda de un comando
  4w --version                  Muestra la versión instalada

COMPARTIR Y BÓVEDA
  4w text TEXTO | --file ARCHIVO | -   Publica texto o Markdown [--burn] [--encrypt]
  4w file ARCHIVO                      Publica archivo de hasta 24 MiB o 1 GiB [--burn] [--stream] [--encrypt]
  4w get ENLACE_O_CODIGO               Abre o descarga enlace de 4 palabras [--output ARCH] [--raw] [--key CLAVE]
  4w delete URL_DE_DESTRUCCION         Elimina contenido inmediatamente con su delete_url secreta
  4w history [--clear]                 Lista o limpia la bóveda local de claves de las últimas 24h

SALAS
  4w room create [--doc ARCHIVO]       Crea una sala con Markdown opcional
  4w room join SALA                    Entra en la sala
  4w room send SALA TEXTO              Envía un mensaje
  4w room send-file SALA ARCHIVO       Envía un archivo a la sala [--burn]
  4w room messages SALA [--since N]    Lee mensajes y sigue el cursor de secuencia
  4w room doc SALA                     Lee el Markdown compartido y su revisión actual
  4w room save SALA ARCHIVO --base N   Guarda Markdown con control de concurrencia
  4w room wait SALA [--since N]        Espera mensajes, @menciones o ediciones en vivo
  4w room participants SALA            Lista participantes humanos y LLMs activos
  4w room nick SALA                    Sortea un nuevo apodo en la sala
  4w room register-llm SALA            Registra agente LLM con --llm-key
  4w room moderate SALA ACCION         Modera la sala (ban, unban, list, verify) con --admin-key

MCP Y DIAGNÓSTICO
  4w mcp list                          Lista herramientas y esquemas de entrada
  4w mcp call HERRAMIENTA [JSON|-]     Invoca una herramienta MCP directamente
  4w doctor                            Prueba la conexión con FourWords

EJEMPLOS
  4w text "¡Hola, FourWords!"
  4w file "informe.pdf" --burn
  4w get lua-gato-sol-rio-123456789 --raw
  4w lang es
  4w help room save

SALA acepta el enlace de una sala o su código de cuatro palabras y nueve dígitos.
FOURWORDS_MCP_URL cambia el endpoint MCP (por defecto ${SITE}/mcp).
El idioma (por defecto: en) se guarda con '4w lang <en|ptbr|es>' o con FOURWORDS_LANG.
Instalación, actualización y eliminación   ${REPO}`;
  }
  return `4w ${VERSION} · FourWords no terminal

Compartilhe texto e arquivos com links de quatro palavras, colabore em salas
e use o MCP em automações. Execute 4w sem argumentos para abrir o painel.

USO
  4w                            Abre o painel interativo
  4w COMANDO [ARGUMENTOS]       Executa um comando e escreve o resultado em JSON
  4w lang [en|ptbr|es]          Mostra ou altera e salva o idioma nesta máquina
  4w update [--check] [--force] Verifica atualizações e atualiza o 4w
  4w help [COMANDO ...]         Abre a ajuda de um comando
  4w --version                  Mostra a versão instalada

COMPARTILHAMENTO E COFRE
  4w text TEXTO | --file ARQUIVO | -   Publica texto ou Markdown [--burn] [--encrypt]
  4w file ARQUIVO                      Publica arquivo de até 24 MiB ou 1 GiB [--burn] [--stream] [--encrypt]
  4w get LINK_OU_COMBO                 Abre ou baixa link de 4 palavras [--output ARQ] [--raw] [--key CHAVE]
  4w delete URL_DE_DESTRUICAO          Apaga conteúdo imediatamente com a delete_url secreta
  4w history [--clear]                 Lista ou limpa o cofre local de chaves das últimas 24h

SALAS
  4w room create [--doc ARQUIVO]       Cria uma sala com Markdown opcional
  4w room join SALA                    Entra na sala
  4w room send SALA TEXTO              Envia uma mensagem
  4w room send-file SALA ARQUIVO       Envia um arquivo para a sala [--burn]
  4w room messages SALA [--since N]    Lê mensagens e acompanha o cursor
  4w room doc SALA                     Lê Markdown e a revisão atual
  4w room save SALA ARQUIVO --base N   Salva Markdown com controle de revisão
  4w room wait SALA [--since N]        Aguarda mensagens, @menções ou edições ao vivo
  4w room participants SALA            Lista participantes humanos e LLMs ativos
  4w room nick SALA                    Sorteia um novo apelido na sala
  4w room register-llm SALA            Registra agente LLM com --llm-key
  4w room moderate SALA ACAO           Modera a sala (ban, unban, list, verify) com --admin-key

MCP E DIAGNÓSTICO
  4w mcp list                          Lista ferramentas e esquemas de entrada
  4w mcp call FERRAMENTA [JSON|-]      Invoca uma ferramenta do MCP
  4w doctor                            Testa a conexão com o FourWords

EXEMPLOS
  4w text "Olá, FourWords!"
  4w file "meu relatório.pdf" --burn
  4w get lua-gato-sol-rio-123456789 --raw
  4w lang ptbr
  4w help room save

SALA aceita o link de uma sala ou o código de quatro palavras e nove dígitos.
--burn ativa a leitura única. --encrypt aplica criptografia local AES-256-GCM.
Resultados e chaves saem em JSON no stdout. Erros vão para stderr com código 1.
FOURWORDS_MCP_URL altera o endpoint MCP. O padrão é ${SITE}/mcp.
O idioma (padrão: en) pode ser salvo com '4w lang <en|ptbr|es>' ou definido via FOURWORDS_LANG.
Instalação, atualização e remoção   ${REPO}`;
}

export function helpTopic(args: string[]): string | undefined {
  if (args[0] === "help") return args.slice(1).join(" ");
  const end = args.indexOf("--");
  const options = end < 0 ? args : args.slice(0, end);
  if (options[0] === "--help" || options[0] === "-h") return "";
  const subcommand = ["room", "mcp"].includes(options[0]) && options[1] && !options[1].startsWith("-");
  const offset = subcommand ? 2 : 1;
  if (options.length === offset + 1 && ["--help", "-h"].includes(options[offset])) {
    return options.slice(0, offset).join(" ");
  }
}
