import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { help, helpTopic, resolveLang, saveLang } from "../src/help";
import { actionsFor, deleteLink, keyGuideFor, publicLink, resultJson, textSafe } from "../src/tui-model";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const terminalSession = fileURLToPath(new URL("./terminal-session.py", import.meta.url));

test("ajuda geral e contextual cobrem en (padrão), ptbr e es e preservam argumentos literais", () => {
  expect(help("", "en")).toContain("Open the interactive panel");
  expect(help("", "ptbr")).toContain("4w room save SALA ARQUIVO --base N");
  expect(help("", "es")).toContain("Abre el panel interactivo");
  expect(help(helpTopic(["room", "save", "--help"]), "ptbr")).toContain("updated_at");
  expect(help(helpTopic(["help", "mcp", "call"]), "en")).toContain("stdin");
  expect(help(helpTopic(["get", "--help"]), "en")).toContain("--raw");
  expect(help(helpTopic(["lang", "--help"]), "en")).toContain("4w lang [en|ptbr|es]");
  expect(help(helpTopic(["room", "wait", "--help"]), "ptbr")).toContain("long-polling");
  expect(help(helpTopic(["room", "moderate", "--help"]), "es")).toContain("admin_key");
  expect(help("get", "en")).toContain("Fetches text or binary file");
  expect(help("tui", "es")).toContain("Panel interactivo");
  expect(actionsFor("en")[0].title).toBe("Publish text");
  expect(actionsFor("ptbr")[0].title).toBe("Publicar texto");
  expect(actionsFor("es")[0].title).toBe("Publicar texto");
  expect(keyGuideFor("en")).toContain("Switch & save language");
  expect(keyGuideFor("ptbr")).toContain("Trocar e salvar idioma");
  expect(keyGuideFor("es")).toContain("Cambiar y guardar idioma");
  expect(helpTopic(["text", "--", "--help"])).toBeUndefined();
  expect(() => help("inexistente", "ptbr")).toThrow("Tópico desconhecido");
  expect(() => help("inexistente", "en")).toThrow("Unknown topic");
  expect(() => help("inexistente", "es")).toThrow("Tema desconocido");
});

test("idioma padrão é en e a preferência (en, ptbr, es) fica salva e lembrada na máquina", async () => {
  const dir = await mkdtemp(join(tmpdir(), "4w-lang-"));
  const configFile = join(dir, "config.json");
  const prevConfig = process.env.FOURWORDS_CONFIG_FILE;
  const prevLang = process.env.FOURWORDS_LANG;
  try {
    process.env.FOURWORDS_CONFIG_FILE = configFile;
    delete process.env.FOURWORDS_LANG;
    expect(resolveLang()).toBe("en");

    saveLang("ptbr");
    expect(resolveLang()).toBe("ptbr");

    saveLang("es");
    expect(resolveLang()).toBe("es");

    saveLang("en");
    expect(resolveLang()).toBe("en");
  } finally {
    if (prevConfig === undefined) delete process.env.FOURWORDS_CONFIG_FILE;
    else process.env.FOURWORDS_CONFIG_FILE = prevConfig;
    if (prevLang === undefined) delete process.env.FOURWORDS_LANG;
    else process.env.FOURWORDS_LANG = prevLang;
    await rm(dir, { recursive: true, force: true });
  }
});

test("respostas do painel protegem credenciais e bloqueiam controles VT", () => {
  const result = {
    url: "https://4words.aletheia.land/lua-gato-sol-rio-123456789",
    delete_url: "https://4words.aletheia.land/d/" + "a".repeat(128),
    admin_key: "private",
    message: "Chave fwllm_abcdef1234",
  };
  expect(resultJson(result, false, "en")).not.toContain("private");
  expect(resultJson(result, false, "en")).toContain("[hidden]");
  expect(resultJson(result, false, "ptbr")).toContain("[oculto]");
  expect(resultJson(result, false, "en")).not.toContain("fwllm_");
  expect(resultJson(result, false, "en")).not.toContain("/d/" + "a".repeat(128));
  expect(resultJson(result, true, "en")).toContain("private");
  expect(publicLink(result)).toBe(result.url);
  expect(publicLink({ url: `${result.url}#key=AbCdEf0123456789_-` })).toBe(`${result.url}#key=AbCdEf0123456789_-`);
  expect(publicLink({ url: "https://fourwords.example/d/" + "a".repeat(128) })).toBeUndefined();
  expect(deleteLink(result)).toBe(result.delete_url);
  expect(textSafe("x\x1b[32m\u202e")).toBe("x\ufffd[32m\ufffd");
});

