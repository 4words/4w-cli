import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { configPath, normalizeLang, readSavedLang, resolveLang, saveLang, SITE, VERSION } from "./help";

const MAX_FILE = 24 * 1024 * 1024;
const MAX_STREAM_FILE = 1024 * 1024 * 1024;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const ENC_TEXT_PREFIX = "4WENC1:";
const ENC_BIN_MAGIC = new Uint8Array([0x34, 0x57, 0x45, 0x4e, 0x43, 0x31, 0x00]); // "4WENC1\0"

type RecordValue = Record<string, unknown>;
type RpcResponse = { jsonrpc?: string; id?: number; result?: unknown; error?: { message?: string } };
export type Tool = { name: string; title?: string; description?: string; inputSchema?: RecordValue };

export type HistoryEntry = {
  created_at: number;
  command: string;
  url?: string;
  fourwords_url?: string;
  combo?: string;
  delete_url?: string;
  admin_key?: string;
  llm_key?: string;
  encrypted?: boolean;
};

function tr(en: string, ptbr: string, es = en): string {
  const lang = resolveLang();
  if (lang === "ptbr") return ptbr;
  if (lang === "es") return es;
  return en;
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(tr("Expected a JSON object.", "Esperava um objeto JSON.", "Se esperaba un objeto JSON."));
  }
  return value as RecordValue;
}

function compact<T extends RecordValue>(obj: T): RecordValue {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function parseNonNegativeInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(num)) {
    throw new Error(tr(
      `${flag} requires a non-negative integer.`,
      `${flag} requer um inteiro não negativo.`,
      `${flag} requiere un entero no negativo.`,
    ));
  }
  return num;
}

function llmAuth(values: { "llm-key"?: string; "llm-name"?: string }) {
  const llm_key = values["llm-key"] ?? process.env.FOURWORDS_LLM_KEY;
  const llm_name = values["llm-name"] ?? process.env.FOURWORDS_LLM_NAME;
  return compact({ llm_key, llm_name });
}

function historyPath(): string | undefined {
  if (process.env.FOURWORDS_HISTORY_FILE) return process.env.FOURWORDS_HISTORY_FILE;
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "4Words", "CLI", "history.json");
  }
  if (process.env.HOME) {
    return join(process.env.HOME, ".local", "share", "4words-cli", "history.json");
  }
  return undefined;
}

async function loadHistory(): Promise<HistoryEntry[]> {
  const file = historyPath();
  if (!file) return [];
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (item): item is HistoryEntry =>
        Boolean(item && typeof item === "object" && typeof item.created_at === "number" && now - item.created_at <= HISTORY_TTL_MS),
    );
  } catch {
    return [];
  }
}

async function saveHistoryEntry(command: string, output: unknown): Promise<void> {
  if (process.env.FOURWORDS_NO_HISTORY === "1") return;
  if (!output || typeof output !== "object" || Array.isArray(output)) return;
  const data = output as RecordValue;
  const delete_url = typeof data.delete_url === "string" ? data.delete_url : typeof data.deleteUrl === "string" ? data.deleteUrl : undefined;
  const admin_key = typeof data.admin_key === "string" ? data.admin_key : undefined;
  const llm_key = typeof data.llm_key === "string" ? data.llm_key : undefined;
  const url = typeof data.url === "string" ? data.url : undefined;
  const fourwords_url = typeof data.fourwords_url === "string" ? data.fourwords_url : undefined;
  const combo = typeof data.combo === "string" ? data.combo : undefined;
  if (!delete_url && !admin_key && !llm_key && !url) return;
  const file = historyPath();
  if (!file) return;
  try {
    const current = await loadHistory();
    const entry: HistoryEntry = compact({
      created_at: Date.now(),
      command,
      url,
      fourwords_url,
      combo,
      delete_url,
      admin_key,
      llm_key,
      encrypted: data.encrypted === true ? true : undefined,
    }) as HistoryEntry;
    const updated = [entry, ...current].slice(0, 200);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(updated, null, 2), { mode: 0o600 });
  } catch {
    // Ignore storage failures on read-only environments.
  }
}

