import { execute } from "./commands";
import { compareSemver, help, helpTopic, normalizeLang, readConfig, resolveLang, saveLang, updateConfig, VERSION } from "./help";
import { openTui } from "./tui";

async function checkUpdateNotice(): Promise<void> {
  if (process.env.FOURWORDS_NO_UPDATE_CHECK === "1") return;
  if (process.env.CI || process.env.NODE_ENV === "test" || process.env.BUN_TEST) return;
  if (!process.stderr.isTTY && !process.stdin.isTTY) return;

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const cfg = readConfig();
  const lastCheck = typeof cfg.last_update_check === "number" ? cfg.last_update_check : 0;
  const cachedLatest = typeof cfg.cached_latest_version === "string" ? cfg.cached_latest_version : undefined;

  if (cachedLatest && compareSemver(cachedLatest, VERSION) > 0) {
    const lang = resolveLang();
    const notice = lang === "ptbr"
      ? `\x1b[33m[4w aviso] Nova versão disponível (${VERSION} -> ${cachedLatest}). Execute '4w update' para atualizar.\x1b[0m\n`
      : lang === "es"
      ? `\x1b[33m[4w aviso] Nueva versión disponible (${VERSION} -> ${cachedLatest}). Ejecute '4w update' para actualizar.\x1b[0m\n`
      : `\x1b[33m[4w notice] A new version is available (${VERSION} -> ${cachedLatest}). Run '4w update' to update.\x1b[0m\n`;
    process.stderr.write(notice);
  }

  if (now - lastCheck > ONE_DAY_MS) {
    try {
      const updateUrl = process.env.FOURWORDS_UPDATE_URL ||
        "https://raw.githubusercontent.com/4words/4w-cli/main/package.json";
      const res = await fetch(updateUrl, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = (await res.json()) as { version?: string };
        if (data?.version && typeof data.version === "string") {
          updateConfig({ last_update_check: now, cached_latest_version: data.version });
        }
      }
    } catch {
      // Silently ignore network failures for background check
    }
  }
}

function extractGlobalLang(rawArgs: string[]): string[] {
  const dashDash = rawArgs.indexOf("--");
  const head = dashDash < 0 ? rawArgs : rawArgs.slice(0, dashDash);
  const tail = dashDash < 0 ? [] : rawArgs.slice(dashDash);
  const filtered: string[] = [];
  for (let i = 0; i < head.length; i++) {
    const token = head[i];
    if (token === "--lang") {
      const value = head[i + 1];
      const lang = normalizeLang(value);
      if (!lang) throw new Error(`Invalid language / Idioma inválido: ${value ?? ""}. Use: en, ptbr, es.`);
      try { saveLang(lang); } catch { /* Ignore read-only disk. */ }
      process.env.FOURWORDS_LANG = lang;
      i++;
      continue;
    }
    if (token.startsWith("--lang=")) {
      const value = token.slice("--lang=".length);
      const lang = normalizeLang(value);
      if (!lang) throw new Error(`Invalid language / Idioma inválido: ${value}. Use: en, ptbr, es.`);
      try { saveLang(lang); } catch { /* Ignore read-only disk. */ }
      process.env.FOURWORDS_LANG = lang;
      continue;
    }
    filtered.push(token);
  }
  return [...filtered, ...tail];
}

async function main(rawArgs: string[]) {
  const args = extractGlobalLang(rawArgs);
  const topic = helpTopic(args);
  if (topic !== undefined) return console.log(help(topic));
  if (args[0] === "--version" || args[0] === "version") return console.log(`4w ${VERSION}`);
  if (args[0] === "--self-test") {
    if (new TextDecoder().decode(new TextEncoder().encode("4Words ✓")) !== "4Words ✓") throw new Error("Self-test failed.");
    return console.log(`4w ${VERSION} OK`);
  }
  if (args[0] !== "update") void checkUpdateNotice();
  if (!args.length || (args.length === 1 && args[0] === "tui")) {
    if (process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== "dumb") {
      return openTui(execute);
    }
    if (args.length) {
      const lang = resolveLang();
      if (lang === "en") throw new Error("The interactive panel requires a TTY terminal. Use 4w --help for commands.");
      if (lang === "es") throw new Error("El panel necesita una terminal interactiva. Use 4w --help para ver los comandos.");
      throw new Error("O painel precisa de um terminal interativo. Use 4w --help para os comandos.");
    }
    return console.log(help());
  }
  const result = await execute(args);
  if (result && typeof result === "object" && "__raw" in result && (result as { __raw?: unknown }).__raw !== undefined) {
    const raw = (result as { __raw: string | Buffer }).__raw;
    process.stdout.write(raw);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`4w: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
