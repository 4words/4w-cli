// Builds/collects the release binaries, fills the installer templates with their SHA-256 and signs the
// installers (minisign-compatible; the private key stays offline: FOURWORDS_SIGNING_KEY is required).
//
//   bun scripts/release.mjs
//
// Binaries live in dist/<version>/4w-<target>[.exe]. Linux targets are built here with cargo-zigbuild;
// macOS and Windows binaries come from the CI runners (download them into the same directory first).
// FOURWORDS_ALLOW_PARTIAL=1 publishes a release where some platforms have no binary yet: their SHA-256 is
// all zeros and the installer refuses them with a clear message.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));

const cargoVersion = readFileSync(path("Cargo.toml"), "utf8").match(/^version = "(\d+\.\d+\.\d+)"$/m)?.[1];
const helpVersion = readFileSync(path("src/help.ts"), "utf8").match(/^export const VERSION = "(\d+\.\d+\.\d+)";$/m)?.[1];
const pkgVersion = JSON.parse(readFileSync(path("package.json"), "utf8")).version;
if (!cargoVersion) throw new Error("Define [workspace.package] version in Cargo.toml.");
if (cargoVersion !== helpVersion || cargoVersion !== pkgVersion) {
  throw new Error(`Versions differ: Cargo.toml ${cargoVersion}, src/help.ts ${helpVersion}, package.json ${pkgVersion}. Older clients read package.json to find updates.`);
}
const version = cargoVersion;

const targets = [
  { key: "LINUX_X64", rust: "x86_64-unknown-linux-musl", asset: "4w-x86_64-unknown-linux-musl", local: true },
  { key: "LINUX_ARM64", rust: "aarch64-unknown-linux-musl", asset: "4w-aarch64-unknown-linux-musl", local: true },
  { key: "DARWIN_X64", rust: "x86_64-apple-darwin", asset: "4w-x86_64-apple-darwin", local: false },
  { key: "DARWIN_ARM64", rust: "aarch64-apple-darwin", asset: "4w-aarch64-apple-darwin", local: false },
  { key: "WINDOWS_X64", rust: "x86_64-pc-windows-msvc", asset: "4w-x86_64-pc-windows-msvc.exe", local: false },
];

const dist = path(`dist/${version}/`);
mkdirSync(dist, { recursive: true });
const env = { ...process.env, RUSTFLAGS: `${process.env.RUSTFLAGS ?? ""} --remap-path-prefix=${path("")}=.`.trim() };

const hashes = {};
for (const t of targets) {
  const out = `${dist}${t.asset}`;
  if (t.local && process.env.FOURWORDS_SKIP_BUILD !== "1") {
    console.log(`Building ${t.rust}...`);
    const r = spawnSync("cargo", ["zigbuild", "--release", "--locked", "-p", "fw-cli", "--target", t.rust], { cwd: path(""), stdio: "inherit", env });
    if (r.status !== 0) throw new Error(`Build failed for ${t.rust}.`);
    copyFileSync(path(`target/${t.rust}/release/4w`), out);
  }
  if (existsSync(out)) {
    hashes[t.key] = createHash("sha256").update(readFileSync(out)).digest("hex");
  } else if (process.env.FOURWORDS_ALLOW_PARTIAL === "1") {
    hashes[t.key] = "0".repeat(64);
    console.log(`  (no binary for ${t.rust}: installer will refuse that platform)`);
  } else {
    throw new Error(`Missing ${out}. Build it on its CI runner, or set FOURWORDS_ALLOW_PARTIAL=1 for a partial release.`);
  }
}
writeFileSync(`${dist}SHA256SUMS`, targets.filter((t) => hashes[t.key] !== "0".repeat(64)).map((t) => `${hashes[t.key]}  ${t.asset}`).join("\n") + "\n");

const signingKey = process.env.FOURWORDS_SIGNING_KEY;
if (!signingKey) {
  throw new Error("Set FOURWORDS_SIGNING_KEY to the release signing key file (see scripts/keygen.mjs). Releases are never published unsigned.");
}
const { signFiles } = await import("./sign.mjs");
const installers = [];
for (const name of ["install.sh", "install.ps1"]) {
  let content = readFileSync(path(`scripts/${name}.in`), "utf8").replaceAll("@VERSION@", version);
  for (const t of targets) content = content.replaceAll(`@SHA_${t.key}@`, hashes[t.key]);
  const file = path(name);
  writeFileSync(file, (name.endsWith(".ps1") ? "﻿" : "") + content);
  installers.push(file);
}
signFiles(installers, signingKey);
console.log(`4w ${version}`);
for (const t of targets) console.log(`  ${t.asset.padEnd(34)} ${hashes[t.key] === "0".repeat(64) ? "(not built)" : hashes[t.key]}`);
console.log(`Outputs: install.sh(.minisig), install.ps1(.minisig), dist/${version}/ (upload the binaries to the v${version} GitHub release).`);
console.log(`Publish: commit, tag v${version}, push the tag. 4w update downloads the installer from that tag.`);
