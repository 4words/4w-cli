import { resolveLang, type Lang, type Topic } from "./help";

export type Field = {
  id: string;
  label: string;
  hint?: string;
  mode?: "multiline" | "toggle";
  initial?: string;
  required?: boolean;
};
export type Values = Record<string, string>;
export type Job = { args: string[]; input?: string };
export type Action = {
  id: Topic;
  section: string;
  title: string;
  description: string;
  fields?: Field[];
  write?: boolean;
  job: (values: Values) => Job;
};

const burnFlag = (values: Values) => values.burn === "off" ? ["--no-burn"] : ["--burn"];
const encryptFlag = (values: Values) => values.encrypt === "on" ? ["--encrypt"] : [];
const streamFlag = (values: Values) => values.stream === "on" ? ["--stream"] : [];
const llmFlags = (values: Values) => [
  ...(values.llm_key?.trim() ? ["--llm-key", values.llm_key.trim()] : []),
  ...(values.llm_name?.trim() ? ["--llm-name", values.llm_name.trim()] : []),
];

type Copy = {
  secPublish: string;
  secRooms: string;
  secTools: string;
  roomLabel: string;
  roomHint: string;
  burnLabel: string;
  burnHint: string;
  encryptLabel: string;
  encryptHint: string;
  streamLabel: string;
  streamHint: string;
  fileLabel: string;
  fileHint: string;
  llmKeyLabel: string;
  llmKeyHint: string;
  llmNameLabel: string;
  llmNameHint: string;
  textTitle: string;
  textDesc: string;
  textField: string;
  fileTitle: string;
  fileDesc: string;
  roomCreateTitle: string;
  roomCreateDesc: string;
  initialMd: string;
  initialMsg: string;
  optional: string;
  roomJoinTitle: string;
  roomJoinDesc: string;
  roomMessagesTitle: string;
  roomMessagesDesc: string;
  sinceLabel: string;
  sinceHint: string;
  mentionsLabel: string;
  roomSendTitle: string;
  roomSendDesc: string;
  msgLabel: string;
  roomDocTitle: string;
  roomDocDesc: string;
  roomSaveTitle: string;
  roomSaveDesc: string;
  baseLabel: string;
  baseHint: string;
  mcpListTitle: string;
  mcpListDesc: string;
  doctorTitle: string;
  doctorDesc: string;
  getTitle: string;
  getDesc: string;
  getTargetLabel: string;
  getTargetHint: string;
  getOutputLabel: string;
  getOutputHint: string;
  getKeyLabel: string;
  getKeyHint: string;
  deleteTitle: string;
  deleteDesc: string;
  deleteUrlLabel: string;
  roomSendFileTitle: string;
  roomSendFileDesc: string;
  optMsgLabel: string;
  optMsgHint: string;
  roomWaitTitle: string;
  roomWaitDesc: string;
  timeoutLabel: string;
  allMsgLabel: string;
  roomPartTitle: string;
  roomPartDesc: string;
  roomNickTitle: string;
  roomNickDesc: string;
  roomRegLlmTitle: string;
  roomRegLlmDesc: string;
  llmKeyReqLabel: string;
  roomModTitle: string;
  roomModDesc: string;
  modActionLabel: string;
  adminKeyLabel: string;
  targetNickLabel: string;
  banIdLabel: string;
  historyTitle: string;
  historyDesc: string;
  langTitle: string;
  langDesc: string;
  langFieldLabel: string;
  langFieldHint: string;
  updateTitle: string;
  updateDesc: string;
  updateCheckLabel: string;
  updateCheckHint: string;
  updateForceLabel: string;
  updateForceHint: string;
};

