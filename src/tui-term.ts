/** Shared terminal lifecycle for full-screen apps: raw mode, alternate screen,
 * bracketed paste, optional SGR mouse reporting, and guaranteed restoration on
 * SIGINT/SIGTERM/SIGHUP, stdin end/error, exceptions, and process exit. */

export type Key = { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string };

export type TerminalApp = {
  onKey: (text: string, key: Key) => void;
  redraw: () => void;
  stop: () => void;
};

import { emitKeypressEvents } from "node:readline";

export function runTerminalApp(
  create: (done: (error?: Error) => void) => TerminalApp,
  options: { mouse?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    const wasRaw = stdin.isRaw;
    const mouseOn = options.mouse ? "\x1b[?1000h\x1b[?1006h" : "";
    const mouseOff = options.mouse ? "\x1b[?1006l\x1b[?1000l" : "";
    let closed = false;
    const cleanup = (error?: Error) => {
      if (closed) return;
      closed = true;
      app.stop();
      stdin.off("keypress", onKey);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      stdout.off("resize", onResize);
      process.off("SIGINT", onEnd);
      process.off("SIGTERM", onEnd);
      process.off("SIGHUP", onEnd);
      process.off("exit", restore);
      try { restore(); } catch (cause) { error ??= cause as Error; }
      stdin.pause();
      if (error) reject(error);
      else resolve();
    };
    const app = create(cleanup);
    const restore = () => {
      try { stdin.setRawMode(wasRaw); } finally { stdout.write(`${mouseOff}\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l`); }
    };
    const onEnd = () => cleanup();
    const onError = (error: Error) => cleanup(error);
    const onResize = () => app.redraw();
    const onKey = (text: string, key: Key) => {
      try { app.onKey(text, key); } catch (error) { cleanup(error as Error); }
    };
    try {
      emitKeypressEvents(stdin);
      stdin.setRawMode(true);
      stdin.on("keypress", onKey);
      stdin.once("end", onEnd);
      stdin.once("error", onError);
      stdout.on("resize", onResize);
      process.once("SIGINT", onEnd);
      process.once("SIGTERM", onEnd);
      process.once("SIGHUP", onEnd);
      process.once("exit", restore);
      stdout.write(`\x1b[?1049h\x1b[?25l\x1b[?2004h${mouseOn}\x1b[2J`);
      stdin.resume();
      app.redraw();
    } catch (error) {
      cleanup(error as Error);
    }
  });
}
