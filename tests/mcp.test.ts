import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
let directory: string;
let server: ReturnType<typeof Bun.serve>;
let requests: { method: string; params?: Record<string, unknown>; headers?: Record<string, string> }[];
let storedText = "";
let storedBinary: Uint8Array | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "4w-test-"));
  requests = [];
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "PUT" && url.pathname === "/api/upload/file") {
        storedBinary = new Uint8Array(await request.arrayBuffer());
        return Response.json({
          url: `${server.url.origin}/rio-sol-lua-mar-123456789`,
          combo: "rio-sol-lua-mar-123456789",
          deleteUrl: `${server.url.origin}/d/${"b".repeat(128)}`,
          expiresAt: Date.now() + 86_400_000,
          filename: url.searchParams.get("name"),
        });
      }
      if (request.method === "GET" && url.pathname === "/rio-sol-lua-mar-123456789") {
        if (storedBinary) {
          const body = Buffer.from(storedBinary);
          return new Response(body, { headers: { "Content-Type": "application/octet-stream" } });
        }
        const escaped = storedText
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return new Response(`<!DOCTYPE html><html><body><pre class="stored">${escaped}</pre></body></html>`, {
          headers: { "Content-Type": "text/html;charset=utf-8" },
        });
      }
      const call = await request.json();
      const headersObj = {
        protocol: request.headers.get("MCP-Protocol-Version") ?? "",
        mcpMethod: request.headers.get("Mcp-Method") ?? "",
        mcpName: request.headers.get("Mcp-Name") ?? "",
        session: request.headers.get("Mcp-Session-Id") ?? "",
      };
      requests.push({ ...call, headers: headersObj });
      const { method, id, params } = call;
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
      if (method === "initialize") {
        const result = { protocolVersion: "2025-03-26", capabilities: { tools: {} } };
        return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "Mcp-Session-Id": "test-session" } });
      }
      const isStateless2026 = headersObj.protocol === "2026-07-28" && headersObj.mcpMethod === method;
      if (!isStateless2026 && (headersObj.session !== "test-session" || headersObj.protocol !== "2025-03-26")) {
        return new Response("", { status: 400 });
      }
      if (method === "notifications/initialized") return new Response(null, { status: 202 });
      if (method === "tools/list") {
        if (!params?.cursor) return reply({ tools: [{ name: "upload_text" }], nextCursor: "page2" });
        const message = JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [{ name: "chat_save_doc" }] } });
        return new Response(`:keepalive\r\n\r\nevent: message\r\ndata: ${message}\r\n\r\n`,
          { headers: { "Content-Type": "text/event-stream" } });
      }
      if (params.name === "chat_save_doc" && params.arguments.rollback_to_version === undefined && params.arguments.base_updated_at !== 17) {
        return reply({ structuredContent: { ok: false, conflict: true, current_updated_at: 17 } });
      }
      if (params.name === "upload_text") {
        storedText = String(params.arguments.content ?? "");
        if (storedText.startsWith("4WENC1:")) {
          return reply({
            structuredContent: {
              url: `${server.url.origin}/rio-sol-lua-mar-123456789`,
              combo: "rio-sol-lua-mar-123456789",
              delete_url: `${server.url.origin}/d/${"a".repeat(128)}`,
              burn: Boolean(params.arguments.burn),
            },
          });
        }
        return reply({ content: [{ type: "text", text: JSON.stringify(params.arguments) }] });
      }
      return reply({ structuredContent: { ok: true, tool: params.name, ...params.arguments } });
    },
  });
});
afterAll(async () => { server.stop(true); await rm(directory, { recursive: true, force: true }); });