async function encryptBytes(plain: Uint8Array): Promise<{ iv: Uint8Array; ciphertext: Uint8Array; keyBase64Url: string }> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    iv,
    ciphertext: new Uint8Array(encrypted),
    keyBase64Url: Buffer.from(rawKey).toString("base64url"),
  };
}

async function decryptBytes(iv: Uint8Array, ciphertext: Uint8Array, keyBase64Url: string): Promise<Uint8Array> {
  const rawKey = Buffer.from(keyBase64Url, "base64url");
  if (rawKey.byteLength !== 32 || iv.byteLength !== 12) {
    throw new Error(tr(
      "Invalid key or initialization vector for AES-256-GCM decryption.",
      "Chave ou vetor de inicialização inválido para descriptografia AES-256-GCM.",
      "Clave o vector de inicialización inválido para descifrado AES-256-GCM.",
    ));
  }
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    throw new Error(tr(
      "Decryption failed: wrong key or tampered ciphertext.",
      "Falha ao descriptografar: chave incorreta ou conteúdo adulterado.",
      "Error al descifrar: clave incorrecta o contenido alterado.",
    ));
  }
}

function attachKeyFragment(output: unknown, keyBase64Url: string): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const copy: RecordValue = { ...(output as RecordValue), encrypted: true };
  if (typeof copy.url === "string") copy.url = `${copy.url.split("#")[0]}#key=${keyBase64Url}`;
  if (typeof copy.fourwords_url === "string") copy.fourwords_url = `${copy.fourwords_url.split("#")[0]}#key=${keyBase64Url}`;
  return copy;
}

function unescapeHtml(html: string): string {
  return html
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function normalizeComboTarget(rawInput: string, baseEndpoint: URL): { targetUrl: URL; fragmentKey?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error(tr(
      "Provide a link or 4-word code.",
      "Informe um link ou código de 4 palavras.",
      "Indique un enlace o código de 4 palabras.",
    ));
  }
  let fragmentKey: string | undefined;
  let withoutHash = trimmed;
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    const hash = trimmed.slice(hashIndex + 1);
    withoutHash = trimmed.slice(0, hashIndex);
    const keyMatch = hash.match(/(?:^|&)key=([A-Za-z0-9_-]+)/);
    if (keyMatch) fragmentKey = keyMatch[1];
  }
  const normalizedCombo = withoutHash.replace(
    /([\p{L}\p{N}]+-[\p{L}\p{N}]+-[\p{L}\p{N}]+-[\p{L}\p{N}]+)-([0-9][0-9\s._-]*[0-9])$/u,
    (full, words: string, digits: string) => {
      const cleanDigits = digits.replace(/[\s._-]+/g, "");
      return cleanDigits.length === 9 ? `${words}-${cleanDigits}` : full;
    },
  );
  if (/^https?:\/\//i.test(normalizedCombo)) {
    const parsed = new URL(normalizedCombo);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (!(parsed.protocol === "https:" || (loopback && parsed.protocol === "http:")) || parsed.username || parsed.password) {
      throw new Error(tr(
        "URL must use HTTPS or loopback HTTP without credentials.",
        "A URL deve usar HTTPS ou HTTP em loopback, sem credenciais.",
        "La URL debe usar HTTPS o HTTP en loopback, sin credenciales.",
      ));
    }
    return { targetUrl: parsed, fragmentKey };
  }
  const cleanPath = normalizedCombo.replace(/^\/+/, "");
  const origin = new URL(baseEndpoint.origin);
  return { targetUrl: new URL(`/${cleanPath}`, origin), fragmentKey };
}

class FourWords {
  private id = 0;
  private session?: string;
  private protocol = "2025-03-26";
  private initialized = false;
  readonly endpoint: URL;
  readonly loopback: boolean;

  constructor(private readonly signal?: AbortSignal) {
    this.endpoint = new URL(process.env.FOURWORDS_MCP_URL || `${SITE}/mcp`);
    this.loopback = ["localhost", "127.0.0.1", "[::1]"].includes(this.endpoint.hostname);
    if (!(this.endpoint.protocol === "https:" || (this.loopback && this.endpoint.protocol === "http:")) ||
        this.endpoint.username || this.endpoint.password) {
      throw new Error(tr(
        "FOURWORDS_MCP_URL must use HTTPS or loopback HTTP without embedded credentials.",
        "FOURWORDS_MCP_URL deve usar HTTPS ou HTTP em loopback, sem credenciais na URL.",
        "FOURWORDS_MCP_URL debe usar HTTPS o HTTP en loopback, sin credenciales en la URL.",
      ));
    }
  }

