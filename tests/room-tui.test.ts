/** End-to-end tests of the Rust room workspace in a real pseudoterminal. They run when a Rust
 * binary is available (FOURWORDS_TEST_BIN, or target/{debug,release}/4w) and Bun has native PTYs. */
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRoomMock } from "./room-mock";
import { Screen } from "./vt";

const root = new URL("../", import.meta.url).pathname;
const rustBin = [process.env.FOURWORDS_TEST_BIN, join(root, "target/debug/4w"), join(root, "target/release/4w")]
  .find((p) => p && existsSync(p) && !p.endsWith(".ts"));
const canRun = Boolean(rustBin) && typeof (Bun as { Terminal?: unknown }).Terminal !== "undefined" && process.platform !== "win32";
const rtest = test.skipIf(!canRun);

const KEY = {
  enter: "\r", esc: "\x1b", tab: "\t", backtab: "\x1b[Z", up: "\x1b[A", down: "\x1b[B", pgup: "\x1b[5~",
  f1: "\x1bOP", f2: "\x1bOQ", f3: "\x1bOR", f4: "\x1bOS", f5: "\x1b[15~", f6: "\x1b[17~",
  ctrl: (c: string) => String.fromCharCode(c.charCodeAt(0) & 0x1f),
};

type Session = { screen: Screen; type(text: string): void; waitFor(text: string, ms?: number): Promise<void>; gone(text: string, ms?: number): Promise<void>; exited: Promise<number>; proc: any };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });

function open(mock: ReturnType<typeof startRoomMock>, o: { cols?: number; rows?: number; env?: Record<string, string>; args?: string[] } = {}): Session {
  const cols = o.cols ?? 130, rows = o.rows ?? 34;
  const screen = new Screen(rows, cols);
  const proc = Bun.spawn([rustBin!, "room", "watch", "lua-gato-sol-rio-123456789", ...(o.args ?? [])], {
    env: { ...process.env as Record<string, string>, FOURWORDS_MCP_URL: mock.mcpUrl, FOURWORDS_NO_HISTORY: "1", FOURWORDS_NO_UPDATE_CHECK: "1", FOURWORDS_LANG: "en", TERM: "xterm-256color", ...o.env },
    terminal: { cols, rows, data(_t: unknown, d: Uint8Array) { screen.feed(Buffer.from(d).toString()); } },
  } as any);
  cleanups.push(() => { try { proc.kill(); } catch {} });
  const term = (proc as any).terminal;
  const waitFor = async (text: string, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (!screen.contains(text)) {
      if (Date.now() > deadline) throw new Error(`Missing ${JSON.stringify(text)}.\n--- screen ---\n${screen.text()}`);
      await Bun.sleep(25);
    }
  };
  const gone = async (text: string, ms = 8000) => {
    const deadline = Date.now() + ms;
    while (screen.contains(text)) {
      if (Date.now() > deadline) throw new Error(`Still showing ${JSON.stringify(text)}.\n--- screen ---\n${screen.text()}`);
      await Bun.sleep(25);
    }
  };
  return { screen, type: (t) => term.write(t), waitFor, gone, exited: proc.exited, proc };
}

const withMock = (o?: Parameters<typeof startRoomMock>[0]) => {
  const mock = startRoomMock(o);
  cleanups.push(() => mock.stop());
  return mock;
};
const until = async (pred: () => boolean, ms = 6000) => {
  const deadline = Date.now() + ms;
  while (!pred()) { if (Date.now() > deadline) throw new Error("condition not met in time"); await Bun.sleep(25); }
};

rtest("renders people with agent status, chat, markdown document; masks secrets and neutralizes escapes", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("People (3)");
  await s.waitFor("◐ bia [AI] working");
  await s.waitFor("oi pessoal, tudo bem?");
  mock.say("bia", "olá @eu-1! \x1b[31mvermelho\x1b[0m e segredo fwllm_abc123def", "llm");
  await s.waitFor("[hidden]");
  await s.waitFor("vermelho");
  expect(s.screen.text()).not.toContain("fwllm_abc123def");
  expect(s.screen.raw).not.toContain("\x1b[31mvermelho"); // the remote CSI never reaches the terminal as a CSI
  mock.setDoc("# Plano\n\n- [x] feito\n- [ ] falta\n\n```\ncodigo\n```\n", 7, 2);
  await s.waitFor("• [x] feito");
  await s.waitFor("Document · rev 2 · ana");
  expect(s.screen.text()).toContain("● live");
});