const copyByLang: Record<Lang, Copy> = {
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
    langFieldHint: "en = English (default), ptbr = Português, es = Español",
    updateTitle: "Update 4w",
    updateDesc: "Check for updates and reinstall the latest official release.",
    updateCheckLabel: "Only check (--check)",
    updateCheckHint: "Check if an update is available without modifying files",
    updateForceLabel: "Force reinstall (--force)",
    updateForceHint: "Reinstall even if the version is already up to date",
  },
  ptbr: {
    secPublish: "PUBLICAR",
    secRooms: "SALAS",
    secTools: "FERRAMENTAS",
    roomLabel: "Sala",
    roomHint: "URL da sala ou código de quatro palavras",
    burnLabel: "Leitura única",
    burnHint: "O link expira após a primeira leitura",
    encryptLabel: "Criptografia Zero-Knowledge",
    encryptHint: "Criptografa localmente com AES-256-GCM e anexa #key= ao link",
    streamLabel: "Upload por streaming (até 1 GiB)",
    streamHint: "Envia via PUT /api/upload/file sem limite de 24 MiB do MCP",
    fileLabel: "Caminho do arquivo",
    fileHint: "Cole o caminho sem aspas",
    llmKeyLabel: "Chave LLM (opcional)",
    llmKeyHint: "fwllm_... para autenticar como agente",
    llmNameLabel: "Nome do agente LLM (opcional)",
    llmNameHint: "Ex.: claude, gemini, cursor",
    textTitle: "Publicar texto",
    textDesc: "Crie um link de quatro palavras para texto ou Markdown. Use leitura única quando o link deva expirar ao ser aberto.",
    textField: "Texto ou Markdown",
    fileTitle: "Publicar arquivo",
    fileDesc: "Selecione um arquivo local (até 24 MiB pelo MCP ou até 1 GiB via streaming) e receba o link de compartilhamento.",
    roomCreateTitle: "Criar sala",
    roomCreateDesc: "Abra uma sala colaborativa e, se quiser, inicie o documento compartilhado com Markdown.",
    initialMd: "Markdown inicial",
    initialMsg: "Mensagem inicial",
    optional: "Opcional",
    roomJoinTitle: "Entrar na sala",
    roomJoinDesc: "Registre sua entrada e consulte o apelido e o estado inicial da sala.",
    roomMessagesTitle: "Ler mensagens",
    roomMessagesDesc: "Leia o histórico de mensagens ou informe um cursor para ver apenas as mais recentes.",
    sinceLabel: "A partir da sequência",
    sinceHint: "Opcional. Use o cursor da consulta anterior.",
    mentionsLabel: "Apenas @menções",
    roomSendTitle: "Enviar mensagem",
    roomSendDesc: "Escreva e envie uma mensagem para uma sala existente.",
    msgLabel: "Mensagem",
    roomDocTitle: "Ler Markdown",
    roomDocDesc: "Leia o documento compartilhado e guarde a revisão para uma edição posterior.",
    roomSaveTitle: "Salvar Markdown",
    roomSaveDesc: "Edite o documento e salve sobre a revisão que você leu. Uma revisão concorrente impede a gravação.",
    baseLabel: "Revisão de origem",
    baseHint: "updated_at do documento. Use 0 para um documento sem revisão.",
    mcpListTitle: "Explorador MCP",
    mcpListDesc: "Consulte o catálogo ao vivo, examine esquemas e invoque qualquer ferramenta com argumentos JSON.",
    doctorTitle: "Diagnosticar conexão",
    doctorDesc: "Verifique a conexão, a negociação do protocolo e a descoberta de ferramentas do MCP.",
    getTitle: "Abrir link de 4 palavras",
    getDesc: "Baixe ou exiba o conteúdo de um link de quatro palavras (descriptografando automaticamente links com #key=).",
    getTargetLabel: "Link ou 4 palavras + 9 dígitos",
    getTargetHint: "Ex.: lua-gato-sol-rio-123456789",
    getOutputLabel: "Salvar no arquivo (opcional)",
    getOutputHint: "Caminho local para gravar o conteúdo",
    getKeyLabel: "Chave de descriptografia (opcional)",
    getKeyHint: "Necessária apenas se não estiver em #key= na URL",
    deleteTitle: "Destruir conteúdo",
    deleteDesc: "Apague imediatamente um texto ou arquivo publicado usando sua delete_url secreta (/d/<sha512>).",
    deleteUrlLabel: "URL de destruição",
    roomSendFileTitle: "Enviar arquivo na sala",
    roomSendFileDesc: "Envie um arquivo de até 24 MiB diretamente para os participantes de uma sala ativa.",
    optMsgLabel: "Mensagem opcional",
    optMsgHint: "Texto exibido junto ao anexo",
    roomWaitTitle: "Escutar sala em tempo real",
    roomWaitDesc: "Aguarde novas mensagens, @menções ou edições no documento Markdown via long-polling.",
    timeoutLabel: "Timeout em segundos (1-25)",
    allMsgLabel: "Receber todas as mensagens",
    roomPartTitle: "Listar participantes",
    roomPartDesc: "Consulte os humanos e agentes LLM ativos na sala no momento.",
    roomNickTitle: "Sortear apelido",
    roomNickDesc: "Troque seu apelido aleatório vinculado ao IP ou sessão atual na sala.",
    roomRegLlmTitle: "Registrar agente LLM",
    roomRegLlmDesc: "Autentique-se com a llm_key da sala para exibir o selo dourado de agente LLM.",
    llmKeyReqLabel: "Chave LLM",
    roomModTitle: "Moderar sala",
    roomModDesc: "Verifique a admin_key, liste banimentos ativos, bana ou desbana participantes.",
    modActionLabel: "Ação (list, verify, ban, unban)",
    adminKeyLabel: "Chave de administração",
    targetNickLabel: "Apelido alvo (para ban/unban)",
    banIdLabel: "ID do banimento (para unban)",
    historyTitle: "Cofre local de 24h",
    historyDesc: "Consulte links, delete_url, admin_key e llm_key salvos localmente nas últimas 24 horas.",
    langTitle: "Idioma (en / ptbr / es)",
    langDesc: "Altere e salve o idioma padrão da interface nesta máquina (ou pressione L na tela inicial).",
    langFieldLabel: "Código do idioma (en, ptbr, es)",
    langFieldHint: "en = English (padrão), ptbr = Português, es = Español",
    updateTitle: "Atualizar 4w",
    updateDesc: "Verifica novas versões e atualiza o 4w usando o instalador oficial.",
    updateCheckLabel: "Apenas verificar (--check)",
    updateCheckHint: "Consulta se há versão mais recente sem alterar arquivos",
    updateForceLabel: "Forçar reinstalação (--force)",
    updateForceHint: "Reinstala mesmo se já estiver na versão mais recente",
  },
  es: {
    secPublish: "PUBLICAR",
    secRooms: "SALAS",
    secTools: "HERRAMIENTAS",
    roomLabel: "Sala",
    roomHint: "URL de la sala o código de cuatro palabras",
    burnLabel: "Lectura única",
    burnHint: "El enlace expira tras la primera lectura",
    encryptLabel: "Cifrado Zero-Knowledge",
    encryptHint: "Cifra localmente con AES-256-GCM y añade #key= al enlace",
    streamLabel: "Subida por streaming (hasta 1 GiB)",
    streamHint: "Envía vía PUT /api/upload/file sin el límite de 24 MiB del MCP",
    fileLabel: "Ruta del archivo",
    fileHint: "Pegue la ruta sin comillas",
    llmKeyLabel: "Clave LLM (opcional)",
    llmKeyHint: "fwllm_... para autenticar como agente",
    llmNameLabel: "Nombre del agente LLM (opcional)",
    llmNameHint: "Ej.: claude, gemini, cursor",
    textTitle: "Publicar texto",
    textDesc: "Cree un enlace de cuatro palabras para texto o Markdown. Use lectura única para que expire al abrirse.",
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
    roomMessagesDesc: "Lea el historial de mensajes o indique un cursor para ver solo los más recientes.",
    sinceLabel: "Desde la secuencia",
    sinceHint: "Opcional. Use el cursor de la consulta anterior.",
    mentionsLabel: "Solo @menciones",
    roomSendTitle: "Enviar mensaje",
    roomSendDesc: "Escriba y envíe un mensaje a una sala existente.",
    msgLabel: "Mensaje",
    roomDocTitle: "Leer Markdown",
    roomDocDesc: "Lea el documento compartido y guarde la revisión para una edición posterior.",
    roomSaveTitle: "Guardar Markdown",
    roomSaveDesc: "Edite el documento y guarde sobre la revisión leída. Una revisión concurrente impide sobrescribir.",
    baseLabel: "Revisión de origen",
    baseHint: "updated_at del documento. Use 0 para un documento sin revisión.",
    mcpListTitle: "Explorador MCP",
    mcpListDesc: "Consulte el catálogo en vivo, examine esquemas e invoque cualquier herramienta con JSON.",
    doctorTitle: "Diagnosticar conexión",
    doctorDesc: "Verifique la conexión, la negociación del protocolo y el descubrimiento de herramientas MCP.",
    getTitle: "Abrir enlace de 4 palabras",
    getDesc: "Descargue o muestre el contenido de un enlace de cuatro palabras (descifrando #key= automáticamente).",
    getTargetLabel: "Enlace o 4 palabras + 9 dígitos",
    getTargetHint: "Ej.: lua-gato-sol-rio-123456789",
    getOutputLabel: "Guardar en archivo (opcional)",
    getOutputHint: "Ruta local donde guardar el contenido",
    getKeyLabel: "Clave de descifrado (opcional)",
    getKeyHint: "Solo necesaria si no está en #key= en la URL",
    deleteTitle: "Destruir contenido",
    deleteDesc: "Elimine inmediatamente un texto o archivo publicado usando su delete_url secreta (/d/<sha512>).",
    deleteUrlLabel: "URL de destrucción",
    roomSendFileTitle: "Enviar archivo a la sala",
    roomSendFileDesc: "Envíe un archivo de hasta 24 MiB directamente a los participantes de una sala activa.",
    optMsgLabel: "Mensaje opcional",
    optMsgHint: "Texto mostrado junto al archivo adjunto",
    roomWaitTitle: "Escuchar sala en vivo",
    roomWaitDesc: "Espere nuevos mensajes, @menciones o ediciones en el Markdown mediante long-polling.",
    timeoutLabel: "Timeout en segundos (1-25)",
    allMsgLabel: "Recibir todos los mensajes",
    roomPartTitle: "Listar participantes",
    roomPartDesc: "Consulte los humanos y agentes LLM activos en la sala.",
    roomNickTitle: "Sortear apodo",
    roomNickDesc: "Cambie su apodo aleatorio vinculado a la sesión actual en la sala.",
    roomRegLlmTitle: "Registrar agente LLM",
    roomRegLlmDesc: "Autentíquese con la llm_key de la sala para mostrar la insignia dorada de agente LLM.",
    llmKeyReqLabel: "Clave LLM",
    roomModTitle: "Moderar sala",
    roomModDesc: "Verifique la admin_key, liste bloqueos activos, bloquee o desbloquee participantes.",
    modActionLabel: "Acción (list, verify, ban, unban)",
    adminKeyLabel: "Clave de administración",
    targetNickLabel: "Apodo objetivo (para ban/unban)",
    banIdLabel: "ID de bloqueo (para unban)",
    historyTitle: "Bóveda local de 24h",
    historyDesc: "Consulte enlaces, delete_url, admin_key y llm_key guardados localmente en las últimas 24 horas.",
    langTitle: "Idioma (en / ptbr / es)",
    langDesc: "Cambie y guarde el idioma predeterminado en esta máquina (o presione L en el menú principal).",
    langFieldLabel: "Código de idioma (en, ptbr, es)",
    langFieldHint: "en = English (por defecto), ptbr = Português, es = Español",
    updateTitle: "Actualizar 4w",
    updateDesc: "Verifica nuevas versiones y actualiza 4w usando el instalador oficial.",
    updateCheckLabel: "Solo verificar (--check)",
    updateCheckHint: "Consulta si hay una versión más reciente sin modificar archivos",
    updateForceLabel: "Forzar reinstalación (--force)",
    updateForceHint: "Reinstala incluso si ya está en la versión más reciente",
  },
};

