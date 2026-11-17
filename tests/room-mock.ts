/** Scriptable room server for the TUI end-to-end tests: MCP over HTTP + an SSE event stream. */

export type Call = { name: string; args: Record<string, any> };

export function startRoomMock(opts: { ownerBans?: boolean } = {}) {
  const calls: Call[] = [];
  const enc = new TextEncoder();
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let docVersion = 1;
  let docUpdatedAt = 1;
  let docContent = "# Doc inicial\n\nolá";
  const history = [
    { version: 1, nick: "ana", ts: Date.now() - 900_000, content: "# Doc inicial\n\nolá", additions: 3, deletions: 0 },
    { version: 2, nick: "bia", ts: Date.now() - 300_000, content: "# Doc inicial\n\nolá mundo\nlinha nova", additions: 2, deletions: 1 },
  ];
  let seq = 2;
  const messages: any[] = [
    { seq: 1, nick: "ana", ts: Date.now() - 600_000, role: "human", text: "oi pessoal, tudo bem?" },
    { seq: 2, nick: "ana", ts: Date.now() - 590_000, role: "human", text: "vamos revisar o plano hoje" },
  ];
  const people = () => [
    { nick: "eu-1", role: "human", via: ["sse", "http"] },
    { nick: "bia", role: "llm", via: ["http"], status: "working", statusDetail: "sending_reply" },
    { nick: "ana", role: "human", via: ["http"] },
  ];
  const origin = () => `http://127.0.0.1:${server.port}`;

  const push = (event: string, data: unknown) => {
    for (const c of streams) c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };
  const say = (nick: string, text: string, role = "human") => {
    const m = { seq: ++seq, nick, ts: Date.now(), role, text };
    messages.push(m);
    push("msg", m);
    return m;
  };
  const dropStreams = () => { for (const c of streams) { try { c.close(); } catch {} } streams.clear(); };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/chat/h/events") {
        let ctl!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            ctl = c;
            streams.add(c);
            c.enqueue(enc.encode(`event: ready\ndata: ${JSON.stringify({ nick: url.searchParams.get("nick"), lastSeq: seq, participants: people(), expiresAt: Date.now() + 23 * 3_600_000 })}\n\n`));
          },
          cancel() { streams.delete(ctl); },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      }
      const call = await req.json();
      const { id, method, params } = call;
      const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
      if (method === "initialize") return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26" } }, { headers: { "Mcp-Session-Id": "s" } });
      if (method === "notifications/initialized") return new Response(null, { status: 202 });
      const name = params.name as string;
      const args = params.arguments ?? {};
      calls.push({ name, args });
      const ok = (structuredContent: unknown) => reply({ structuredContent });
      switch (name) {
        case "chat_create":
          return ok({ ok: true, url: "https://4words.example/chat/h", fourwords_url: "https://4words.example/lua-gato-sol-rio-123456789", combo: "lua-gato-sol-rio-123456789", admin_key: "fwadm_testadminkey", llm_key: "fwllm_testllmkey", stream_url: `${origin()}/chat/h/events` });
        case "chat_join":
          return ok({ nick: "eu-1", fourwords_url: "https://4words.example/lua-gato-sol-rio-123456789", stream_url: `${origin()}/chat/h/events`, participants: people().slice(0, 1), markdown: { content: docContent, updatedAt: docUpdatedAt, version: docVersion, history } });
        case "chat_messages":
          return ok({ messages: messages.filter((m) => m.seq > (args.since ?? 0)), last_seq: seq, participants: people() });
        case "chat_send": {
          const m = say(args.nick ?? "eu-1", args.text);
          return ok({ sent: true, seq: m.seq, nick: "eu-1" });
        }
        case "chat_get_doc":
          return ok({ content: docContent, updated_at: docUpdatedAt, version: docVersion, history });
        case "chat_save_doc": {
          if (args.rollback_to_version !== undefined) {
            const old = history.find((h) => h.version === args.rollback_to_version);
            docContent = old?.content ?? docContent; docVersion++; docUpdatedAt += 10;
            return ok({ ok: true, content: docContent, version: docVersion, updated_at: docUpdatedAt, additions: 0, deletions: 1, rollback_from: args.rollback_to_version });
          }
          if (String(args.content).includes("CONFLICT") && args.base_updated_at !== 99) {
            return ok({ ok: false, conflict: true, current_content: "# Versão da ana\n\ntexto dela", current_updated_at: 99 });
          }
          docContent = args.content; docVersion++; docUpdatedAt = (args.base_updated_at ?? 0) + 10;
          return ok({ ok: true, content: docContent, version: docVersion, updated_at: docUpdatedAt, additions: 1, deletions: 0, download_url: args.export_fourwords_link ? "https://4words.example/export-link-aaa-bbb-123456789" : undefined });
        }
        case "chat_moderate":
          return ok({ ok: true, action: args.action, bans: opts.ownerBans === false ? [] : [{ nick: "spammer", id: "ban-1" }] });
        case "chat_send_file":
          return ok({ sent: true, seq: ++seq, file_url: "https://4words.example/arq-aaa-bbb-ccc-123456789" });
        case "chat_roll_nick":
          return ok({ ok: true, nick: "novo-apelido-7" });
        default:
          return ok({ ok: true });
      }
    },
  });

  return {
    get origin() { return origin(); },
    get mcpUrl() { return `${origin()}/mcp`; },
    calls,
    push,
    say,
    dropStreams,
    setDoc(content: string, updatedAt: number, version: number, editor = "ana") {
      docContent = content; docUpdatedAt = updatedAt; docVersion = version;
      push("doc", { content, editor, ts: updatedAt, version, additions: 2, deletions: 1 });
    },
    stop() { dropStreams(); server.stop(true); },
  };
}