  private authHeaders(): Record<string, string> {
    const token = process.env.FOURWORDS_TOKEN;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async rpc(method: string, params?: RecordValue, notification = false, stateless = false): Promise<unknown> {
    const id = notification ? undefined : ++this.id;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.authHeaders(),
    };
    if (stateless) {
      headers["MCP-Protocol-Version"] = "2026-07-28";
      headers["Mcp-Method"] = method;
      if (method === "tools/call" && typeof params?.name === "string") {
        headers["Mcp-Name"] = params.name;
      }
    } else {
      if (method !== "initialize") headers["MCP-Protocol-Version"] = this.protocol;
      if (this.session) headers["Mcp-Session-Id"] = this.session;
    }
    const timeout = AbortSignal.timeout(method === "tools/call" ? 120_000 : 30_000);
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(tr(
        `MCP returned HTTP ${response.status} on ${method}.`,
        `MCP retornou HTTP ${response.status} em ${method}.`,
        `MCP devolvió HTTP ${response.status} en ${method}.`,
      ));
    }
    if (method === "initialize") this.session = response.headers.get("Mcp-Session-Id") || undefined;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    const message: RpcResponse = response.headers.get("Content-Type")?.includes("text/event-stream")
      ? await readEvent(response, id!)
      : (await response.json()) as RpcResponse;
    if (message?.jsonrpc !== "2.0" || message.id !== id) {
      throw new Error(tr("Incompatible JSON-RPC response.", "Resposta JSON-RPC incompatível.", "Respuesta JSON-RPC incompatible."));
    }
    if (message.error) throw new Error(message.error.message || tr("JSON-RPC error.", "Erro JSON-RPC.", "Error JSON-RPC."));
    if (!("result" in message)) {
      throw new Error(tr("MCP response missing result.", "Resposta MCP sem resultado.", "Respuesta MCP sin resultado."));
    }
    return message.result;
  }

  async initialize() {
    const server = record(await this.rpc("initialize", {
      protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: "4w", version: VERSION },
    }));
    if (typeof server.protocolVersion !== "string") {
      throw new Error(tr(
        "MCP did not report a protocol version.",
        "MCP não informou a versão do protocolo.",
        "El MCP no informó la versión del protocolo.",
      ));
    }
    this.protocol = server.protocolVersion;
    await this.rpc("notifications/initialized", undefined, true);
    this.initialized = true;
    return server;
  }

  private canUseStateless(): boolean {
    if (process.env.FOURWORDS_STATELESS === "1") return true;
    if (process.env.FOURWORDS_STATELESS === "0") return false;
    return !this.loopback && !this.initialized;
  }

  async list() {
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    const stateless = this.canUseStateless();
    do {
      const page = record(await this.rpc("tools/list", cursor ? { cursor } : undefined, false, stateless && !cursor));
      if (!Array.isArray(page.tools)) {
        throw new Error(tr(
          "MCP returned an invalid tool list.",
          "O MCP retornou uma lista de ferramentas inválida.",
          "El MCP devolvió una lista de herramientas inválida.",
        ));
      }
      tools.push(...page.tools);
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (cursor && cursors.has(cursor)) {
        throw new Error(tr("Repeated MCP cursor.", "Cursor MCP repetido.", "Cursor MCP repetido."));
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }

  async call(name: string, args: RecordValue) {
    const stateless = this.canUseStateless();
    const result = record(await this.rpc("tools/call", { name, arguments: args }, false, stateless));
    const content = Array.isArray(result.content) ? result.content : [];
    if (result.isError) {
      const message = content.find((item) => item?.type === "text")?.text;
      throw new Error(typeof message === "string" ? message : tr(
        `MCP rejected ${name}.`,
        `O MCP recusou ${name}.`,
        `El MCP rechazó ${name}.`,
      ));
    }
    const text = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
    let output: unknown = result.structuredContent ?? result;
    if (result.structuredContent === undefined && typeof text === "string") {
      try { output = JSON.parse(text); } catch { output = text; }
    }
    if (output && typeof output === "object" && "conflict" in output && output.conflict) {
      throw new Error(tr(
        "The document changed during editing (conflict). Run 4w room doc, merge changes, and try again.",
        "O documento mudou durante a edição. Rode 4w room doc, incorpore as mudanças e tente novamente.",
        "El documento cambió durante la edición. Ejecute 4w room doc, incorpore los cambios e intente de nuevo.",
      ));
    }
    if (output && typeof output === "object" && "ok" in output && output.ok === false) {
      const detail = "error" in output && typeof output.error === "string"
        ? output.error
        : tr("operation rejected", "operação recusada", "operación rechazada");
      throw new Error(`${name}: ${detail}`);
    }
    return output;
  }

  async uploadFileStream(filename: string, body: BodyInit, burn: boolean, contentType = "application/octet-stream"): Promise<RecordValue> {
    const uploadUrl = new URL("/api/upload/file", this.endpoint.origin);
    uploadUrl.searchParams.set("name", filename);
    if (burn) uploadUrl.searchParams.set("burn", "1");
    const timeout = AbortSignal.timeout(600_000);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        ...this.authHeaders(),
      },
      redirect: "error",
      body,
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(tr(
        `Streaming upload returned HTTP ${response.status}.`,
        `Upload via streaming retornou HTTP ${response.status}.`,
        `Subida por streaming devolvió HTTP ${response.status}.`,
      ));
    }
    const payload = record(await response.json());
    const delete_url = typeof payload.delete_url === "string"
      ? payload.delete_url
      : typeof payload.deleteUrl === "string"
        ? payload.deleteUrl
        : undefined;
    const expires_at = typeof payload.expires_at === "string"
      ? payload.expires_at
      : typeof payload.expiresAt === "number"
        ? new Date(payload.expiresAt).toISOString()
        : undefined;
    return compact({
      ...payload,
      delete_url,
      expires_at,
      burn,
    });
  }
}