export function actionsFor(lang = resolveLang()): Action[] {
  const c = copyByLang[lang];
  const room: Field = { id: "room", label: c.roomLabel, hint: c.roomHint, required: true };
  const burn: Field = { id: "burn", label: c.burnLabel, mode: "toggle", initial: "on", hint: c.burnHint };
  const encrypt: Field = { id: "encrypt", label: c.encryptLabel, mode: "toggle", hint: c.encryptHint };
  const stream: Field = { id: "stream", label: c.streamLabel, mode: "toggle", hint: c.streamHint };
  const markdown: Field = { id: "markdown", label: "Markdown", mode: "multiline" };
  const file: Field = { id: "file", label: c.fileLabel, hint: c.fileHint, required: true };
  const llmKey: Field = { id: "llm_key", label: c.llmKeyLabel, hint: c.llmKeyHint };
  const llmName: Field = { id: "llm_name", label: c.llmNameLabel, hint: c.llmNameHint };

  return [
    {
      id: "text", section: c.secPublish, title: c.textTitle,
      description: c.textDesc,
      fields: [{ id: "text", label: c.textField, mode: "multiline", required: true }, burn, encrypt], write: true,
      job: (v) => ({ args: ["text", ...burnFlag(v), ...encryptFlag(v), "-"], input: v.text }),
    },
    {
      id: "file", section: c.secPublish, title: c.fileTitle,
      description: c.fileDesc,
      fields: [file, burn, stream, encrypt], write: true,
      job: (v) => ({ args: ["file", ...burnFlag(v), ...streamFlag(v), ...encryptFlag(v), "--", v.file] }),
    },
    {
      id: "room create", section: c.secRooms, title: c.roomCreateTitle,
      description: c.roomCreateDesc,
      fields: [
        { ...markdown, label: c.initialMd, hint: c.optional },
        { id: "message", label: c.initialMsg, hint: c.optional },
        llmName,
      ],
      write: true,
      job: (v) => ({
        args: [
          "room", "create",
          ...(v.markdown ? ["--doc", "-"] : []),
          ...(v.message?.trim() ? ["--message", v.message.trim()] : []),
          ...(v.llm_name?.trim() ? ["--llm-name", v.llm_name.trim()] : []),
        ],
        input: v.markdown || undefined,
      }),
    },
    {
      id: "room join", section: c.secRooms, title: c.roomJoinTitle,
      description: c.roomJoinDesc,
      fields: [room, llmKey, llmName], write: true,
      job: (v) => ({ args: ["room", "join", v.room, ...llmFlags(v)] }),
    },
    {
      id: "room messages", section: c.secRooms, title: c.roomMessagesTitle,
      description: c.roomMessagesDesc,
      fields: [
        room,
        { id: "since", label: c.sinceLabel, hint: c.sinceHint },
        { id: "mentions", label: c.mentionsLabel, mode: "toggle" },
        llmKey,
        llmName,
      ],
      job: (v) => ({
        args: [
          "room", "messages", v.room,
          ...(v.since ? ["--since", v.since] : []),
          ...(v.mentions === "on" ? ["--mentions-only"] : []),
          ...llmFlags(v),
        ],
      }),
    },
    {
      id: "room send", section: c.secRooms, title: c.roomSendTitle,
      description: c.roomSendDesc,
      fields: [room, { id: "text", label: c.msgLabel, mode: "multiline", required: true }, llmKey, llmName], write: true,
      job: (v) => ({ args: ["room", "send", v.room, v.text, ...llmFlags(v)] }),
    },
    {
      id: "room doc", section: c.secRooms, title: c.roomDocTitle,
      description: c.roomDocDesc,
      fields: [room, llmKey, llmName],
      job: (v) => ({ args: ["room", "doc", v.room, ...llmFlags(v)] }),
    },
    {
      id: "room save", section: c.secRooms, title: c.roomSaveTitle,
      description: c.roomSaveDesc,
      fields: [
        room,
        { id: "base", label: c.baseLabel, hint: c.baseHint, required: true },
        markdown,
        llmKey,
        llmName,
      ],
      write: true,
      job: (v) => ({ args: ["room", "save", v.room, "-", "--base", v.base, ...llmFlags(v)], input: v.markdown }),
    },
    {
      id: "mcp list", section: c.secTools, title: c.mcpListTitle,
      description: c.mcpListDesc,
      job: () => ({ args: ["mcp", "list"] }),
    },
    {
      id: "doctor", section: c.secTools, title: c.doctorTitle,
      description: c.doctorDesc,
      job: () => ({ args: ["doctor"] }),
    },
    {
      id: "get", section: c.secPublish, title: c.getTitle,
      description: c.getDesc,
      fields: [
        { id: "target", label: c.getTargetLabel, hint: c.getTargetHint, required: true },
        { id: "output", label: c.getOutputLabel, hint: c.getOutputHint },
        { id: "key", label: c.getKeyLabel, hint: c.getKeyHint },
      ],
      job: (v) => ({
        args: [
          "get", v.target,
          ...(v.output?.trim() ? ["--output", v.output.trim()] : []),
          ...(v.key?.trim() ? ["--key", v.key.trim()] : []),
        ],
      }),
    },
    {
      id: "delete", section: c.secPublish, title: c.deleteTitle,
      description: c.deleteDesc,
      fields: [{ id: "delete_url", label: c.deleteUrlLabel, hint: "https://4words.aletheia.land/d/...", required: true }],
      write: true,
      job: (v) => ({ args: ["delete", v.delete_url.trim()] }),
    },
    {
      id: "room send-file", section: c.secRooms, title: c.roomSendFileTitle,
      description: c.roomSendFileDesc,
      fields: [
        room,
        file,
        { id: "text", label: c.optMsgLabel, hint: c.optMsgHint },
        burn,
        llmKey,
        llmName,
      ],
      write: true,
      job: (v) => ({
        args: [
          "room", "send-file", v.room, v.file,
          ...(v.text?.trim() ? ["--text", v.text.trim()] : []),
          ...burnFlag(v),
          ...llmFlags(v),
        ],
      }),
    },
    {
      id: "room wait", section: c.secRooms, title: c.roomWaitTitle,
      description: c.roomWaitDesc,
      fields: [
        room,
        { id: "since", label: c.sinceLabel, hint: "Optional (last_seq)" },
        { id: "timeout", label: c.timeoutLabel, initial: "20" },
        { id: "all", label: c.allMsgLabel, mode: "toggle", initial: "on" },
        llmKey,
        llmName,
      ],
      job: (v) => ({
        args: [
          "room", "wait", v.room,
          ...(v.since?.trim() ? ["--since", v.since.trim()] : []),
          ...(v.timeout?.trim() ? ["--timeout", v.timeout.trim()] : []),
          ...(v.all === "on" ? ["--all"] : []),
          ...llmFlags(v),
        ],
      }),
    },
    {
      id: "room participants", section: c.secRooms, title: c.roomPartTitle,
      description: c.roomPartDesc,
      fields: [room, llmKey, llmName],
      job: (v) => ({ args: ["room", "participants", v.room, ...llmFlags(v)] }),
    },
    {
      id: "room nick", section: c.secRooms, title: c.roomNickTitle,
      description: c.roomNickDesc,
      fields: [room, llmKey, llmName], write: true,
      job: (v) => ({ args: ["room", "nick", v.room, ...llmFlags(v)] }),
    },
    {
      id: "room register-llm", section: c.secRooms, title: c.roomRegLlmTitle,
      description: c.roomRegLlmDesc,
      fields: [
        room,
        { ...llmKey, label: c.llmKeyReqLabel, required: true },
        llmName,
      ],
      write: true,
      job: (v) => ({ args: ["room", "register-llm", v.room, ...llmFlags(v)] }),
    },
    {
      id: "room moderate", section: c.secRooms, title: c.roomModTitle,
      description: c.roomModDesc,
      fields: [
        room,
        { id: "mod_action", label: c.modActionLabel, initial: "list", required: true },
        { id: "admin_key", label: c.adminKeyLabel, hint: "fwadm_...", required: true },
        { id: "nick", label: c.targetNickLabel, hint: c.optional },
        { id: "ban_id", label: c.banIdLabel, hint: c.optional },
      ],
      write: true,
      job: (v) => ({
        args: [
          "room", "moderate", v.room, v.mod_action.trim(),
          "--admin-key", v.admin_key.trim(),
          ...(v.nick?.trim() ? ["--nick", v.nick.trim()] : []),
          ...(v.ban_id?.trim() ? ["--ban-id", v.ban_id.trim()] : []),
        ],
      }),
    },
    {
      id: "history", section: c.secTools, title: c.historyTitle,
      description: c.historyDesc,
      job: () => ({ args: ["history"] }),
    },
    {
      id: "lang", section: c.secTools, title: c.langTitle,
      description: c.langDesc,
      fields: [{ id: "lang", label: c.langFieldLabel, hint: c.langFieldHint, initial: lang, required: true }],
      job: (v) => ({ args: ["lang", v.lang.trim()] }),
    },
    {
      id: "update", section: c.secTools, title: c.updateTitle,
      description: c.updateDesc,
      fields: [
        { id: "check", label: c.updateCheckLabel, mode: "toggle", initial: "on", hint: c.updateCheckHint },
        { id: "force", label: c.updateForceLabel, mode: "toggle", hint: c.updateForceHint },
      ],
      write: true,
      job: (v) => ({
        args: [
          "update",
          ...(v.check === "on" ? ["--check"] : []),
          ...(v.force === "on" ? ["--force"] : []),
        ],
      }),
    },
  ];
}

