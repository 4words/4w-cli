// Exports the trilingual help text (general + every topic) from the TypeScript
// implementation into crates/fw-core/data/help.json so the Rust port stays
// byte-for-byte identical. Run: bun scripts/export-help.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { help, VERSION } from "../src/help.ts";
import * as mod from "../src/help.ts";

const topics = Object.keys(
  // topicsPt is not exported; discover topics through the Topic table by probing help().
  Object.fromEntries([]),
);
const out = {};
const names = new Set();
// The table keys are discoverable from the general help of each language: probe known
// command words and their sub-actions instead of reflecting private tables.
const probe = [
  "tui", "lang", "update", "text", "file", "get", "delete", "history", "doctor",
  "room", "mcp", "help",
  "room create", "room join", "room send", "room send-file", "room messages", "room doc",
  "room save", "room wait", "room watch", "room participants", "room nick",
  "room register-llm", "room moderate", "mcp list", "mcp call",
];
for (const lang of ["en", "ptbr", "es"]) {
  out[lang] = { general: help("", lang).replaceAll(VERSION, "{version}"), topics: {} };
  for (const t of probe) {
    try { out[lang].topics[t] = help(t, lang).replaceAll(VERSION, "{version}"); names.add(t); }
    catch { /* not a topic */ }
  }
}
writeFileSync(fileURLToPath(new URL("../crates/fw-core/data/help.json", import.meta.url)), JSON.stringify(out, null, 1) + "\n");
console.log("topics:", [...names].join(", "));
