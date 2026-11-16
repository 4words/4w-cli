/** Live room panel for `4w room watch`: continuous message feed with presence,
 * doc-change markers, a send field, and the same output sanitation rules as
 * the menu TUI (textSafe via wrap/line + maskSecrets unless revealed). */

import { resolveLang, VERSION, type Lang } from "./help";
import { maskSecrets } from "./tui-model";
import { cleanLine, clip, editField, fieldLine, line, paint, width, wrap } from "./tui-screen";
import { runTerminalApp, type Key } from "./tui-term";
import { watchRoom, type Execute, type WatchEvent, type WatchMessage, type WatchParticipant } from "./watch";

type WatchStrings = {
  connecting: string;
  connected: string;
  reconnecting: (seconds: number) => string;
  ended: (reason: string) => string;
  people: (n: number) => string;
  docUpdated: (version?: number) => string;
  mentionTag: string;
  sendFailed: (reason: string) => string;
  newBelow: (n: number) => string;
  footer: string;
  footerDoc: string;
  docTitle: string;
  docEmpty: string;
  clipboardNotice: string;
  resizeWindow: string;
  revealOn: string;
};

const watchByLang: Record<Lang, WatchStrings> = {
  en: {
    connecting: "connecting…",
    connected: "connected",
    reconnecting: (s) => `reconnecting in ${s}s`,
    ended: (reason) => `Room unavailable: ${reason}`,
    people: (n) => `${n} online`,
    docUpdated: (v) => v === undefined ? "[doc updated]" : `[doc updated · rev ${v}]`,
    mentionTag: "@you ",
    sendFailed: (reason) => `Send failed: ${reason}`,
    newBelow: (n) => `↓ ${n} new`,
    footer: "Enter Send   PgUp/PgDn Scroll   Ctrl+D Doc   Ctrl+R Reveal   Ctrl+Y Copy   Esc Quit",
    footerDoc: "↑↓ Scroll   Ctrl+D / Esc Back to chat",
    docTitle: "Shared document",
    docEmpty: "(empty document)",
    clipboardNotice: "Link sent to clipboard. Your terminal may block OSC 52 copy.",
    resizeWindow: "4w · Enlarge terminal window",
    revealOn: "CREDENTIALS VISIBLE",
  },
  ptbr: {
    connecting: "conectando…",
    connected: "conectado",
    reconnecting: (s) => `reconectando em ${s}s`,
    ended: (reason) => `Sala indisponível: ${reason}`,
    people: (n) => `${n} na sala`,
    docUpdated: (v) => v === undefined ? "[doc atualizado]" : `[doc atualizado · rev ${v}]`,
    mentionTag: "@você ",
    sendFailed: (reason) => `Falha ao enviar: ${reason}`,
    newBelow: (n) => `↓ ${n} novas`,
    footer: "Enter Enviar   PgUp/PgDn Rolar   Ctrl+D Doc   Ctrl+R Revelar   Ctrl+Y Copiar   Esc Sair",
    footerDoc: "↑↓ Rolar   Ctrl+D / Esc Voltar ao chat",
    docTitle: "Documento compartilhado",
    docEmpty: "(documento vazio)",
    clipboardNotice: "Link enviado à área de transferência. O terminal pode bloquear a cópia.",
    resizeWindow: "4w · Amplie a janela",
    revealOn: "CREDENCIAIS VISÍVEIS",
  },
  es: {
    connecting: "conectando…",
    connected: "conectado",
    reconnecting: (s) => `reconectando en ${s}s`,
    ended: (reason) => `Sala no disponible: ${reason}`,
    people: (n) => `${n} en línea`,
    docUpdated: (v) => v === undefined ? "[doc actualizado]" : `[doc actualizado · rev ${v}]`,
    mentionTag: "@tú ",
    sendFailed: (reason) => `Error al enviar: ${reason}`,
    newBelow: (n) => `↓ ${n} nuevas`,
    footer: "Enter Enviar   PgUp/PgDn Desplazar   Ctrl+D Doc   Ctrl+R Revelar   Ctrl+Y Copiar   Esc Salir",
    footerDoc: "↑↓ Desplazar   Ctrl+D / Esc Volver al chat",
    docTitle: "Documento compartido",
    docEmpty: "(documento vacío)",
    clipboardNotice: "Enlace enviado al portapapeles. La terminal puede bloquear la copia.",
    resizeWindow: "4w · Amplíe la ventana",
    revealOn: "CREDENCIALES VISIBLES",
  },
};

