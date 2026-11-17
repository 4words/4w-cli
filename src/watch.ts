/** Core loop for `4w room watch`: join → backlog → chat_wait_events long-poll
 * with cursor tracking, immediate re-poll on timeouts, exponential backoff on
 * failures, and typed events for the TUI and JSONL front ends. No UI here. */

export type Execute = (args: string[], signal?: AbortSignal, input?: string) => Promise<unknown>;

export type WatchMessage = { seq: number; nick: string; ts: number; role: string; text: string; file_url?: string };
export type WatchParticipant = { nick: string; role?: string; model?: string; status?: string };

export type WatchEvent =
  | { kind: "ready"; room: string; nick?: string; link?: string }
  | { kind: "messages"; messages: WatchMessage[]; mentionedMe: boolean }
  | { kind: "participants"; participants: WatchParticipant[] }
  | { kind: "doc"; updatedAt: number; version?: number; content?: string; initial?: boolean }
  | { kind: "status"; state: "connected" | "reconnecting"; detail?: string; retryInSeconds?: number }
  | { kind: "ended"; reason: string };

export type WatchOptions = {
  /** LLM identity flags accepted by every room command (--llm-key, --llm-name, --key-file, --from-history). */
  authArgs?: string[];
  /** Flags only some room commands accept (--nick: messages, wait, send; NOT join). */
  nickArgs?: string[];
  /** Message cursor to start from; defaults to 0 (full backlog). */
  since?: number;
};

const MAX_BACKOFF_S = 30;
const PERMANENT_FAILURES = 3;

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function pickMessages(value: unknown): WatchMessage[] {
  if (!Array.isArray(value)) return [];
  const out: WatchMessage[] = [];
  for (const item of value) {
    const msg = asObject(item);
    if (!msg || typeof msg.seq !== "number" || typeof msg.text !== "string") continue;
    out.push({
      seq: msg.seq,
      nick: typeof msg.nick === "string" ? msg.nick : "?",
      ts: typeof msg.ts === "number" ? msg.ts : 0,
      role: typeof msg.role === "string" ? msg.role : "human",
      text: msg.text,
      file_url: typeof msg.file_url === "string" ? msg.file_url : undefined,
    });
  }
  return out;
}

function pickParticipants(value: unknown): WatchParticipant[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WatchParticipant[] = [];
  for (const item of value) {
    const part = asObject(item);
    if (!part || typeof part.nick !== "string") continue;
    out.push({
      nick: part.nick,
      role: typeof part.role === "string" ? part.role : undefined,
      model: typeof part.model === "string" ? part.model : undefined,
      status: typeof part.status === "string" ? part.status : undefined,
    });
  }
  return out;
}

function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, seconds * 1000);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Runs until `signal` aborts or the room becomes permanently unavailable. */
export async function watchRoom(
  execute: Execute,
  room: string,
  options: WatchOptions,
  onEvent: (event: WatchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const auth = options.authArgs ?? [];
  const withNick = [...auth, ...(options.nickArgs ?? [])];
  let lastSeq = options.since ?? 0;
  let docTs = 0;
  let backoff = 0;
  let consecutiveClientErrors = 0;

  // `join` reports the room's current last_seq but carries no messages: advancing the cursor
  // from it would make the backlog fetch below look "already seen" and drop it.
  const absorb = (data: Record<string, unknown>, initialDoc: boolean, advanceCursor = true) => {
    const messages = pickMessages(data.messages).filter((msg) => msg.seq > lastSeq);
    if (advanceCursor && typeof data.last_seq === "number" && data.last_seq > lastSeq) lastSeq = data.last_seq;
    for (const msg of messages) if (msg.seq > lastSeq) lastSeq = msg.seq;
    if (messages.length) onEvent({ kind: "messages", messages, mentionedMe: data.mentioned_me === true });
    const participants = pickParticipants(data.participants);
    if (participants) onEvent({ kind: "participants", participants });
    const markdown = asObject(data.markdown);
    const updatedAt = typeof data.doc_updated_at === "number" && data.doc_updated_at > 0
      ? data.doc_updated_at
      : typeof markdown?.updatedAt === "number" ? markdown.updatedAt : 0;
    if ((data.doc_updated === true || (initialDoc && markdown)) && markdown && updatedAt >= docTs) {
      docTs = updatedAt;
      onEvent({
        kind: "doc",
        updatedAt,
        version: typeof markdown.version === "number" ? markdown.version : undefined,
        content: typeof markdown.content === "string" ? markdown.content : undefined,
        initial: initialDoc || undefined,
      });
    } else if (updatedAt > docTs) docTs = updatedAt;
  };

  // 1. Join once: registers presence and reveals our nick and the room link.
  const joined = asObject(await execute(["room", "join", room, ...auth], signal));
  if (signal.aborted) return;
  if (joined) {
    onEvent({
      kind: "ready",
      room,
      nick: typeof joined.nick === "string" ? joined.nick : undefined,
      link: typeof joined.fourwords_url === "string" ? joined.fourwords_url
        : typeof joined.combo === "string" ? joined.combo : undefined,
    });
    absorb(joined, true, false);
  } else onEvent({ kind: "ready", room });

  // 2. Backlog from the requested cursor.
  try {
    const backlog = asObject(await execute(["room", "messages", room, "--since", String(options.since ?? 0), ...withNick], signal));
    if (backlog) absorb(backlog, false);
  } catch {
    // Backlog is cosmetic: the wait loop below still delivers everything new.
  }

  // 3. Long-poll loop.
  while (!signal.aborted) {
    try {
      const args = ["room", "wait", room, "--since", String(lastSeq), "--all", ...withNick];
      if (docTs > 0) args.push("--since-doc", String(docTs));
      const data = asObject(await execute(args, signal));
      if (signal.aborted) return;
      if (backoff > 0) onEvent({ kind: "status", state: "connected" });
      backoff = 0;
      consecutiveClientErrors = 0;
      if (!data) continue;
      absorb(data, false);
      // timed_out → re-poll immediately (long-poll contract).
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP 4\d\d/.test(message)) {
        consecutiveClientErrors++;
        if (consecutiveClientErrors >= PERMANENT_FAILURES) {
          onEvent({ kind: "ended", reason: message });
          return;
        }
      } else consecutiveClientErrors = 0;
      backoff = backoff === 0 ? 1 : Math.min(backoff * 2, MAX_BACKOFF_S);
      onEvent({ kind: "status", state: "reconnecting", detail: message, retryInSeconds: backoff });
      await sleep(backoff, signal);
    }
  }
}
