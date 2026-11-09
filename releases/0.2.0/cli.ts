// @bun
// src/commands.ts
import { open } from "fs/promises";
import { basename } from "path";
import { parseArgs } from "util";

// src/help.ts
var VERSION = "0.2.0";
var SITE = "https://4words.aletheia.land";
var REPO = "https://github.com/tallesdantas/4w-cli";
var topics = {
  tui: {
    label: "Painel interativo",
    usage: "4w  |  4w tui",
    details: "Abra o painel do FourWords em um terminal interativo. Com sa\xEDda redirecionada ou TERM=dumb, 4w sem argumentos imprime esta ajuda.",
    examples: ["4w", "4w tui"]
  },
  doctor: {
    label: "Diagnosticar conex\xE3o",
    usage: "4w doctor",
    details: "Conecta ao MCP, negocia a sess\xE3o e conta as ferramentas. Exibe JSON com ok, version e tools. A opera\xE7\xE3o n\xE3o publica conte\xFAdo.",
    examples: ["4w doctor"]
  },
  text: {
    label: "Publicar texto",
    usage: "4w text TEXTO | 4w text --file ARQUIVO | 4w text - [--burn]",
    details: "Publica at\xE9 100.000 bytes de texto UTF-8, inclusive Markdown. Use aspas em TEXTO, --file para um arquivo ou - para stdin. --burn ativa leitura \xFAnica em qualquer uma das tr\xEAs formas.",
    examples: ['4w text "Ol\xE1, FourWords!"', "4w text --file notas.md --burn", 'printf "%s\\n" "Texto do pipe" | 4w text -', '4w text -- "--texto iniciado por h\xEDfen"']
  },
  file: {
    label: "Publicar arquivo",
    usage: "4w file ARQUIVO [--burn]",
    details: "Envia um arquivo regular de at\xE9 24 MiB pelo MCP. O servi\xE7o valida formatos. --burn ativa leitura \xFAnica. Informe o caminho entre aspas quando houver espa\xE7os.",
    examples: ['4w file "relat\xF3rio final.pdf" --burn']
  },
  room: {
    label: "Trabalhar em salas",
    usage: "4w room <create|join|send|messages|doc|save> [ARGUMENTOS]",
    details: "SALA aceita uma URL de sala ou seu c\xF3digo de quatro palavras e nove d\xEDgitos. Consulte os t\xF3picos abaixo para argumentos e exemplos.",
    examples: ["4w room create", "4w help room save"]
  },
  "room create": {
    label: "Criar sala",
    usage: "4w room create [--doc ARQUIVO]",
    details: "Cria uma sala e devolve links e credenciais quando emitidas pelo servidor. --doc carrega Markdown inicial UTF-8 de at\xE9 50.000 unidades UTF-16. Use --doc - para stdin.",
    examples: ["4w room create --doc pauta.md"]
  },
  "room join": {
    label: "Entrar na sala",
    usage: "4w room join SALA",
    details: "Registra sua entrada e retorna o apelido e o estado inicial da sala. O servidor usa a identidade da sess\xE3o nas opera\xE7\xF5es subsequentes.",
    examples: ['4w room join "$SALA"']
  },
  "room send": {
    label: "Enviar mensagem",
    usage: "4w room send SALA TEXTO",
    details: "Envia uma mensagem \xE0 sala. Informe a mensagem em um \xFAnico argumento entre aspas.",
    examples: ['4w room send "$SALA" "Come\xE7amos em cinco minutos."']
  },
  "room messages": {
    label: "Ler mensagens",
    usage: "4w room messages SALA [--since N]",
    details: "L\xEA as mensagens dispon\xEDveis. --since aceita uma sequ\xEAncia n\xE3o negativa e consulta apenas mensagens posteriores a ela. Use o \xFAltimo cursor recebido para fazer a pr\xF3xima consulta.",
    examples: ['4w room messages "$SALA" --since 42']
  },
  "room doc": {
    label: "Ler Markdown",
    usage: "4w room doc SALA",
    details: "Exibe o Markdown compartilhado e sua revis\xE3o updated_at. Guarde essa revis\xE3o para salvar uma edi\xE7\xE3o com controle de concorr\xEAncia.",
    examples: ['4w room doc "$SALA"']
  },
  "room save": {
    label: "Salvar Markdown",
    usage: "4w room save SALA ARQUIVO --base N",
    details: "Salva Markdown UTF-8 de at\xE9 50.000 unidades UTF-16. Passe em --base o updated_at da vers\xE3o que voc\xEA editou, ou 0 para uma sala sem revis\xE3o. Use - no lugar do arquivo para ler stdin. Se houver conflito, releia o documento e incorpore as mudan\xE7as.",
    examples: ['4w room doc "$SALA"', '4w room save "$SALA" revisado.md --base 1780000000000']
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
function help(topic) {
  if (topic) {
    if (!Object.hasOwn(topics, topic))
      throw new Error(`T\xF3pico desconhecido: ${topic}. Consulte 4w --help.`);
    const entry = topics[topic];
    const children = Object.entries(topics).filter(([key]) => key.startsWith(topic + " "));
    return [
      `4w ${VERSION} \xB7 ${entry.label}`,
      "",
      "USO",
      "  " + entry.usage,
      "",
      entry.details,
      "",
      "EXEMPLOS",
      ...entry.examples.map((line) => "  " + line),
      ...children.length ? ["", "SUBCOMANDOS", ...children.map(([key, child]) => `  ${key.padEnd(16)} ${child.label}`)] : [],
      "",
      "Ajuda geral  4w --help"
    ].join(`
`);
  }
  return `4w ${VERSION} \xB7 FourWords no terminal

Compartilhe texto e arquivos com links de quatro palavras, colabore em salas
e use o MCP em automa\xE7\xF5es. Execute 4w sem argumentos para abrir o painel.

USO
  4w                            Abre o painel interativo
  4w COMANDO [ARGUMENTOS]       Executa um comando e escreve o resultado em JSON
  4w help [COMANDO ...]         Abre a ajuda de um comando
  4w --version                  Mostra a vers\xE3o instalada

COMPARTILHAMENTO
  4w text TEXTO | --file ARQUIVO | -   Publica texto ou Markdown [--burn]
  4w file ARQUIVO                      Publica arquivo de at\xE9 24 MiB [--burn]

SALAS
  4w room create [--doc ARQUIVO]       Cria uma sala com Markdown opcional
  4w room join SALA                   Entra na sala
  4w room send SALA TEXTO             Envia uma mensagem
  4w room messages SALA [--since N]    L\xEA mensagens e acompanha o cursor
  4w room doc SALA                    L\xEA Markdown e a revis\xE3o atual
  4w room save SALA ARQUIVO --base N   Salva Markdown com controle de revis\xE3o

MCP E DIAGN\xD3STICO
  4w mcp list                         Lista ferramentas e esquemas de entrada
  4w mcp call FERRAMENTA [JSON|-]     Invoca uma ferramenta do MCP
  4w doctor                           Testa a conex\xE3o com o FourWords

EXEMPLOS
  4w text "Ol\xE1, FourWords!"
  4w file "meu relat\xF3rio.pdf" --burn
  4w help room save
  4w mcp call --help

SALA aceita o link de uma sala ou o c\xF3digo de quatro palavras e nove d\xEDgitos.
--burn ativa a leitura \xFAnica. O servidor aplica as regras de expira\xE7\xE3o.
Resultados e chaves saem em JSON no stdout. Erros v\xE3o para stderr com c\xF3digo 1.
FOURWORDS_MCP_URL altera o endpoint MCP. O padr\xE3o \xE9 ${SITE}/mcp.
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
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Esperava um objeto JSON.");
  return value;
}

class FourWords {
  signal;
  id = 0;
  session;
  protocol = "2025-03-26";
  endpoint;
  constructor(signal) {
    this.signal = signal;
    this.endpoint = new URL(process.env.FOURWORDS_MCP_URL || `${SITE}/mcp`);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(this.endpoint.hostname);
    if (!(this.endpoint.protocol === "https:" || loopback && this.endpoint.protocol === "http:") || this.endpoint.username || this.endpoint.password) {
      throw new Error("FOURWORDS_MCP_URL deve usar HTTPS ou HTTP em loopback, sem credenciais na URL.");
    }
  }
  async rpc(method, params, notification = false) {
    const id = notification ? undefined : ++this.id;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    };
    if (method !== "initialize")
      headers["MCP-Protocol-Version"] = this.protocol;
    if (this.session)
      headers["Mcp-Session-Id"] = this.session;
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
      throw new Error(`MCP retornou HTTP ${response.status} em ${method}.`);
    }
    if (method === "initialize")
      this.session = response.headers.get("Mcp-Session-Id") || undefined;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    const message = response.headers.get("Content-Type")?.includes("text/event-stream") ? await readEvent(response, id) : await response.json();
    if (message?.jsonrpc !== "2.0" || message.id !== id)
      throw new Error("Resposta JSON-RPC incompat\xEDvel.");
    if (message.error)
      throw new Error(message.error.message || "Erro JSON-RPC.");
    if (!("result" in message))
      throw new Error("Resposta MCP sem resultado.");
    return message.result;
  }
  async initialize() {
    const server = record(await this.rpc("initialize", {
      protocolVersion: this.protocol,
      capabilities: {},
      clientInfo: { name: "4w", version: VERSION }
    }));
    if (typeof server.protocolVersion !== "string")
      throw new Error("MCP n\xE3o informou a vers\xE3o do protocolo.");
    this.protocol = server.protocolVersion;
    await this.rpc("notifications/initialized", undefined, true);
    return server;
  }
  async list() {
    const tools = [];
    const cursors = new Set;
    let cursor;
    do {
      const page = record(await this.rpc("tools/list", cursor ? { cursor } : undefined));
      if (!Array.isArray(page.tools))
        throw new Error("O MCP retornou uma lista de ferramentas inv\xE1lida.");
      tools.push(...page.tools);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (cursor && cursors.has(cursor))
        throw new Error("Cursor MCP repetido.");
      if (cursor)
        cursors.add(cursor);
    } while (cursor);
    return tools;
  }
  async call(name, args) {
    const result = record(await this.rpc("tools/call", { name, arguments: args }));
    const content = Array.isArray(result.content) ? result.content : [];
    if (result.isError) {
      const message = content.find((item) => item?.type === "text")?.text;
      throw new Error(typeof message === "string" ? message : `O MCP recusou ${name}.`);
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
      throw new Error("O documento mudou durante a edi\xE7\xE3o. Rode 4w room doc, incorpore as mudan\xE7as e tente novamente.");
    }
    if (output && typeof output === "object" && "ok" in output && output.ok === false) {
      const detail = "error" in output && typeof output.error === "string" ? output.error : "opera\xE7\xE3o recusada";
      throw new Error(`${name}: ${detail}`);
    }
    return output;
  }
}
async function readEvent(response, id) {
  if (!response.body)
    throw new Error("Fluxo MCP vazio.");
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
      if (done)
        throw new Error("Fluxo MCP terminou sem a resposta esperada.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function fileBytes(path, limit) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile())
      throw new Error("Informe um arquivo regular.");
    if (stat.size > limit)
      throw new Error(`Arquivo excede o limite de ${limit} bytes.`);
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead)
        break;
      offset += bytesRead;
    }
    if (offset !== stat.size)
      throw new Error("O tamanho do arquivo mudou durante a leitura. Tente novamente.");
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}
async function readText(path, limit = 1e5, input) {
  if (path === "-" && input !== undefined) {
    if (Buffer.byteLength(input) > limit)
      throw new Error(`A entrada excede ${limit} bytes.`);
    return input;
  }
  if (path !== "-")
    return new TextDecoder("utf-8", { fatal: true }).decode(await fileBytes(path, limit));
  const parts = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit)
      throw new Error(`A entrada excede ${limit} bytes.`);
    parts.push(bytes);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts));
}
function exact(values, count, usage) {
  if (values.length !== count)
    throw new Error(`Uso: 4w ${usage}`);
}
async function execute(args, signal, input) {
  const [command, ...rest] = args;
  let invoke;
  if (command === "doctor") {
    exact(rest, 0, "doctor");
    invoke = async (mcp) => ({ ok: true, version: VERSION, tools: (await mcp.list()).length });
  } else if (command === "text" || command === "file") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { burn: { type: "boolean" }, ...command === "text" ? { file: { type: "string" } } : {} }
    });
    const burn = values.burn ?? false;
    if (command === "file") {
      exact(positionals, 1, "file ARQUIVO [--burn]");
      const path = positionals[0];
      const content_base64 = (await fileBytes(path, MAX_FILE)).toString("base64");
      invoke = (mcp) => mcp.call("upload_file", { filename: basename(path), content_base64, burn });
    } else {
      const path = typeof values.file === "string" ? values.file : undefined;
      exact(positionals, path === undefined ? 1 : 0, "text TEXTO|-|--file ARQUIVO [--burn]");
      const content = path !== undefined ? await readText(path, 1e5, input) : positionals[0] === "-" ? await readText("-", 1e5, input) : positionals[0];
      if (!content.trim() || Buffer.byteLength(content) > 1e5)
        throw new Error("Informe texto UTF-8 de 1 a 100.000 bytes.");
      invoke = (mcp) => mcp.call("upload_text", { content, burn });
    }
  } else if (command === "room") {
    const [action, ...roomArgs] = rest;
    if (action === "create") {
      const { values, positionals } = parseArgs({ args: roomArgs, allowPositionals: true, options: { doc: { type: "string" } } });
      exact(positionals, 0, "room create [--doc ARQUIVO]");
      const initial_markdown = values.doc === undefined ? undefined : await readText(values.doc, 200000, input);
      if (initial_markdown && initial_markdown.length > 50000)
        throw new Error("Markdown excede 50.000 unidades UTF-16.");
      invoke = (mcp) => mcp.call("chat_create", { initial_markdown });
    } else if (action === "messages") {
      const { values, positionals } = parseArgs({ args: roomArgs, allowPositionals: true, options: { since: { type: "string" } } });
      exact(positionals, 1, "room messages SALA [--since N]");
      const since = values.since === undefined ? undefined : Number(values.since);
      if (since !== undefined && (!/^\d+$/.test(values.since) || !Number.isSafeInteger(since)))
        throw new Error("--since requer um inteiro n\xE3o negativo.");
      invoke = (mcp) => mcp.call("chat_messages", { url: positionals[0], since });
    } else {
      const [url, value] = roomArgs;
      if (action === "join" || action === "doc") {
        exact(roomArgs, 1, `room ${action} SALA`);
        invoke = (mcp) => mcp.call(action === "join" ? "chat_join" : "chat_get_doc", { url });
      } else if (action === "send") {
        exact(roomArgs, 2, "room send SALA TEXTO");
        invoke = (mcp) => mcp.call("chat_send", { url, text: value });
      } else if (action === "save") {
        const { values, positionals } = parseArgs({
          args: roomArgs,
          allowPositionals: true,
          options: { base: { type: "string" } }
        });
        exact(positionals, 2, "room save SALA ARQUIVO --base N");
        const base_updated_at = Number(values.base);
        if (values.base === undefined || !/^\d+$/.test(values.base) || !Number.isSafeInteger(base_updated_at)) {
          throw new Error("Informe --base com o updated_at de 4w room doc. Use 0 para uma sala sem revis\xE3o.");
        }
        const content = await readText(positionals[1], 200000, input);
        if (content.length > 50000)
          throw new Error("Markdown excede 50.000 unidades UTF-16.");
        invoke = (mcp) => mcp.call("chat_save_doc", { url: positionals[0], content, base_updated_at });
      } else
        throw new Error("A\xE7\xE3o de sala desconhecida. Consulte 4w --help.");
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
      throw new Error("Uso: 4w mcp list | 4w mcp call FERRAMENTA [JSON|-]");
  } else
    throw new Error(`Comando desconhecido: ${command}. Consulte 4w --help.`);
  const mcp = new FourWords(signal);
  await mcp.initialize();
  return invoke(mcp);
}

// src/tui.ts
import { emitKeypressEvents } from "readline";

// src/tui-model.ts
var room = { id: "room", label: "Sala", hint: "URL da sala ou c\xF3digo de quatro palavras", required: true };
var burn = { id: "burn", label: "Leitura \xFAnica", mode: "toggle", hint: "O link expira ap\xF3s a primeira leitura" };
var markdown = { id: "markdown", label: "Markdown", mode: "multiline" };
var file = { id: "file", label: "Caminho do arquivo", hint: "Cole o caminho sem aspas", required: true };
var burnFlag = (values) => values.burn === "on" ? ["--burn"] : [];
var actions = [
  {
    id: "text",
    section: "PUBLICAR",
    title: "Publicar texto",
    description: "Crie um link de quatro palavras para texto ou Markdown. Use leitura \xFAnica quando o link deva expirar ao ser aberto.",
    fields: [{ id: "text", label: "Texto ou Markdown", mode: "multiline", required: true }, burn],
    write: true,
    job: (v) => ({ args: ["text", ...burnFlag(v), "-"], input: v.text })
  },
  {
    id: "file",
    section: "PUBLICAR",
    title: "Publicar arquivo",
    description: "Selecione um arquivo local de at\xE9 24 MiB e receba o link de compartilhamento.",
    fields: [file, burn],
    write: true,
    job: (v) => ({ args: ["file", ...burnFlag(v), "--", v.file] })
  },
  {
    id: "room create",
    section: "SALAS",
    title: "Criar sala",
    description: "Abra uma sala colaborativa e, se quiser, inicie o documento compartilhado com Markdown.",
    fields: [{ ...markdown, label: "Markdown inicial", hint: "Opcional" }],
    write: true,
    job: (v) => ({ args: v.markdown ? ["room", "create", "--doc", "-"] : ["room", "create"], input: v.markdown })
  },
  {
    id: "room join",
    section: "SALAS",
    title: "Entrar na sala",
    description: "Registre sua entrada e consulte o apelido e o estado inicial da sala.",
    fields: [room],
    write: true,
    job: (v) => ({ args: ["room", "join", v.room] })
  },
  {
    id: "room messages",
    section: "SALAS",
    title: "Ler mensagens",
    description: "Leia o hist\xF3rico de mensagens ou informe um cursor para ver apenas as mais recentes.",
    fields: [room, { id: "since", label: "A partir da sequ\xEAncia", hint: "Opcional. Use o cursor da consulta anterior." }],
    job: (v) => ({ args: ["room", "messages", v.room, ...v.since ? ["--since", v.since] : []] })
  },
  {
    id: "room send",
    section: "SALAS",
    title: "Enviar mensagem",
    description: "Escreva e envie uma mensagem para uma sala existente.",
    fields: [room, { id: "text", label: "Mensagem", mode: "multiline", required: true }],
    write: true,
    job: (v) => ({ args: ["room", "send", v.room, v.text] })
  },
  {
    id: "room doc",
    section: "SALAS",
    title: "Ler Markdown",
    description: "Leia o documento compartilhado e guarde a revis\xE3o para uma edi\xE7\xE3o posterior.",
    fields: [room],
    job: (v) => ({ args: ["room", "doc", v.room] })
  },
  {
    id: "room save",
    section: "SALAS",
    title: "Salvar Markdown",
    description: "Edite o documento e salve sobre a revis\xE3o que voc\xEA leu. Uma revis\xE3o concorrente impede a grava\xE7\xE3o.",
    fields: [room, { id: "base", label: "Revis\xE3o de origem", hint: "updated_at do documento. Use 0 para um documento sem revis\xE3o.", required: true }, markdown],
    write: true,
    job: (v) => ({ args: ["room", "save", v.room, "-", "--base", v.base], input: v.markdown })
  },
  {
    id: "mcp list",
    section: "FERRAMENTAS",
    title: "Explorador MCP",
    description: "Consulte o cat\xE1logo ao vivo, examine esquemas e invoque qualquer ferramenta com argumentos JSON.",
    job: () => ({ args: ["mcp", "list"] })
  },
  {
    id: "doctor",
    section: "FERRAMENTAS",
    title: "Diagnosticar conex\xE3o",
    description: "Verifique a conex\xE3o, a negocia\xE7\xE3o do protocolo e a descoberta de ferramentas do MCP.",
    job: () => ({ args: ["doctor"] })
  }
];
var keyGuide = [
  "NAVEGA\xC7\xC3O",
  "\u2191 / \u2193  ou  j / k     Selecionar item ou rolar",
  "Enter               Abrir item",
  "Tab / Shift+Tab     Trocar campo em formul\xE1rios",
  "Esc                 Voltar ou cancelar",
  "Ctrl+C              Sair",
  "",
  "FORMUL\xC1RIOS",
  "\u2191 / \u2193 / \u2190 / \u2192       Mover o cursor no texto",
  "Home / End          In\xEDcio / fim da linha",
  "Espa\xE7o              Alternar leitura \xFAnica",
  "F2 / Ctrl+S         Avan\xE7ar para envio",
  "Tab at\xE9 Continuar   Alternativa ao F2 no Termux",
  "F1                  Ajuda do comando ou esquema MCP",
  "",
  "RESULTADOS",
  "Page Up / Down      Rolar p\xE1ginas",
  "V                   Mostrar ou ocultar credenciais da resposta",
  "E                   Editar o Markdown da revis\xE3o exibida",
  "Y                   Copiar link p\xFAblico se o terminal aceitar OSC 52"
].join(`
`);
function textSafe(text) {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "\uFFFD");
}
function secretKey(key) {
  return /(?:^|[_-])(?:key|token|secret|password|authorization|delete_url)(?:$|[_-])/i.test(key) || /^(?:apiKey|deleteUrl|accessToken|llmKey|adminKey)$/i.test(key);
}
function maskSecrets(value) {
  return value.replace(/\bfw(?:adm|llm)_[0-9a-f]+\b|https:\/\/[^\s"<>]+\/d\/[0-9a-f]{32,}\b/gi, "[oculto]");
}
function resultJson(value, reveal) {
  return JSON.stringify(value, (key, field) => {
    if (reveal)
      return field;
    if (secretKey(key))
      return "[oculto]";
    return typeof field === "string" ? maskSecrets(field) : field;
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
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        continue;
      if (/^\/(?:[\p{L}\p{N}]+-){4}\d{9}$/u.test(decodeURIComponent(url.pathname)) || roomAction && /^\/chat\/[a-f\d]{128}$/i.test(url.pathname))
        return url.href;
    } catch {}
  }
}

// src/tui-screen.ts
var {stringWidth } = globalThis.Bun;
var segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
function width(value) {
  return stringWidth(value);
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
var navigation = "\u2191\u2193 Navegar   Enter Abrir   ? Ajuda   Esc Sair";
var appTitle = "F O U R W O R D S";
var appSubtitle = "Compartilhamento  /  Salas  /  MCP";

class Tui {
  execute;
  done;
  screen = { kind: "home", index: 0 };
  lastRoom = "";
  notice = "";
  paste = false;
  scheduled;
  renderedScroll = 0;
  closed = false;
  constructor(execute, done) {
    this.execute = execute;
    this.done = done;
  }
  change(screen) {
    this.screen = screen;
    this.notice = "";
    this.redraw();
  }
  form(action, back, defaults = {}, tool) {
    const fields = action.fields ?? [];
    const values = Object.fromEntries(fields.map((f) => [
      f.id,
      defaults[f.id] ?? (f.id === "room" ? this.lastRoom : f.initial ?? (f.mode === "toggle" ? "off" : ""))
    ]));
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
      result.link = publicLink(value, id?.startsWith("room ") ?? false);
      result.room = back.kind === "form" ? back.values.room : undefined;
      if (id === "room create" && result.link)
        result.room = result.link;
      if (result.room)
        this.lastRoom = result.room;
      if (id === "room doc" && result.room && typeof data?.content === "string" && typeof data.updated_at === "number" && Number.isSafeInteger(data.updated_at)) {
        result.edit = { room: result.room, revision: data.updated_at, content: data.content };
      }
      this.change(result);
    }).catch((error) => {
      if (this.closed || this.screen !== state)
        return;
      const message = error instanceof Error ? error.message : String(error);
      this.change(viewer(title, back, "error", maskSecrets(message)));
    });
  }
  advance(form) {
    const missing = form.fields.findIndex((field) => field.required && !form.values[field.id].trim());
    if (missing >= 0) {
      form.focus = missing;
      form.issue = `Preencha o campo ${form.fields[missing].label}.`;
      return this.redraw();
    }
    if (form.action.write)
      return this.change({ kind: "confirm", form });
    this.start(form.action.title, form.action.job(form.values), form);
  }
  toolForm(catalog) {
    const tool = catalog.tools[catalog.index];
    const action = {
      id: "mcp call",
      section: "MCP",
      title: tool.name,
      description: tool.title ?? "Ferramenta anunciada pelo MCP.",
      fields: [{ id: "json", label: "Argumentos JSON", mode: "multiline", initial: "{}", hint: "F1 mostra a descri\xE7\xE3o e o esquema." }],
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
      this.notice = "Espera cancelada. Uma solicita\xE7\xE3o j\xE1 recebida pelo servidor pode ter sido aplicada.";
      return this.redraw();
    }
    return this.change(screen.kind === "confirm" ? screen.form : screen.back);
  }
  inputForm(form, text, key) {
    if (!this.paste && key.name === "f1") {
      const description = form.tool ? [form.tool.description ?? "", "", resultJson(form.tool.inputSchema ?? {}, false)].join(`
`) : help(form.action.id);
      return this.change(viewer("Ajuda do comando", form, "guide", description));
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
      form.issue = "O editor aceita at\xE9 200.000 caracteres neste campo.";
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
    const direction = key.name === "up" || text === "k" ? -1 : key.name === "down" || text === "j" ? 1 : 0;
    if (screen.kind === "home") {
      if (text === "q")
        return this.done();
      if (text === "?" || key.name === "f1")
        return this.change(viewer("Guia do painel", screen, "guide", keyGuide));
      if (direction)
        screen.index = (screen.index + direction + actions.length) % actions.length;
      if (key.name === "return") {
        const action = actions[screen.index];
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
        return this.change(viewer("Explorador MCP", screen, "guide", help("mcp call")));
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
        const action = actions.find((item) => item.id === "room save");
        const home = screen.back.kind === "form" ? screen.back.back : screen.back;
        const form = this.form(action, home, {
          room: screen.edit.room,
          base: String(screen.edit.revision),
          markdown: screen.edit.content
        });
        form.focus = 2;
        return this.change(form);
      }
      if (text.toLowerCase() === "y" && screen.link) {
        process.stdout.write(`\x1B]52;c;${Buffer.from(screen.link).toString("base64")}\x07`);
        this.notice = "Link enviado \xE0 \xE1rea de transfer\xEAncia. O terminal pode bloquear a c\xF3pia.";
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
    const title = line(form.action.title, size, "accent");
    const available = Math.max(1, height - (form.issue ? 2 : 1));
    const fields = form.fields.flatMap((field, index) => {
      const active = form.focus === index;
      const value = form.values[field.id];
      const label = line((active ? "\u203A " : "  ") + field.label + (field.required ? " *" : ""), size, active ? "accent" : "bright");
      if (field.mode === "toggle")
        return [[label, line(value === "on" ? "  \u25C9 Ativada" : "  \u25CB Desativada", size, active ? "accent" : "dim")]];
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
    fields.push([line(form.focus === form.fields.length ? "\u203A Continuar" : "  Continuar", size, form.focus === form.fields.length ? "selected" : "dim")]);
    let start = 0;
    while (start < form.focus && fields.slice(start, form.focus + 1).flat().length > available)
      start++;
    const visible = fields.slice(start).flat().slice(0, available);
    return [title, ...visible, ...form.issue ? [line(form.issue, size, "error")] : []];
  }
  render() {
    const columns = Math.max(2, process.stdout.columns || 80);
    const rows = Math.max(2, process.stdout.rows || 24);
    const size = columns - 1;
    const screen = this.screen;
    if (columns < 26 || rows < 8) {
      process.stdout.write("\x1B[H\x1B[2K" + line("4w \xB7 Amplie a janela", size, "accent") + "\x1B[J");
      return;
    }
    const header = [line(appTitle, size, "brand"), line(`4w ${VERSION}  \xB7  ${appSubtitle}`, size, "dim"), line("\u2500".repeat(size), size, "dim")];
    const height = rows - header.length - 3;
    let body = [];
    let footer = navigation;
    if (screen.kind === "home") {
      const action = actions[screen.index];
      const wide = size >= 82;
      const labels = actions.map((entry) => entry.title);
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
          line("Enter para abrir", detailsSize, "dim")
        ];
        body = Array.from({ length: Math.min(height, Math.max(menu.length, details.length)) }, (_, row) => {
          const label = menu[row] ?? "";
          const plain = label.replace(/\x1b\[[\d;]+m/g, "");
          return label + pad("", Math.max(0, menuSize - Bun.stringWidth(plain))) + paint(" \u2502  ", "dim") + (details[row] ?? "");
        });
      } else {
        body = [line(action.section, size, "brand"), ...this.menu(labels, screen.index, size, Math.max(1, height - 1))];
        footer = size < 34 ? "\u2191\u2193  Enter  ? Ajuda  Esc" : "\u2191\u2193 Menu  Enter Abrir  ? Ajuda  Esc";
      }
    } else if (screen.kind === "catalog") {
      body = [
        line(`Explorador MCP \xB7 ${screen.tools.length} ferramentas`, size, "accent"),
        ...this.menu(screen.tools.map((tool) => tool.name), screen.index, size, Math.max(1, height - 1))
      ];
      footer = "\u2191\u2193 Navegar   Enter Abrir   F1 Ajuda   Esc Voltar";
    } else if (screen.kind === "form") {
      body = this.renderForm(screen, size, height);
      footer = size >= 62 ? "Tab Campos   F2 / Ctrl+S Continuar   F1 Ajuda   Esc Voltar" : "Tab Campos  Ctrl+S Enviar  Esc Voltar";
    } else if (screen.kind === "confirm") {
      body = [
        line("CONFIRMAR OPERA\xC7\xC3O", size, "brand"),
        "",
        line(screen.form.action.title, size, "bright"),
        "",
        ...wrap("Os dados do formul\xE1rio ser\xE3o enviados ao endpoint MCP configurado.", size)
      ];
      footer = "Enter Confirmar   Esc Revisar";
    } else if (screen.kind === "busy") {
      body = [
        line("CONECTANDO AO FOURWORDS", size, "brand"),
        "",
        line(screen.title, size, "accent"),
        ...wrap("Aguardando a resposta do MCP\u2026", size)
      ];
      footer = "Esc Cancelar espera   Ctrl+C Sair";
    } else {
      const status = screen.status === "success" ? screen.reveal ? "RESPOSTA \xB7 CREDENCIAIS VIS\xCDVEIS" : "RESPOSTA" : screen.status === "error" ? "ERRO" : "AJUDA";
      body = [line(status, size, screen.status === "error" ? "error" : "brand"), line(screen.title, size, "accent")];
      if (screen.link && height > 4)
        body.push(line(screen.link, size, "success"));
      if (screen.cache?.size !== size || screen.cache.reveal !== screen.reveal) {
        const markdown = screen.edit && (screen.reveal ? screen.edit.content : maskSecrets(screen.edit.content));
        const raw = screen.edit ? `Revis\xE3o ${screen.edit.revision}

${markdown}` : screen.text ?? resultJson(screen.value, screen.reveal);
        screen.cache = { size, reveal: screen.reveal, lines: wrap(raw, size) };
      }
      const wrapped = screen.cache.lines;
      const page = Math.max(1, height - body.length);
      this.renderedScroll = Math.max(0, wrapped.length - page);
      screen.offset = Math.max(0, Math.min(screen.offset, this.renderedScroll));
      body.push(...wrapped.slice(screen.offset, screen.offset + page));
      const extra = [screen.link ? "Y Copiar" : "", screen.edit ? "E Editar" : "", screen.status === "success" ? "V Credenciais" : ""].filter(Boolean);
      footer = ["Esc Voltar", "\u2191\u2193 Rolar", ...extra].join("   ");
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
      stdout.write("\x1B[?1049h\x1B[?25l\x1B[?2004h");
      stdin.resume();
      app.redraw();
    } catch (error) {
      cleanup(error);
    }
  });
}

// src/cli.ts
async function main(args) {
  const topic = helpTopic(args);
  if (topic !== undefined)
    return console.log(help(topic));
  if (args[0] === "--version" || args[0] === "version")
    return console.log(`4w ${VERSION}`);
  if (args[0] === "--self-test") {
    if (new TextDecoder().decode(new TextEncoder().encode("4Words \u2713")) !== "4Words \u2713")
      throw new Error("Falha no autoteste.");
    return console.log(`4w ${VERSION} OK`);
  }
  if (!args.length || args.length === 1 && args[0] === "tui") {
    if (process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb") {
      return openTui(execute);
    }
    if (args.length)
      throw new Error("O painel precisa de um terminal interativo. Use 4w --help para os comandos.");
    return console.log(help());
  }
  console.log(JSON.stringify(await execute(args), null, 2));
}
main(process.argv.slice(2)).catch((error) => {
  console.error(`4w: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