const MAX_MESSAGES = 2000;
const NICK_TONES = ["accent", "success", "brand", "bright"] as const;

type FeedItem =
  | { kind: "message"; message: WatchMessage; mention: boolean }
  | { kind: "system"; text: string };

function nickTone(nick: string) {
  let hash = 0;
  for (const ch of nick) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return NICK_TONES[hash % NICK_TONES.length];
}

function clock(ts: number): string {
  if (!ts) return "--:--";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export type WatchTuiOptions = {
  authArgs?: string[];
  nickArgs?: string[];
  since?: number;
  mouse?: boolean;
};

class WatchTui {
  private feed: FeedItem[] = [];
  private participants: WatchParticipant[] = [];
  private connState = "";
  private connected = false;
  private endedReason = "";
  private myNick = "";
  private link = "";
  private docContent = "";
  private docVersion: number | undefined;
  private view: "chat" | "doc" = "chat";
  private reveal = false;
  private input = "";
  private cursor = 0;
  private offset = 0;
  private docOffset = 0;
  private unread = 0;
  private notice = "";
  private paste = false;
  private scheduled?: ReturnType<typeof setImmediate>;
  private closed = false;
  private cache?: { width: number; reveal: boolean; count: number; lines: string[] };
  readonly controller = new AbortController();
  private readonly lang: Lang = resolveLang();

  constructor(
    private readonly execute: Execute,
    private readonly room: string,
    private readonly options: WatchTuiOptions,
    private readonly done: (error?: Error) => void,
  ) {}

  private ui(): WatchStrings {
    return watchByLang[this.lang];
  }

  onWatchEvent = (event: WatchEvent) => {
    if (this.closed) return;
    if (event.kind === "ready") {
      this.myNick = event.nick ?? "";
      this.link = event.link ?? this.room;
      this.connState = this.ui().connected;
      this.connected = true;
    } else if (event.kind === "messages") {
      for (const message of event.messages) {
        const mention = event.mentionedMe || (this.myNick !== "" && message.text.includes(`@${this.myNick}`));
        this.feed.push({ kind: "message", message, mention });
      }
      if (this.feed.length > MAX_MESSAGES) this.feed.splice(0, this.feed.length - MAX_MESSAGES);
      if (this.offset > 0) this.unread += event.messages.length;
      this.cache = undefined;
    } else if (event.kind === "participants") {
      this.participants = event.participants;
    } else if (event.kind === "doc") {
      this.docContent = event.content ?? this.docContent;
      this.docVersion = event.version;
      if (!event.initial) {
        this.feed.push({ kind: "system", text: this.ui().docUpdated(event.version) });
        if (this.feed.length > MAX_MESSAGES) this.feed.splice(0, this.feed.length - MAX_MESSAGES);
        this.cache = undefined;
      }
    } else if (event.kind === "status") {
      this.connected = event.state === "connected";
      this.connState = this.connected ? this.ui().connected : this.ui().reconnecting(event.retryInSeconds ?? 0);
    } else if (event.kind === "ended") {
      this.endedReason = this.ui().ended(maskSecrets(event.reason, this.lang));
    }
    this.redraw();
  };

  private send() {
    const text = this.input.trim();
    if (!text) return;
    this.input = "";
    this.cursor = 0;
    this.notice = "";
    const args = ["room", "send", this.room, text, ...(this.options.authArgs ?? []), ...(this.options.nickArgs ?? [])];
    this.execute(args, this.controller.signal).catch((error: unknown) => {
      if (this.closed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.notice = this.ui().sendFailed(maskSecrets(message, this.lang));
      this.redraw();
    });
    this.redraw();
  }

  /** delta 1 scrolls towards older content, -1 towards the newest. */
  private scrollBy(delta: number, page: number) {
    if (this.view === "doc") {
      this.docOffset = Math.max(0, this.docOffset - delta * page);
    } else {
      this.offset = Math.max(0, this.offset + delta * page);
      if (this.offset === 0) this.unread = 0;
    }
    this.redraw();
  }

  onKey = (text = "", key: Key = {}) => {
    if (this.closed) return;
    if (key.name === "paste-start" || key.sequence === "\x1b[200~") { this.paste = true; return; }
    if (key.name === "paste-end" || key.sequence === "\x1b[201~") { this.paste = false; return; }
    if (!this.paste && key.ctrl && key.name === "c") return this.done();
    // SGR mouse wheel (enabled only with --mouse): \x1b[<64;x;yM up, 65 down.
    const wheel = !this.paste && key.sequence?.match(/^\x1b\[<(64|65);\d+;\d+M/);
    if (wheel) return this.scrollBy(wheel[1] === "64" ? 1 : -1, 3);
    if (!this.paste && key.ctrl && key.name === "d") {
      this.view = this.view === "chat" ? "doc" : "chat";
      this.docOffset = 0;
      return this.redraw();
    }
    if (!this.paste && key.name === "escape") {
      if (this.view === "doc") { this.view = "chat"; return this.redraw(); }
      return this.done();
    }
    const page = Math.max(1, (process.stdout.rows ?? 24) - 7);
    if (!this.paste && key.name === "pageup") return this.scrollBy(1, page);
    if (!this.paste && key.name === "pagedown") return this.scrollBy(-1, page);
    if (this.view === "doc") {
      if (!this.paste && (key.name === "up" || key.name === "down")) return this.scrollBy(key.name === "up" ? 1 : -1, 1);
      if (!this.paste && key.ctrl && key.name === "r") { this.reveal = !this.reveal; return this.redraw(); }
      return;
    }
    if (!this.paste && key.name === "home") return this.scrollBy(1, Number.MAX_SAFE_INTEGER);
    if (!this.paste && key.name === "end") return this.scrollBy(-1, Number.MAX_SAFE_INTEGER);
    if (!this.paste && (key.name === "up" || key.name === "down")) return this.scrollBy(key.name === "up" ? 1 : -1, 1);
    if (!this.paste && key.name === "return") return this.send();
    if (!this.paste && key.ctrl && key.name === "r") {
      this.reveal = !this.reveal;
      this.cache = undefined;
      return this.redraw();
    }
    if (!this.paste && key.ctrl && key.name === "y" && this.link) {
      process.stdout.write(`\x1b]52;c;${Buffer.from(this.link).toString("base64")}\x07`);
      this.notice = this.ui().clipboardNotice;
      return this.redraw();
    }
    let inserted = "";
    if (key.name === "return" || key.name === "enter") inserted = " ";
    else if (this.paste && key.name === "tab") inserted = "  ";
    else if (text && !key.ctrl && !key.meta) {
      inserted = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "").replace(/\n/g, " ");
    }
    if (this.input.length + inserted.length <= 4000) {
      const [next, cursor] = editField(this.input, this.cursor, this.paste ? {} : key, inserted);
      this.input = next;
      this.cursor = cursor;
    }
    this.redraw();
  };

  redraw = () => {
    if (this.closed || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      if (this.closed) return;
      try { this.render(); } catch (error) { this.done(error as Error); }
    });
  };

  stop() {
    this.closed = true;
    this.controller.abort();
    if (this.scheduled) clearImmediate(this.scheduled);
  }

  private feedLines(size: number): string[] {
    if (this.cache && this.cache.width === size && this.cache.reveal === this.reveal && this.cache.count === this.feed.length) {
      return this.cache.lines;
    }
    const lines: string[] = [];
    for (const item of this.feed) {
      if (item.kind === "system") {
        lines.push(line(item.text, size, "dim"));
        continue;
      }
      const { message, mention } = item;
      const body = this.reveal ? message.text : maskSecrets(message.text, this.lang);
      const stamp = clock(message.ts);
      const nick = cleanLine(message.role === "llm" ? `${message.nick}*` : message.nick);
      const head = `${stamp} `;
      const indent = " ".repeat(Math.min(10, head.length + 2));
      const avail = Math.max(8, size - head.length);
      const wrapped = wrap((mention ? this.ui().mentionTag : "") + body, avail);
      const nickPaint = paint(clip(nick, Math.max(1, avail - 1)), mention ? "selected" : nickTone(nick));
      lines.push(paint(head, "dim") + nickPaint);
      for (const row of wrapped) lines.push(indent + clip(row, Math.max(1, size - indent.length)));
      if (message.file_url) lines.push(indent + line(this.reveal ? message.file_url : maskSecrets(message.file_url, this.lang), Math.max(1, size - indent.length), "success"));
    }
    this.cache = { width: size, reveal: this.reveal, count: this.feed.length, lines };
    return lines;
  }

  private render() {
    const ui = this.ui();
    const columns = Math.max(2, process.stdout.columns || 80);
    const rows = Math.max(2, process.stdout.rows || 24);
    const size = columns - 1;
    if (columns < 26 || rows < 8) {
      process.stdout.write("\x1b[H\x1b[2K" + line(ui.resizeWindow, size, "accent") + "\x1b[J");
      return;
    }
    const indicator = this.endedReason
      ? paint("✖ ", "error") + paint(clip(this.endedReason, size - 2), "error")
      : (this.connected ? paint("● ", "success") : paint("○ ", "error")) + paint(this.connState || ui.connecting, "dim");
    const headParts = [
      paint(clip(cleanLine(this.link || this.room), Math.max(8, size - 30)), "accent"),
      paint(ui.people(this.participants.length), "dim"),
      this.myNick ? paint(cleanLine(this.myNick), nickTone(this.myNick)) : "",
      paint(`[${this.lang.toUpperCase()}]`, "dim"),
      this.reveal ? paint(ui.revealOn, "error") : "",
    ].filter(Boolean).join("  ");
    const header = [
      clip(`4w ${VERSION}  `, size) + headParts,
      indicator,
      line("─".repeat(size), size, "dim"),
    ];
    const bodyHeight = Math.max(1, rows - header.length - 3);
    let body: string[];
    let footer = ui.footer;
    if (this.view === "doc") {
      const text = this.docContent
        ? (this.reveal ? this.docContent : maskSecrets(this.docContent, this.lang))
        : ui.docEmpty;
      const wrapped = [line(`${ui.docTitle}${this.docVersion !== undefined ? ` · rev ${this.docVersion}` : ""}`, size, "accent"), ...wrap(text, size)];
      this.docOffset = Math.max(0, Math.min(this.docOffset, Math.max(0, wrapped.length - bodyHeight)));
      body = wrapped.slice(this.docOffset, this.docOffset + bodyHeight);
      footer = ui.footerDoc;
    } else {
      const lines = this.feedLines(size);
      const maxOffset = Math.max(0, lines.length - bodyHeight);
      this.offset = Math.max(0, Math.min(this.offset, maxOffset));
      if (this.offset === 0) this.unread = 0;
      const start = Math.max(0, lines.length - bodyHeight - this.offset);
      body = lines.slice(start, start + bodyHeight);
    }
    const noticeText = this.notice
      ? line(this.notice, size, "accent")
      : this.unread > 0 && this.offset > 0
        ? line(this.ui().newBelow(this.unread), size, "selected")
        : line("─".repeat(size), size, "dim");
    const prompt = "› ";
    const inputRow = this.view === "doc"
      ? ""
      : paint(prompt, "accent") + fieldLine(this.input.slice(0, this.cursor), this.input.slice(this.cursor), Math.max(1, size - width(prompt)));
    const frame = [
      ...header,
      ...body,
      ...Array<string>(bodyHeight - body.length).fill(""),
      noticeText,
      inputRow,
      line(footer, size, "dim"),
    ];
    process.stdout.write("\x1b[H" + frame.map((row) => "\x1b[2K" + row).join("\r\n") + "\x1b[J");
  }
}

export function openWatch(execute: Execute, room: string, options: WatchTuiOptions): Promise<void> {
  return runTerminalApp((done) => {
    const app = new WatchTui(execute, room, options, done);
    watchRoom(execute, room, { authArgs: options.authArgs, nickArgs: options.nickArgs, since: options.since }, app.onWatchEvent, app.controller.signal)
      .catch((error: unknown) => done(error instanceof Error ? error : new Error(String(error))));
    return app;
  }, { mouse: options.mouse });
}