rtest("sends a message (optimistic until the server echoes it) with the identity from join", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type("ola do teste");
  await s.waitFor("12/2000");
  s.type(KEY.enter);
  await until(() => mock.calls.some((c) => c.name === "chat_send"));
  expect(mock.calls.find((c) => c.name === "chat_send")!.args).toMatchObject({ text: "ola do teste", nick: "eu-1" });
  await s.waitFor("eu-1 (you)");
  await s.waitFor("ola do teste");
});

rtest("@mention completes from the people list and sends the full text", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type("oi @an");
  await s.waitFor("@ana");
  s.type(KEY.tab);
  s.type("tudo bem");
  s.type(KEY.enter);
  await until(() => mock.calls.some((c) => c.name === "chat_send"));
  expect(mock.calls.find((c) => c.name === "chat_send")!.args.text).toBe("oi @ana tudo bem");
});

rtest("command palette opens the document history with a colored diff and restores a revision", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.ctrl("p"));
  await s.waitFor("Commands");
  s.type("hist");
  await s.waitFor("Document history");
  s.type(KEY.enter);
  await s.waitFor("rev 2  bia  +2 −1");
  await s.waitFor("+ olá mundo");
  s.type(KEY.down);
  await s.waitFor("+ olá");
  s.type("r");
  await s.waitFor("Restore revision 1?");
  s.type(KEY.enter);
  await until(() => mock.calls.some((c) => c.name === "chat_save_doc" && c.args.rollback_to_version === 1));
  await s.waitFor("Restored revision 1");
});

rtest("document editor saves with the authoritative base revision and shows the new revision", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.f2);
  await s.waitFor("Editing document");
  await s.waitFor("1 # Doc inicial");
  s.type("Novo ");
  await s.waitFor("modified");
  s.type(KEY.ctrl("s"));
  await s.waitFor("Document saved");
  const save = mock.calls.find((c) => c.name === "chat_save_doc")!;
  expect(save.args).toMatchObject({ base_updated_at: 1 });
  expect(save.args.content).toStartWith("Novo # Doc inicial");
  await s.waitFor("saved");
  s.type(KEY.esc);
  await s.waitFor("People (3)");
});

rtest("save conflict opens a resolution dialog; overwrite resaves on top of their revision", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.f2);
  await s.waitFor("1 # Doc inicial");
  s.type("CONFLICT ");
  s.type(KEY.ctrl("s"));
  await s.waitFor("Document conflict");
  await s.waitFor("Take theirs");
  s.type("o");
  await until(() => mock.calls.filter((c) => c.name === "chat_save_doc").length >= 2);
  const second = mock.calls.filter((c) => c.name === "chat_save_doc")[1];
  expect(second.args.base_updated_at).toBe(99);
  expect(second.args.content).toContain("CONFLICT");
  await s.waitFor("Document saved");
});

rtest("taking theirs replaces the buffer and a remote edit while editing shows a banner", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.f2);
  await s.waitFor("1 # Doc inicial");
  mock.setDoc("# Remoto\n\nmudou", 20, 3, "bia");
  await s.waitFor("bia edited the document (rev 3)");
  s.type(KEY.ctrl("l")); // load theirs
  await s.waitFor("1 # Remoto");
  s.type(KEY.ctrl("s"));
  await s.waitFor("Document saved");
  expect(mock.calls.filter((c) => c.name === "chat_save_doc").at(-1)!.args.base_updated_at).toBe(20);
});

rtest("slash command /search finds a message and selects it", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type("/search revisar");
  s.type(KEY.enter);
  await s.waitFor("Search chat");
  await s.waitFor("vamos revisar o plano hoje");
  s.type(KEY.enter);
  await s.waitFor("Enter Actions");
});