test("4w sem TTY imprime ajuda em inglês por padrão e lembra idioma salvo via 4w lang", async () => {
  const dir = await mkdtemp(join(tmpdir(), "4w-cli-lang-"));
  const configFile = join(dir, "config.json");
  try {
    const baseEnv = { ...process.env, FOURWORDS_CONFIG_FILE: configFile };
    delete baseEnv.FOURWORDS_LANG;

    // 1. Default without config is English (en)
    const p1 = Bun.spawn([process.execPath, cli], { env: baseEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code1, stdout1] = await Promise.all([p1.exited, p1.stdout.text()]);
    expect(code1).toBe(0);
    expect(stdout1).toContain("Open the interactive panel");
    expect(stdout1).not.toContain("\x1b");

    // 2. Change and save language to ptbr via `4w lang ptbr`
    const p2 = Bun.spawn([process.execPath, cli, "lang", "ptbr"], { env: baseEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code2, stdout2] = await Promise.all([p2.exited, p2.stdout.text()]);
    expect(code2).toBe(0);
    expect(JSON.parse(stdout2)).toMatchObject({ ok: true, lang: "ptbr", saved: true });

    // 3. Subsequent invocation without FOURWORDS_LANG remembers ptbr from config.json
    const p3 = Bun.spawn([process.execPath, cli], { env: baseEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code3, stdout3] = await Promise.all([p3.exited, p3.stdout.text()]);
    expect(code3).toBe(0);
    expect(stdout3).toContain("Abre o painel interativo");

    // 4. Change and save language to es via `4w lang es`
    const p4 = Bun.spawn([process.execPath, cli, "lang", "es"], { env: baseEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code4, stdout4] = await Promise.all([p4.exited, p4.stdout.text()]);
    expect(code4).toBe(0);
    expect(JSON.parse(stdout4)).toMatchObject({ ok: true, lang: "es", saved: true });

    // 5. Subsequent invocation remembers es from config.json
    const p5 = Bun.spawn([process.execPath, cli], { env: baseEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [code5, stdout5] = await Promise.all([p5.exited, p5.stdout.text()]);
    expect(code5).toBe(0);
    expect(stdout5).toContain("Abre el panel interactivo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== "linux" || !Bun.which("python3"))(
  "painel real no PTY navega, publica, consulta o MCP e restaura o terminal",
  async () => {
    const calls: Record<string, unknown>[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const call = await request.json();
        const { id, method, params } = call;
        const response = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
        if (method === "initialize") return response({ protocolVersion: "2025-03-26" });
        if (method === "notifications/initialized") return new Response(null, { status: 202 });
        if (method === "tools/list") return response({
          tools: [{ name: "check", title: "Estado", description: "Consulta o estado.", inputSchema: { type: "object" } }],
        });
        calls.push(params);
        if (params.name === "chat_get_doc") return response({ structuredContent: { content: "# Original", updated_at: 17 } });
        if (params.name === "chat_save_doc") return response({ structuredContent: { saved: true } });
        return response({ structuredContent: params.name === "upload_text" ? {
          url: "https://4words.aletheia.land/lua-gato-sol-rio-123456789", admin_key: "fwadm_00000000",
        } : { ready: true } });
      },
    });
    try {
      const command = process.env.FOURWORDS_TEST_BIN ? [process.env.FOURWORDS_TEST_BIN] : [process.execPath, cli];
      const p = Bun.spawn(["python3", terminalSession, ...command], {
        env: { ...process.env, FOURWORDS_MCP_URL: server.url.href, FOURWORDS_NO_HISTORY: "1", FOURWORDS_LANG: "ptbr" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([p.exited, p.stderr.text()]);
      if (code !== 0) throw new Error(stderr);
      expect(calls).toEqual([
        { name: "upload_text", arguments: { content: "Olá 🌊\n# Markdown", burn: true } },
        { name: "check", arguments: {} },
        { name: "chat_get_doc", arguments: { url: "lua-gato-sol-rio-123456789" } },
        { name: "chat_save_doc", arguments: {
          url: "lua-gato-sol-rio-123456789", content: "# Original\n## Novo", base_updated_at: 17,
        } },
      ]);
    } finally {
      server.stop(true);
    }
  }, 60_000,
);
