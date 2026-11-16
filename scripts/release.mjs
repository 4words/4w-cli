import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const version = readFileSync(new URL("src/help.ts", root), "utf8")
  .match(/^export const VERSION = "(\d+\.\d+\.\d+)";$/m)?.[1];
if (!version) throw new Error("Define a semantic version in src/help.ts.");

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/cli.ts", root))],
  target: "bun",
  format: "esm",
  minify: false,
  sourcemap: "none",
});
if (!result.success || result.outputs.length !== 1) throw new Error("Could not generate a single release bundle.");
const cli = Buffer.from(await result.outputs[0].arrayBuffer());
const sha = createHash("sha256").update(cli).digest("hex");
const release = new URL(`releases/${version}/`, root);
mkdirSync(release, { recursive: true });
const artifact = new URL("cli.ts", release);
if (existsSync(artifact) && !readFileSync(artifact).equals(cli)) {
  throw new Error(`Version ${version} was already generated with different content. Increment VERSION.`);
}
writeFileSync(artifact, cli);
const signingKey = process.env.FOURWORDS_SIGNING_KEY;
if (!signingKey) {
  throw new Error("Set FOURWORDS_SIGNING_KEY to the release signing key file (see scripts/keygen.mjs). Releases are never published unsigned.");
}
const { signFiles } = await import("./sign.mjs");
const installers = [];
for (const name of ["install.sh", "install.ps1"]) {
  const template = readFileSync(new URL(`scripts/${name}.in`, root), "utf8");
  const content = template.replaceAll("@VERSION@", version).replace("@SOURCE_SHA@", sha);
  const path = fileURLToPath(new URL(name, root));
  writeFileSync(path, (name.endsWith(".ps1") ? "\uFEFF" : "") + content);
  installers.push(path);
}
signFiles(installers, signingKey);
console.log(`4w ${version}\nSHA-256 cli.ts: ${sha}\nOutputs: install.sh(.minisig), install.ps1(.minisig), and releases/${version}/cli.ts`);
console.log(`Publish: commit, then tag v${version} and push the tag — 4w update downloads installers from the tag.`);
