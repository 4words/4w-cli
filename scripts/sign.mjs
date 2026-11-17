// Signs release artifacts with the 4w release key in a minisign-compatible
// format ("ED": Ed25519 over the BLAKE2b-512 digest of the file), verifiable
// with `minisign -Vm FILE -p minisign.pub` and by `4w update` itself.
// Usage: FOURWORDS_SIGNING_KEY=path bun scripts/sign.mjs FILE...
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export function loadSigningKey(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!/^[0-9a-f]{16}$/.test(data.key_id) || typeof data.seed_b64 !== "string") {
    throw new Error(`Invalid signing key file: ${path}`);
  }
  const seed = Buffer.from(data.seed_b64, "base64url");
  if (seed.length !== 32) throw new Error(`Invalid Ed25519 seed in ${path}`);
  return {
    keyId: Buffer.from(data.key_id, "hex"),
    privateKey: createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: "der", type: "pkcs8" }),
  };
}

export function minisignSignature(content, name, { keyId, privateKey }) {
  const digest = createHash("blake2b512").update(content).digest();
  const signature = sign(null, digest, privateKey);
  const sigBlob = Buffer.concat([Buffer.from("ED"), keyId, signature]);
  const trusted = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:${name}\thashed`;
  const globalSig = sign(null, Buffer.concat([signature, Buffer.from(trusted, "utf8")]), privateKey);
  return [
    "untrusted comment: signature from 4w release key",
    sigBlob.toString("base64"),
    `trusted comment: ${trusted}`,
    globalSig.toString("base64"),
    "",
  ].join("\n");
}

export function signFiles(paths, keyPath) {
  const key = loadSigningKey(keyPath);
  for (const path of paths) {
    const sig = minisignSignature(readFileSync(path), basename(path), key);
    writeFileSync(`${path}.minisig`, sig);
    console.log(`Signed: ${path}.minisig`);
  }
}

if (import.meta.main) {
  const keyPath = process.env.FOURWORDS_SIGNING_KEY;
  if (!keyPath) throw new Error("Set FOURWORDS_SIGNING_KEY to the signing key file path.");
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Usage: bun scripts/sign.mjs FILE...");
  signFiles(files, keyPath);
}