async function run(args: string[], input?: string, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    FOURWORDS_MCP_URL: server.url.href,
    FOURWORDS_HISTORY_FILE: join(directory, "history.json"),
    FOURWORDS_CONFIG_FILE: join(directory, "config.json"),
    ...extraEnv,
  };
  if (!extraEnv.FOURWORDS_LANG) delete env.FOURWORDS_LANG;
  const p = Bun.spawn([process.execPath, cli, ...args], {
    env: env as Record<string, string>,
    stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([p.exited, p.stdout.text(), p.stderr.text()]);
  return { code, out, err };
}

test("doctor negocia sessão, paginação e resposta SSE", async () => {
  const { code, out } = await run(["doctor"]);
  expect(code).toBe(0);
  expect(JSON.parse(out)).toMatchObject({ ok: true, tools: 2 });
});

test("text preserva Unicode, stdin e burn ativo por padrão", async () => {
  const { code, out } = await run(["text", "-"], "Olá 🌊\n");
  expect(code).toBe(0);
  expect(JSON.parse(out)).toEqual({ content: "Olá 🌊\n", burn: true });

  const noBurn = await run(["text", "-", "--no-burn"], "Olá 🌊\n");
  expect(noBurn.code).toBe(0);
  expect(JSON.parse(noBurn.out)).toEqual({ content: "Olá 🌊\n", burn: false });
});

test("file codifica os bytes originais em base64 com burn ativo por padrão", async () => {
  const path = join(directory, "amostra.bin");
  await writeFile(path, Uint8Array.from([0, 0xff, 0x1f]));
  const { code, out } = await run(["file", path]);
  expect(code).toBe(0);
  expect(JSON.parse(out)).toMatchObject({ filename: "amostra.bin", content_base64: "AP8f", burn: true });

  const noBurn = await run(["file", path, "--no-burn"]);
  expect(noBurn.code).toBe(0);
  expect(JSON.parse(noBurn.out)).toMatchObject({ filename: "amostra.bin", content_base64: "AP8f", burn: false });
});

test("room save exige revisão e propaga conflito sem reenviar", async () => {
  const path = join(directory, "sala.md");
  await writeFile(path, "# Olá\n");
  const count = requests.length;
  expect((await run(["room", "save", "sala", path])).code).toBe(1);
  expect(requests.length).toBe(count);
  const conflict = await run(["room", "save", "sala", path, "--base", "16"]);
  expect(conflict.code).toBe(1);
  expect(conflict.err).toContain("document changed");
  const saved = await run(["room", "save", "sala", path, "--base", "17"]);
  expect(saved.code).toBe(0);
  expect(JSON.parse(saved.out)).toMatchObject({ url: "sala", content: "# Olá\n", base_updated_at: 17 });
  expect(requests.slice(count).filter((r) => r.method === "tools/call")).toHaveLength(2);
});

test("mcp call aceita JSON por stdin e rejeita arrays antes da rede", async () => {
  const valid = await run(["mcp", "call", "chat_create", "-"], '{"initial_markdown":"# Sala"}');
  expect(valid.code).toBe(0);
  expect(JSON.parse(valid.out)).toMatchObject({ initial_markdown: "# Sala" });
  const count = requests.length;
  expect((await run(["mcp", "call", "chat_create", "[]"])).code).toBe(1);
  expect(requests.length).toBe(count);
});

test("criptografia Zero-Knowledge (--encrypt) e descriptografia via 4w get (--raw)", async () => {
  storedBinary = undefined;
  const pub = await run(["text", "Segredo confidencial 🔐", "--burn", "--encrypt"]);
  expect(pub.code).toBe(0);
  const parsed = JSON.parse(pub.out);
  expect(parsed.encrypted).toBe(true);
  expect(parsed.url).toContain("#key=");
  expect(storedText.startsWith("4WENC1:")).toBe(true);
  expect(storedText).not.toContain("Segredo");

  // Sem chave deve recusar descriptografia (padrão em inglês, ou português com FOURWORDS_LANG=ptbr)
  const noKey = await run(["get", "rio-sol-lua-mar-123456789"]);
  expect(noKey.code).toBe(1);
  expect(noKey.err).toContain("Encrypted content");

  const noKeyPt = await run(["get", "rio-sol-lua-mar-123456789"], undefined, { FOURWORDS_LANG: "ptbr" });
  expect(noKeyPt.code).toBe(1);
  expect(noKeyPt.err).toContain("Conteúdo criptografado");

  // Com URL contendo #key= descriptografa no modo JSON e no modo --raw
  const fetched = await run(["get", parsed.url]);
  expect(fetched.code).toBe(0);
  expect(JSON.parse(fetched.out)).toMatchObject({
    ok: true,
    type: "text",
    decrypted: true,
    content: "Segredo confidencial 🔐",
  });

  const rawFetched = await run(["get", parsed.url, "--raw"]);
  expect(rawFetched.code).toBe(0);
  expect(rawFetched.out).toBe("Segredo confidencial 🔐");
});

test("upload por streaming (--stream) criptografado e download em arquivo via 4w get --output", async () => {
  const srcPath = join(directory, "payload.bin");
  const dstPath = join(directory, "restored.bin");
  const original = Uint8Array.from([10, 20, 30, 40, 255, 0, 128]);
  await writeFile(srcPath, original);

  const up = await run(["file", srcPath, "--stream", "--encrypt", "--burn"]);
  expect(up.code).toBe(0);
  const upData = JSON.parse(up.out);
  expect(upData.encrypted).toBe(true);
  expect(upData.url).toContain("#key=");
  expect(upData.delete_url).toContain("/d/");

  const down = await run(["get", upData.url, "--output", dstPath]);
  expect(down.code).toBe(0);
  const restored = new Uint8Array(await readFile(dstPath));
  expect(Array.from(restored)).toEqual(Array.from(original));
});

test("protocolo MCP 2026-07-28 1-RTT stateless e cofre local 4w history", async () => {
  const before = requests.length;
  const delUrl = `${server.url.origin}/d/${"c".repeat(128)}`;
  const del = await run(["delete", delUrl], undefined, { FOURWORDS_STATELESS: "1" });
  expect(del.code).toBe(0);
  expect(JSON.parse(del.out)).toMatchObject({ ok: true, tool: "delete_content", delete_url: delUrl });
  // Em modo stateless 2026-07-28 deve enviar exatamente 1 requisição sem initialize prévio
  const recent = requests.slice(before);
  expect(recent).toHaveLength(1);
  expect(recent[0].headers?.protocol).toBe("2026-07-28");
  expect(recent[0].headers?.mcpMethod).toBe("tools/call");
  expect(recent[0].headers?.mcpName).toBe("delete_content");

  const hist = await run(["history"]);
  expect(hist.code).toBe(0);
  const histData = JSON.parse(hist.out);
  expect(histData.ok).toBe(true);
  expect(histData.count).toBeGreaterThan(0);

  const clear = await run(["history", "--clear"]);
  expect(clear.code).toBe(0);
  const empty = JSON.parse((await run(["history"])).out);
  expect(empty.count).toBe(0);
});

test("cobertura completa das ferramentas de sala (wait, moderate, register-llm, participants, nick, send-file, rollback)", async () => {
  const sampleFile = join(directory, "anexo.txt");
  await writeFile(sampleFile, "anexo de sala");

  const waitRes = await run(["room", "wait", "sala-1", "--since", "5", "--timeout", "10", "--all", "--llm-key", "fwllm_123", "--llm-name", "claude"]);
  expect(waitRes.code).toBe(0);
  expect(JSON.parse(waitRes.out)).toMatchObject({
    tool: "chat_wait_events",
    url: "sala-1",
    since: 5,
    timeout_seconds: 10,
    mentions_only: false,
    llm_key: "fwllm_123",
    llm_name: "claude",
  });

  const modRes = await run(["room", "moderate", "sala-1", "ban", "--admin-key", "fwadm_999", "--nick", "spammer"]);
  expect(modRes.code).toBe(0);
  expect(JSON.parse(modRes.out)).toMatchObject({
    tool: "chat_moderate",
    url: "sala-1",
    action: "ban",
    admin_key: "fwadm_999",
    nick: "spammer",
  });

  const regRes = await run(["room", "register-llm", "sala-1", "--llm-key", "fwllm_123", "--llm-name", "gemini"]);
  expect(regRes.code).toBe(0);
  expect(JSON.parse(regRes.out)).toMatchObject({
    tool: "chat_register_llm",
    url: "sala-1",
    llm_key: "fwllm_123",
    llm_name: "gemini",
  });

  const partRes = await run(["room", "participants", "sala-1"]);
  expect(partRes.code).toBe(0);
  expect(JSON.parse(partRes.out)).toMatchObject({ tool: "chat_participants", url: "sala-1" });

  const nickRes = await run(["room", "nick", "sala-1"]);
  expect(nickRes.code).toBe(0);
  expect(JSON.parse(nickRes.out)).toMatchObject({ tool: "chat_roll_nick", url: "sala-1" });

  const fileRes = await run(["room", "send-file", "sala-1", sampleFile, "--text", "Segue", "--burn"]);
  expect(fileRes.code).toBe(0);
  expect(JSON.parse(fileRes.out)).toMatchObject({
    tool: "chat_send_file",
    url: "sala-1",
    filename: "anexo.txt",
    text: "Segue",
    burn: true,
  });

  const rollbackRes = await run(["room", "save", "sala-1", "--rollback-version", "2"]);
  expect(rollbackRes.code).toBe(0);
  expect(JSON.parse(rollbackRes.out)).toMatchObject({
    tool: "chat_save_doc",
    url: "sala-1",
    rollback_to_version: 2,
  });
});
