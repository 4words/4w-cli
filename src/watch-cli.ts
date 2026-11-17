/** `4w room watch ROOM`: live panel in a TTY, one JSON object per line otherwise. */

import { parseArgs } from "node:util";
import { execute } from "./commands";
import { resolveLang } from "./help";
import { textSafe } from "./tui-model";
import { watchRoom, type WatchEvent } from "./watch";
import { openWatch } from "./watch-tui";

function tr(en: string, ptbr: string, es: string): string {
  const lang = resolveLang();
  return lang === "ptbr" ? ptbr : lang === "es" ? es : en;
}

function nonNegative(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(tr(`${flag} requires a non-negative integer.`, `${flag} requer um inteiro não negativo.`, `${flag} requiere un entero no negativo.`));
  }
  return Number(raw);
}

/** JSON-escapes control characters already; also neutralize C1 and bidi overrides that a consumer might print. */
function jsonLine(event: WatchEvent): string {
  return JSON.stringify(event, (_key, value: unknown) => typeof value === "string" ? textSafe(value) : value);
}

export async function runWatch(rawArgs: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rawArgs,
    allowPositionals: true,
    options: {
      nick: { type: "string" },
      "llm-key": { type: "string" },
      "llm-name": { type: "string" },
      "key-file": { type: "string" },
      "from-history": { type: "boolean" },
      since: { type: "string" },
      mouse: { type: "boolean" },
      jsonl: { type: "boolean" },
    },
  });
  if (positionals.length !== 1) {
    throw new Error(`${tr("Usage", "Uso", "Uso")}: 4w room watch ROOM [--nick NICK] [--llm-key KEY | --key-file FILE | --from-history] [--llm-name NAME] [--since N] [--mouse] [--jsonl]`);
  }
  const room = positionals[0];
  const since = nonNegative(values.since, "--since");
  const authArgs: string[] = [];
  if (values["llm-key"] !== undefined) authArgs.push("--llm-key", values["llm-key"]);
  if (values["llm-name"] !== undefined) authArgs.push("--llm-name", values["llm-name"]);
  if (values["key-file"] !== undefined) authArgs.push("--key-file", values["key-file"]);
  if (values["from-history"]) authArgs.push("--from-history");
  const nickArgs = values.nick !== undefined ? ["--nick", values.nick] : [];

  const interactive = !values.jsonl && process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb";
  if (interactive) {
    return openWatch(execute, room, { authArgs, nickArgs, since, mouse: values.mouse });
  }

  // Script/agent mode: stream events as JSON lines until SIGINT/SIGTERM or the room ends.
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  process.stdout.on("error", stop); // EPIPE when the reader (e.g. `head`) goes away.
  let ended: string | undefined;
  await watchRoom(execute, room, { authArgs, nickArgs, since }, (event) => {
    if (event.kind === "ended") ended = event.reason;
    if (!controller.signal.aborted) process.stdout.write(jsonLine(event) + "\n");
  }, controller.signal);
  if (ended !== undefined) process.exitCode = 1;
}