export const actions: Action[] = actionsFor();

export function keyGuideFor(lang = resolveLang()): string {
  if (lang === "en") {
    return [
      "NAVIGATION",
      "↑ / ↓  or  j / k     Select item or scroll",
      "Enter               Open item",
      "L                   Switch & save language (en / ptbr / es)",
      "Tab / Shift+Tab     Switch field in forms",
      "Esc                 Back or cancel",
      "Ctrl+C              Quit",
      "",
      "FORMS",
      "↑ / ↓ / ← / →       Move cursor in text",
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
      "Y                   Copy public link if terminal supports OSC 52",
    ].join("\n");
  }
  if (lang === "es") {
    return [
      "NAVEGACIÓN",
      "↑ / ↓  o  j / k      Seleccionar elemento o desplazar",
      "Enter               Abrir elemento",
      "L                   Cambiar y guardar idioma (en / ptbr / es)",
      "Tab / Shift+Tab     Cambiar campo en formularios",
      "Esc                 Volver o cancelar",
      "Ctrl+C              Salir",
      "",
      "FORMULARIOS",
      "↑ / ↓ / ← / →       Mover el cursor en el texto",
      "Home / End          Inicio / fin de línea",
      "Espacio             Alternar lectura única / opción",
      "F2 / Ctrl+S         Avanzar para enviar",
      "Tab hasta Continuar Alternativa a F2 en Termux",
      "F1                  Ayuda del comando o esquema MCP",
      "",
      "RESULTADOS",
      "Page Up / Down      Desplazar páginas",
      "V                   Mostrar u ocultar credenciales de la respuesta",
      "E                   Editar el Markdown de la revisión mostrada",
      "D                   Destruir el contenido recién publicado",
      "Y                   Copiar enlace público si la terminal acepta OSC 52",
    ].join("\n");
  }
  return [
    "NAVEGAÇÃO",
    "↑ / ↓  ou  j / k     Selecionar item ou rolar",
    "Enter               Abrir item",
    "L                   Trocar e salvar idioma (en / ptbr / es)",
    "Tab / Shift+Tab     Trocar campo em formulários",
    "Esc                 Voltar ou cancelar",
    "Ctrl+C              Sair",
    "",
    "FORMULÁRIOS",
    "↑ / ↓ / ← / →       Mover o cursor no texto",
    "Home / End          Início / fim da linha",
    "Espaço              Alternar leitura única / opção",
    "F2 / Ctrl+S         Avançar para envio",
    "Tab até Continuar   Alternativa ao F2 no Termux",
    "F1                  Ajuda do comando ou esquema MCP",
    "",
    "RESULTADOS",
    "Page Up / Down      Rolar páginas",
    "V                   Mostrar ou ocultar credenciais da resposta",
    "E                   Editar o Markdown da revisão exibida",
    "D                   Destruir o conteúdo recém-publicado",
    "Y                   Copiar link público se o terminal aceitar OSC 52",
  ].join("\n");
}

