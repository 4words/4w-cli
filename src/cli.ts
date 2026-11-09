import { execute } from "./commands";
import { help, helpTopic, normalizeLang, resolveLang, saveLang, VERSION } from "./help";
import { openTui } from "./tui";

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