async function readEvent(response: Response, id: number): Promise<RpcResponse> {
  if (!response.body) throw new Error(tr("Empty MCP stream.", "Fluxo MCP vazio.", "Flujo MCP vacío."));
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += value ?? "";
      if (done && buffer) buffer += "\n\n";
      for (let end = buffer.match(/\r?\n\r?\n/); end; end = buffer.match(/\r?\n\r?\n/)) {
        const data = buffer.slice(0, end.index).split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        buffer = buffer.slice(end.index! + end[0].length);
        if (data) {
          const candidate: RpcResponse = JSON.parse(data);
          if (candidate.id === id) return candidate;
        }
      }
      if (done) {
        throw new Error(tr(
          "MCP stream ended without the expected response.",
          "Fluxo MCP terminou sem a resposta esperada.",
          "El flujo MCP terminó sin la respuesta esperada.",
        ));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fileStatSize(path: string, limit: number): Promise<number> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(tr("Provide a regular file.", "Informe um arquivo regular.", "Indique un archivo regular."));
    if (stat.size > limit) {
      throw new Error(tr(
        `File exceeds the ${limit} byte limit.`,
        `Arquivo excede o limite de ${limit} bytes.`,
        `El archivo supera el límite de ${limit} bytes.`,
      ));
    }
    return stat.size;
  } finally {
    await file.close();
  }
}

async function fileBytes(path: string, limit: number) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(tr("Provide a regular file.", "Informe um arquivo regular.", "Indique un archivo regular."));
    if (stat.size > limit) {
      throw new Error(tr(
        `File exceeds the ${limit} byte limit.`,
        `Arquivo excede o limite de ${limit} bytes.`,
        `El archivo supera el límite de ${limit} bytes.`,
      ));
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) {
      throw new Error(tr(
        "File size changed while reading. Please try again.",
        "O tamanho do arquivo mudou durante a leitura. Tente novamente.",
        "El tamaño del archivo cambió durante la lectura. Intente de nuevo.",
      ));
    }
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}