export const keyGuide = keyGuideFor();

export function textSafe(text: string): string {
  // Keep remote text from injecting VT commands or direction overrides.
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "\ufffd");
}

function secretKey(key: string): boolean {
  return /(?:^|[_-])(?:key|token|secret|password|authorization|delete_url)(?:$|[_-])/i.test(key) ||
    /^(?:apiKey|deleteUrl|accessToken|llmKey|adminKey)$/i.test(key);
}

export function maskSecrets(value: string, lang = resolveLang()): string {
  const token = lang === "en" ? "[hidden]" : "[oculto]";
  return value.replace(/\bfw(?:adm|llm)_[0-9a-f]+\b|https:\/\/[^\s"<>]+\/d\/[0-9a-f]{32,}\b/gi, token);
}

export function resultJson(value: unknown, reveal: boolean, lang = resolveLang()): string {
  const token = lang === "en" ? "[hidden]" : "[oculto]";
  return JSON.stringify(value, (key, field: unknown) => {
    if (reveal) return field;
    if (secretKey(key)) return token;
    return typeof field === "string" ? maskSecrets(field, lang) : field;
  }, 2) ?? "null";
}

export function object(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

export function publicLink(value: unknown, roomAction = false): string | undefined {
  const item = object(value);
  for (const key of ["fourwords_url", "url"]) {
    const raw = item?.[key];
    if (typeof raw !== "string" || /[\x00-\x20\x7f]/.test(raw)) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.search) continue;
      if (url.hash && !/^#key=[A-Za-z0-9_-]+$/.test(url.hash)) continue;
      if (/^\/(?:[\p{L}\p{N}]+-){4}\d{9}$/u.test(decodeURIComponent(url.pathname)) ||
          (roomAction && /^\/chat\/[a-f\d]{128}$/i.test(url.pathname))) return url.href;
    } catch { /* Ignore malformed remote links. */ }
  }
}

export function deleteLink(value: unknown): string | undefined {
  const item = object(value);
  const raw = item?.delete_url ?? item?.deleteUrl;
  if (typeof raw !== "string" || /[\x00-\x20\x7f]/.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    if ((url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
        /^\/d\/[a-f\d]{32,}$/i.test(url.pathname)) {
      return url.href;
    }
  } catch { /* Ignore malformed delete URLs. */ }
}