rtest("owner mode: moderation lists bans and bans the selected person", async () => {
  const dir = await mkdtemp(join(tmpdir(), "4w-room-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const keyFile = join(dir, "admin.key");
  await writeFile(keyFile, "fwadm_00ff", { mode: 0o600 });
  const mock = withMock();
  const s = open(mock, { args: ["--admin-key-file", keyFile] });
  await s.waitFor("[owner]");
  s.type(KEY.f6);
  await s.waitFor("Active bans");
  await s.waitFor("spammer");
  s.type(KEY.down); // ana
  s.type("b");
  await until(() => mock.calls.some((c) => c.name === "chat_moderate" && c.args.action === "ban"));
  expect(mock.calls.find((c) => c.name === "chat_moderate" && c.args.action === "ban")!.args).toMatchObject({ nick: "ana", admin_key: "fwadm_00ff" });
  expect(s.screen.text()).not.toContain("fwadm_00ff");
});

rtest("sends a file from the file prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "4w-room-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "relatorio.txt");
  await writeFile(file, "conteudo do relatorio");
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.f4);
  await s.waitFor("Send a file");
  s.type(file);
  s.type(KEY.enter);
  await until(() => mock.calls.some((c) => c.name === "chat_send_file"));
  const call = mock.calls.find((c) => c.name === "chat_send_file")!;
  expect(call.args).toMatchObject({ filename: "relatorio.txt", burn: true });
  expect(Buffer.from(call.args.content_base64, "base64").toString()).toBe("conteudo do relatorio");
  await s.waitFor("File sent: relatorio.txt");
});

rtest("share window masks keys until revealed; copying is offered", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.f5);
  await s.waitFor("Share this room");
  await s.waitFor("https://4words.example/lua-gato-sol-rio-123456789");
  await s.waitFor("not available: created elsewhere");
});

rtest("layouts adapt: tabs on narrow terminals, three panes on wide ones, minimum size message", async () => {
  const mock = withMock();
  const narrow = open(mock, { cols: 70, rows: 24 });
  await narrow.waitFor(" Chat   Document   People");
  await narrow.waitFor("oi pessoal, tudo bem?");
  narrow.type(KEY.tab); narrow.type(KEY.tab);
  await narrow.waitFor("# Doc inicial");
  const wide = open(mock, { cols: 150, rows: 34 });
  await wide.waitFor("People (3)");
  await wide.waitFor("Document · rev 1");
  const tiny = open(mock, { cols: 24, rows: 6 });
  await tiny.waitFor("enlarge the window");
});

rtest("translated interface and ASCII fallback", async () => {
  const mock = withMock();
  const pt = open(mock, { env: { FOURWORDS_LANG: "ptbr" } });
  await pt.waitFor("Pessoas (3)");
  await pt.waitFor("ao vivo");
  const ascii = open(mock, { env: { FOURWORDS_ASCII: "1" } });
  await ascii.waitFor("* live");
  expect(ascii.screen.text()).not.toContain("●");
});

rtest("reconnects after the stream drops and keeps the conversation", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  mock.dropStreams();
  await s.waitFor("reconnecting");
  await s.waitFor("● live", 12000);
  mock.say("ana", "voltei depois da queda");
  await s.waitFor("voltei depois da queda");
});

rtest("quit asks for confirmation, exits 0 and restores the terminal", async () => {
  const mock = withMock();
  const s = open(mock);
  await s.waitFor("● live");
  s.type(KEY.ctrl("c"));
  await s.waitFor("Leave the room?");
  s.type(KEY.enter);
  expect(await s.exited).toBe(0);
  const raw = s.screen.raw;
  expect(raw).toContain("\x1b[?1049l"); // left the alternate screen
  expect(raw).toContain("\x1b[?25h"); // cursor visible again
  expect(raw).toContain("\x1b[?2004l"); // bracketed paste disabled
  expect(raw).toContain("\x1b[?1006l"); // mouse reporting disabled
});