async function readText(path: string, limit = 100_000, input?: string) {
  if (path === "-" && input !== undefined) {
    if (Buffer.byteLength(input) > limit) {
      throw new Error(tr(`Input exceeds ${limit} bytes.`, `A entrada excede ${limit} bytes.`, `La entrada supera ${limit} bytes.`));
    }
    return input;
  }
  if (path !== "-") return new TextDecoder("utf-8", { fatal: true }).decode(await fileBytes(path, limit));
  const parts: Buffer[] = [];
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

function exact(values: string[], count: number, usage: string) {
  if (values.length !== count) throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w ${usage}`);
}

function hasBinaryMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < ENC_BIN_MAGIC.byteLength + 12 + 16) return false;
  for (let i = 0; i < ENC_BIN_MAGIC.byteLength; i++) {
    if (bytes[i] !== ENC_BIN_MAGIC[i]) return false;
  }
  return true;
}

async function fetchFourWordsLink(
  mcp: FourWords,
  rawTarget: string,
  options: { output?: string; raw?: boolean; key?: string },
  signal?: AbortSignal,
): Promise<unknown> {
  const { targetUrl, fragmentKey } = normalizeComboTarget(rawTarget, mcp.endpoint);
  const key = options.key ?? fragmentKey;
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Accept: "text/html, text/plain, application/octet-stream, */*",
    },
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(tr(
      `Failed to fetch ${targetUrl.pathname}: HTTP ${response.status}.`,
      `Falha ao acessar ${targetUrl.pathname}: HTTP ${response.status}.`,
      `Error al acceder a ${targetUrl.pathname}: HTTP ${response.status}.`,
    ));
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (contentType.includes("text/html")) {
    const html = await response.text();
    const storedMatch = html.match(/<pre[^>]*class="stored"[^>]*>([\s\S]*?)<\/pre>/i);
    if (!storedMatch) {
      throw new Error(tr(
        "Content not found or link expired.",
        "Conteúdo não encontrado ou link expirado.",
        "Contenido no encontrado o enlace expirado.",
      ));
    }
    let text = unescapeHtml(storedMatch[1]);
    let decrypted = false;
    if (text.startsWith(ENC_TEXT_PREFIX)) {
      if (!key) {
        throw new Error(tr(
          "Encrypted content. Provide the URL with #key= or pass --key KEY.",
          "Conteúdo criptografado. Informe a URL com #key= ou use --key CHAVE.",
          "Contenido cifrado. Indique la URL con #key= o use --key CLAVE.",
        ));
      }
      const parts = text.slice(ENC_TEXT_PREFIX.length).split(":");
      if (parts.length !== 2) {
        throw new Error(tr("Invalid encrypted text format.", "Formato de texto criptografado inválido.", "Formato de texto cifrado inválido."));
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
      __raw: options.raw ? text : undefined,
    });
  }

  let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  let decrypted = false;
  if (hasBinaryMagic(bytes)) {
    if (!key) {
      throw new Error(tr(
        "Encrypted file. Provide the URL with #key= or pass --key KEY.",
        "Arquivo criptografado. Informe a URL com #key= ou use --key CHAVE.",
        "Archivo cifrado. Indique la URL con #key= o use --key CLAVE.",
      ));
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
        throw new Error(tr(
          "Encrypted content. Provide the URL with #key= or pass --key KEY.",
          "Conteúdo criptografado. Informe a URL com #key= ou use --key CHAVE.",
          "Contenido cifrado. Indique la URL con #key= o use --key CLAVE.",
        ));
      }
      const parts = maybeText.slice(ENC_TEXT_PREFIX.length).split(":");
      if (parts.length !== 2) {
        throw new Error(tr("Invalid encrypted text format.", "Formato de texto criptografado inválido.", "Formato de texto cifrado inválido."));
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
    __raw: options.raw ? (textContent ?? Buffer.from(bytes)) : undefined,
  });
}

export async function execute(args: string[], signal?: AbortSignal, input?: string): Promise<unknown> {
  const [command, ...rest] = args;
  let invoke: (mcp: FourWords) => Promise<unknown>;
  let forceInitialize = false;
  let skipMcp = false;

  if (command === "doctor") {
    exact(rest, 0, "doctor");
    forceInitialize = true;
    invoke = async (mcp) => ({ ok: true, version: VERSION, tools: (await mcp.list()).length });
  } else if (command === "lang") {
    if (rest.length > 1) throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w lang [en|ptbr|es]`);
    skipMcp = true;
    invoke = async () => {
      if (rest.length === 0) {
        return {
          ok: true,
          lang: resolveLang(),
          saved: readSavedLang() ?? null,
          available: ["en", "ptbr", "es"],
          config_file: configPath() ?? null,
        };
      }
      const target = normalizeLang(rest[0]);
      if (!target) {
        throw new Error(`Invalid language / Idioma inválido: ${rest[0]}. Use: en, ptbr, es.`);
      }
      const config_file = saveLang(target) ?? null;
      const messages = {
        en: "Default language updated and saved on this machine: English (en).",
        ptbr: "Idioma padrão alterado e salvo nesta máquina: Português (ptbr).",
        es: "Idioma predeterminado cambiado y guardado en esta máquina: Español (es).",
      };
      return {
        ok: true,
        lang: target,
        saved: true,
        available: ["en", "ptbr", "es"],
        config_file,
        message: messages[target],
      };
    };
  } else if (command === "history") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { clear: { type: "boolean" } },
    });
    exact(positionals, 0, "history [--clear]");
    skipMcp = true;
    invoke = async () => {
      if (values.clear) {
        const file = historyPath();
        if (file) await rm(file, { force: true }).catch(() => {});
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
        key: { type: "string" },
      },
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
        ...(command === "text"
          ? { file: { type: "string" } }
          : { stream: { type: "boolean" }, type: { type: "string" } }),
      },
    });
    const burn = values["no-burn"] ? false : (values.burn ?? true);
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
        let payloadBytes: Uint8Array = rawBytes;
        let keyBase64Url: string | undefined;
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
              burn,
            }));
            return keyBase64Url ? attachKeyFragment(out, keyBase64Url) : out;
          };
        }
      }
    } else {
      const path = typeof values.file === "string" ? values.file : undefined;
      exact(positionals, path === undefined ? 1 : 0, "text TEXT|-|--file FILE [--burn|--no-burn] [--encrypt]");
      let content = path !== undefined ? await readText(path, 100_000, input) :
        positionals[0] === "-" ? await readText("-", 100_000, input) : positionals[0];
      if (!content.trim() || Buffer.byteLength(content) > 100_000) {
        throw new Error(tr(
          "Provide UTF-8 text from 1 to 100,000 bytes.",
          "Informe texto UTF-8 de 1 a 100.000 bytes.",
          "Indique texto UTF-8 de 1 a 100.000 bytes.",
        ));
      }
      let keyBase64Url: string | undefined;
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
      "llm-key": { type: "string" as const },
      "llm-name": { type: "string" as const },
    };
    if (action === "create") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          doc: { type: "string" },
          message: { type: "string" },
          "llm-name": { type: "string" },
        },
      });
      exact(positionals, 0, "room create [--doc FILE] [--message TEXT] [--llm-name NAME]");
      const initial_markdown = values.doc === undefined ? undefined : await readText(values.doc, 200_000, input);
      if (initial_markdown && initial_markdown.length > 50_000) {
        throw new Error(tr(
          "Markdown exceeds 50,000 UTF-16 code units.",
          "Markdown excede 50.000 unidades UTF-16.",
          "El Markdown supera las 50.000 unidades UTF-16.",
        ));
      }
      const initial_message = values.message;
      const llm_name = values["llm-name"] ?? process.env.FOURWORDS_LLM_NAME;
      const createArgs: RecordValue = { initial_markdown };
      if (initial_message !== undefined) createArgs.initial_message = initial_message;
      if (llm_name !== undefined) createArgs.llm_name = llm_name;
      invoke = (mcp) => mcp.call("chat_create", createArgs);
    } else if (action === "messages") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          since: { type: "string" },
          "mentions-only": { type: "boolean" },
          nick: { type: "string" },
          ...llmOptions,
        },
      });
      exact(positionals, 1, "room messages ROOM [--since N] [--mentions-only] [--nick NICK]");
      const since = parseNonNegativeInt(values.since, "--since");
      const extra = compact({
        mentions_only: values["mentions-only"],
        nick: values.nick,
        ...llmAuth(values),
      });
      invoke = (mcp) => mcp.call("chat_messages", { url: positionals[0], since, ...extra });
    } else if (action === "join" || action === "doc" || action === "participants" || action === "nick") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: llmOptions,
      });
      exact(positionals, 1, `room ${action} ROOM`);
      const toolMap = {
        join: "chat_join",
        doc: "chat_get_doc",
        participants: "chat_participants",
        nick: "chat_roll_nick",
      } as const;
      invoke = (mcp) => mcp.call(toolMap[action], { url: positionals[0], ...llmAuth(values) });
    } else if (action === "register-llm") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: llmOptions,
      });
      exact(positionals, 1, "room register-llm ROOM --llm-key KEY [--llm-name NAME]");
      const auth = llmAuth(values);
      if (typeof auth.llm_key !== "string" || !auth.llm_key.trim()) {
        throw new Error(tr(
          "Provide --llm-key or set FOURWORDS_LLM_KEY.",
          "Informe --llm-key ou defina FOURWORDS_LLM_KEY.",
          "Indique --llm-key o defina FOURWORDS_LLM_KEY.",
        ));
      }
      invoke = (mcp) => mcp.call("chat_register_llm", { url: positionals[0], ...auth });
    } else if (action === "send") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          nick: { type: "string" },
          ...llmOptions,
        },
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
          ...llmOptions,
        },
      });
      exact(positionals, 2, "room send-file ROOM FILE [--text MESSAGE] [--burn|--no-burn]");
      const [url, filePath] = positionals;
      const content_base64 = (await fileBytes(filePath, MAX_FILE)).toString("base64");
      const burn = values["no-burn"] ? false : (values.burn ?? true);
      const extra = compact({
        text: values.text,
        nick: values.nick,
        burn,
        ...llmAuth(values),
      });
      invoke = (mcp) => mcp.call("chat_send_file", {
        url,
        filename: basename(filePath),
        content_base64,
        ...extra,
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
          ...llmOptions,
        },
      });
      const rollback_to_version = parseNonNegativeInt(values["rollback-version"], "--rollback-version");
      const rollback_to_ts = parseNonNegativeInt(values["rollback-ts"], "--rollback-ts");
      const isRollback = rollback_to_version !== undefined || rollback_to_ts !== undefined;
      if (isRollback) {
        if (positionals.length < 1 || positionals.length > 2) {
          throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w room save ROOM [FILE] [--base N] [--rollback-version V | --rollback-ts TS]`);
        }
        const base_updated_at = parseNonNegativeInt(values.base, "--base");
        const content = positionals[1] ? await readText(positionals[1], 200_000, input) : undefined;
        if (content && content.length > 50_000) {
          throw new Error(tr(
            "Markdown exceeds 50,000 UTF-16 code units.",
            "Markdown excede 50.000 unidades UTF-16.",
            "El Markdown supera las 50.000 unidades UTF-16.",
          ));
        }
        const saveArgs = compact({
          url: positionals[0],
          content,
          base_updated_at,
          rollback_to_version,
          rollback_to_ts,
          export_fourwords_link: values["export-link"],
          nick: values.nick,
          ...llmAuth(values),
        });
        invoke = (mcp) => mcp.call("chat_save_doc", saveArgs);
      } else {
        exact(positionals, 2, "room save ROOM FILE --base N");
        const base_updated_at = Number(values.base);
        if (values.base === undefined || !/^\d+$/.test(values.base) || !Number.isSafeInteger(base_updated_at)) {
          throw new Error(tr(
            "Provide --base with the updated_at from 4w room doc. Use 0 for an unrevised room.",
            "Informe --base com o updated_at de 4w room doc. Use 0 para uma sala sem revisão.",
            "Indique --base con el updated_at de 4w room doc. Use 0 para una sala sin revisión.",
          ));
        }
        const content = await readText(positionals[1], 200_000, input);
        if (content.length > 50_000) {
          throw new Error(tr(
            "Markdown exceeds 50,000 UTF-16 code units.",
            "Markdown excede 50.000 unidades UTF-16.",
            "El Markdown supera las 50.000 unidades UTF-16.",
          ));
        }
        const extra = compact({
          export_fourwords_link: values["export-link"],
          nick: values.nick,
          ...llmAuth(values),
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
          ...llmOptions,
        },
      });
      exact(positionals, 1, "room wait ROOM [--since N] [--since-doc TS] [--timeout S] [--all]");
      const since = parseNonNegativeInt(values.since, "--since");
      const since_doc_ts = parseNonNegativeInt(values["since-doc"], "--since-doc");
      const timeout_seconds = parseNonNegativeInt(values.timeout, "--timeout");
      if (timeout_seconds !== undefined && (timeout_seconds < 1 || timeout_seconds > 25)) {
        throw new Error(tr(
          "--timeout must be between 1 and 25 seconds.",
          "--timeout deve estar entre 1 e 25 segundos.",
          "--timeout debe estar entre 1 y 25 segundos.",
        ));
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
        ...llmAuth(values),
      }));
    } else if (action === "moderate") {
      const { values, positionals } = parseArgs({
        args: roomArgs,
        allowPositionals: true,
        options: {
          "admin-key": { type: "string" },
          nick: { type: "string" },
          "ban-id": { type: "string" },
          ...llmOptions,
        },
      });
      exact(positionals, 2, "room moderate ROOM <ban|unban|list|verify> --admin-key KEY [--nick NICK] [--ban-id ID]");
      const [url, modAction] = positionals;
      if (!["ban", "unban", "list", "verify"].includes(modAction)) {
        throw new Error(tr(
          "Invalid moderation action. Use ban, unban, list, or verify.",
          "Ação de moderação inválida. Use ban, unban, list ou verify.",
          "Acción de moderación inválida. Use ban, unban, list o verify.",
        ));
      }
      const admin_key = values["admin-key"] ?? process.env.FOURWORDS_ADMIN_KEY;
      if (!admin_key || !admin_key.trim()) {
        throw new Error(tr(
          "Provide --admin-key or set FOURWORDS_ADMIN_KEY.",
          "Informe --admin-key ou defina FOURWORDS_ADMIN_KEY.",
          "Indique --admin-key o defina FOURWORDS_ADMIN_KEY.",
        ));
      }
      invoke = (mcp) => mcp.call("chat_moderate", compact({
        url,
        action: modAction,
        admin_key,
        nick: values.nick,
        ban_id: values["ban-id"],
        ...llmAuth(values),
      }));
    } else {
      throw new Error(tr(
        "Unknown room action. See 4w --help.",
        "Ação de sala desconhecida. Consulte 4w --help.",
        "Acción de sala desconocida. Consulte 4w --help.",
      ));
    }
  } else if (command === "mcp") {
    if (rest[0] === "list") {
      exact(rest, 1, "mcp list");
      invoke = (mcp) => mcp.list();
    } else if (rest[0] === "call" && rest.length >= 2 && rest.length <= 3) {
      const [, name, raw = "{}"] = rest;
      const params = record(JSON.parse(raw === "-" ? await readText("-", 40 * 1024 * 1024, input) : raw));
      invoke = (mcp) => mcp.call(name, params);
    } else throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w mcp list | 4w mcp call TOOL [JSON|-]`);
  } else {
    throw new Error(tr(
      `Unknown command: ${command}. See 4w --help.`,
      `Comando desconhecido: ${command}. Consulte 4w --help.`,
      `Comando desconocido: ${command}. Consulte 4w --help.`,
    ));
  }

  const mcp = new FourWords(signal);
  if (!skipMcp && (forceInitialize || (mcp.loopback && process.env.FOURWORDS_STATELESS !== "1") || process.env.FOURWORDS_STATELESS === "0")) {
    await mcp.initialize();
  }
  const output = await invoke(mcp);
  const fullCommand = command === "room" && rest[0] ? `room ${rest[0]}` : command;
  await saveHistoryEntry(fullCommand, output);
  return output;
}
