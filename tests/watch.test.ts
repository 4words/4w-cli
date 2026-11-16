import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cliCommand, isTypeScript } from "./bin";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;

type Call = { name: string; arguments: Record<string, unknown> };

/** Scripted MCP server: `waits` supplies one response per chat_wait_events call;
 * a number means "reply with that HTTP status", an object is the structuredContent. */
function mockRoom(waits: (Record<string, unknown> | number)[], hangAfter = true) {
  const calls: Call[] = [];
  let waitIndex = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const call = await request.json();
      const { id, method, params } = call;
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
      if (method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26" } },
          { headers: { "Mcp-Session-Id": "s" } });
      }
      if (method === "notifications/initialized") return new Response(null, { status: 202 });
      calls.push({ name: params.name, arguments: params.arguments });
      if (params.name === "chat_join") {
        return reply({ structuredContent: {
          nick: "eu-1", fourwords_url: "https://4words.example/lua-gato-sol-rio-123456789", last_seq: 1,
          participants: [{ nick: "eu-1", role: "human" }],
          markdown: { content: "# Doc", updatedAt: 0, version: 0 },
        } });
      }
      if (params.name === "chat_messages") {
        return reply({ structuredContent: {
          messages: [{ seq: 1, nick: "ana", ts: 1_700_000_000_000, role: "human", text: "oi" }], last_seq: 1,
        } });
      }
      if (params.name === "chat_send") return reply({ structuredContent: { sent: true, seq: 99, last_seq: 99 } });
      if (params.name === "chat_wait_events") {
        const next = waits[waitIndex++];
        if (typeof next === "number") return new Response("boom", { status: next });
        if (next) return reply({ structuredContent: next });
        // Script exhausted: behave like a real long-poll that just times out slowly.
        if (hangAfter) await Bun.sleep(300);
        return reply({ structuredContent: { messages: [], last_seq: 0, timed_out: true } });
      }
      return reply({ structuredContent: { ok: true } });
    },
  });
  return { server, calls };
}

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function startWatch(server: ReturnType<typeof Bun.serve>, extra: string[] = [], env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "4w-watch-test-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const proc = Bun.spawn([...cliCommand, "room", "watch", "lua-gato-sol-rio-123456789", "--jsonl", ...extra], {
    env: {
      ...process.env as Record<string, string>,
      FOURWORDS_MCP_URL: server.url.href,
      FOURWORDS_NO_HISTORY: "1",
      FOURWORDS_NO_UPDATE_CHECK: "1",
      FOURWORDS_CONFIG_FILE: join(dir, "config.json"),
      FOURWORDS_LANG: "en",
      ...env,
    },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  cleanup.push(() => { proc.kill(); });
  const events: Record<string, any>[] = [];
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const waiters: (() => void)[] = [];
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const text = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (text.trim()) events.push(JSON.parse(text));
      }
      waiters.splice(0).forEach((resolve) => resolve());
    }
    waiters.splice(0).forEach((resolve) => resolve());
  })();
  const until = async (predicate: () => boolean, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timeout; events so far: ${JSON.stringify(events)}`);
      await Promise.race([new Promise<void>((resolve) => waiters.push(resolve)), Bun.sleep(50)]);
    }
  };
  return { proc, events, until, pump };
}

test("room watch --jsonl avança o cursor, re-consulta no timeout, reconecta após erro e deduplica", async () => {
  const { server, calls } = mockRoom([
    { messages: [{ seq: 2, nick: "bia", ts: 1_700_000_060_000, role: "llm", text: "azul \x1b[31mverm\x1b]0;x\x07 ‮" }], last_seq: 2,
      participants: [{ nick: "eu-1", role: "human" }, { nick: "bia", role: "llm", model: "claude" }], mentioned_me: true },
    { messages: [], last_seq: 2, timed_out: true },
    500,
    { messages: [
        { seq: 2, nick: "bia", ts: 1_700_000_060_000, role: "llm", text: "duplicada" },
        { seq: 3, nick: "ana", ts: 1_700_000_120_000, role: "human", text: "chave fwllm_abc123 aqui" },
      ], last_seq: 3, doc_updated: true, doc_updated_at: 5,
      markdown: { content: "# Novo", updatedAt: 5, version: 1 } },
  ]);
  cleanup.push(() => { server.stop(true); });

  const watch = await startWatch(server);
  await watch.until(() => watch.events.some((e) => e.kind === "doc" && !e.initial));
  await watch.until(() => calls.filter((c) => c.name === "chat_wait_events").length >= 5);
  watch.proc.kill("SIGTERM");
  const code = await watch.proc.exited;
  await watch.pump;
  expect(code).toBe(0);

  const kinds = watch.events.map((e) => e.kind);
  expect(kinds[0]).toBe("ready");
  expect(watch.events[0]).toMatchObject({ nick: "eu-1", link: "https://4words.example/lua-gato-sol-rio-123456789" });
  expect(watch.events.find((e) => e.kind === "doc")).toMatchObject({ initial: true, content: "# Doc" });

  const seqs = watch.events.filter((e) => e.kind === "messages").flatMap((e) => e.messages.map((m: any) => m.seq));
  expect(seqs).toEqual([1, 2, 3]); // backlog, first wait, deduplicated third wait (seq 2 not repeated)

  const bia = watch.events.filter((e) => e.kind === "messages").flatMap((e) => e.messages).find((m: any) => m.seq === 2);
  expect(bia.text).not.toContain("\x1b");
  expect(bia.text).not.toContain("‮");
  expect(bia.text).toContain("azul");
  expect(watch.events.find((e) => e.kind === "messages" && e.messages[0].seq === 2)?.mentionedMe).toBe(true);

  expect(watch.events.some((e) => e.kind === "status" && e.state === "reconnecting" && e.retryInSeconds === 1)).toBe(true);
  expect(watch.events.some((e) => e.kind === "status" && e.state === "connected")).toBe(true);
  expect(watch.events.find((e) => e.kind === "doc" && !e.initial)).toMatchObject({ updatedAt: 5, version: 1, content: "# Novo" });

  const waits = calls.filter((c) => c.name === "chat_wait_events").map((c) => c.arguments);
  expect(waits.slice(0, 4).map((w) => w.since)).toEqual([1, 2, 2, 2]); // advance, re-poll after timeout, retry after 500
  expect(waits[0]).toMatchObject({ mentions_only: false });
  expect(waits[4]?.since_doc_ts).toBe(5); // doc cursor is sent once known
  expect(waits[4]?.since).toBe(3);
}, 20_000);

test("room watch encaminha chave por arquivo e apelido apenas aos comandos que os aceitam", async () => {
  const { server, calls } = mockRoom([{ messages: [], last_seq: 1, timed_out: true }]);
  cleanup.push(() => { server.stop(true); });
  const dir = await mkdtemp(join(tmpdir(), "4w-watch-key-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const keyPath = join(dir, "llm.key");
  await writeFile(keyPath, "fwllm_doarquivo\n", { mode: 0o600 });

  const watch = await startWatch(server, ["--key-file", keyPath, "--nick", "bot-9", "--llm-name", "claude"]);
  await watch.until(() => calls.some((c) => c.name === "chat_wait_events"));
  watch.proc.kill("SIGTERM");
  expect(await watch.proc.exited).toBe(0);

  const join_ = calls.find((c) => c.name === "chat_join")!.arguments;
  expect(join_).toMatchObject({ llm_key: "fwllm_doarquivo", llm_name: "claude" });
  expect(join_.nick).toBeUndefined();
  const wait = calls.find((c) => c.name === "chat_wait_events")!.arguments;
  expect(wait).toMatchObject({ llm_key: "fwllm_doarquivo", nick: "bot-9" });
});

test("room watch encerra com erro após falhas HTTP 4xx persistentes (sala indisponível)", async () => {
  const { server } = mockRoom([404, 404, 404, 404]);
  cleanup.push(() => { server.stop(true); });
  const watch = await startWatch(server);
  const code = await watch.proc.exited;
  await watch.pump;
  expect(code).toBe(1);
  expect(watch.events.at(-1)).toMatchObject({ kind: "ended" });
}, 20_000);

test("room watch exige exatamente uma sala e valida --since", async () => {
  const { server } = mockRoom([]);
  cleanup.push(() => { server.stop(true); });
  const run = async (...args: string[]) => {
    const p = Bun.spawn([...cliCommand, "room", "watch", ...args], {
      env: { ...process.env as Record<string, string>, FOURWORDS_MCP_URL: server.url.href, FOURWORDS_NO_UPDATE_CHECK: "1", FOURWORDS_NO_HISTORY: "1" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [code, err] = await Promise.all([p.exited, p.stderr.text()]);
    return { code, err };
  };
  const none = await run("--jsonl");
  expect(none.code).toBe(1);
  expect(none.err).toContain("room watch ROOM");
  const bad = await run("sala-1", "--since", "abc", "--jsonl");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("--since");
});

// The menu-style TypeScript panel is specific to the TS implementation; the Rust workspace has its
// own end-to-end suite in tests/room-tui.test.ts.
test.skipIf(!isTypeScript || process.platform === "win32" || typeof (Bun as { Terminal?: unknown }).Terminal === "undefined")(
  "painel room watch em PTY real: recebe, mascara, envia, abre o doc e restaura o terminal",
  async () => {
    const sent: Record<string, unknown>[] = [];
    let waits = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const { id, method, params } = await request.json();
        const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
        if (method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26" } }, { headers: { "Mcp-Session-Id": "s" } });
        }
        if (method === "notifications/initialized") return new Response(null, { status: 202 });
        if (params.name === "chat_join") {
          return reply({ structuredContent: { nick: "eu-1", fourwords_url: "https://4words.example/lua-gato-sol-rio-123456789",
            participants: [{ nick: "eu-1" }, { nick: "bia", role: "llm" }], markdown: { content: "# Doc\nvelho", updatedAt: 0, version: 0 } } });
        }
        if (params.name === "chat_messages") {
          return reply({ structuredContent: { messages: [{ seq: 1, nick: "ana", ts: Date.now(), role: "human", text: "oi pessoal" }], last_seq: 1 } });
        }
        if (params.name === "chat_send") { sent.push(params.arguments); return reply({ structuredContent: { sent: true, seq: 9 } }); }
        if (params.name === "chat_wait_events") {
          if (++waits === 1) {
            return reply({ structuredContent: { messages: [{ seq: 2, nick: "bia", ts: Date.now(), role: "llm", text: "ola \x1b[31mcor\x1b[0m segredo fwllm_abc123def" }], last_seq: 2,
              doc_updated: true, doc_updated_at: 7, markdown: { content: "# Doc\nnovo conteudo", updatedAt: 7, version: 2 } } });
          }
          await Bun.sleep(400);
          return reply({ structuredContent: { messages: [], last_seq: 2, timed_out: true } });
        }
        return reply({ structuredContent: { ok: true } });
      },
    });
    let screen = "";
    const proc = Bun.spawn([...cliCommand, "room", "watch", "lua-gato-sol-rio-123456789"], {
      env: { ...process.env as Record<string, string>, FOURWORDS_MCP_URL: server.url.href, FOURWORDS_NO_HISTORY: "1",
        FOURWORDS_NO_UPDATE_CHECK: "1", FOURWORDS_LANG: "en", TERM: "xterm-256color" },
      terminal: { cols: 100, rows: 28, data(_t: unknown, data: Uint8Array) { screen += Buffer.from(data).toString(); } },
    } as Parameters<typeof Bun.spawn>[1]);
    const waitFor = async (text: string, from = 0, ms = 8000) => {
      const deadline = Date.now() + ms;
      while (!screen.slice(from).includes(text)) {
        if (Date.now() > deadline) throw new Error(`Missing ${JSON.stringify(text)}. Screen tail: ${screen.slice(-1500)}`);
        await Bun.sleep(25);
      }
      return screen.length;
    };
    const term = (proc as unknown as { terminal: { write(data: string): void } }).terminal;
    try {
      await waitFor("oi pessoal");
      await waitFor("[hidden]"); // fwllm_ secret masked in the feed
      expect(screen).not.toContain("fwllm_abc123def");
      expect(screen).not.toContain("\x1b[31mcor"); // remote escape never reaches the terminal as a CSI
      await waitFor("[doc updated");
      term.write("ola do painel");
      await waitFor("ola do painel");
      term.write("\r");
      for (let i = 0; i < 100 && !sent.length; i++) await Bun.sleep(25);
      expect(sent).toEqual([{ url: "lua-gato-sol-rio-123456789", text: "ola do painel" }]);
      term.write("\x04"); // Ctrl+D → shared document
      await waitFor("novo conteudo");
      term.write("\x1b"); // Esc → back to chat
      await waitFor("Enter Send", screen.length - 1); // chat footer is back
      await Bun.sleep(700); // readline waits ~500 ms to tell a lone Esc from an escape sequence
      term.write("\x1b"); // Esc → quit
      const exit = await Promise.race([proc.exited, Bun.sleep(8000).then(() => "hung" as const)]);
      if (exit === "hung") throw new Error(`Panel did not quit on Esc. Screen tail: ${screen.slice(-800)}`);
      expect(exit).toBe(0);
      // Terminal restored: leaves alternate screen, shows cursor, disables bracketed paste.
      expect(screen).toContain("\x1b[?1049l");
      expect(screen).toContain("\x1b[?25h");
      expect(screen).toContain("\x1b[?2004l");
    } finally {
      proc.kill();
      server.stop(true);
    }
  }, 30_000,
);
