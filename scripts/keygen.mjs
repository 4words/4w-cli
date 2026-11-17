// Generates the 4w release signing keypair (minisign-compatible verification).
// The private key file NEVER enters the repository: back it up somewhere safe.
// Usage: bun scripts/keygen.mjs [KEY_FILE]   (default: ~/.config/4words-release/minisign.key)
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const keyPath = process.argv[2] || join(homedir(), ".config", "4words-release", "minisign.key");
if (existsSync(keyPath)) throw new Error(`Refusing to overwrite existing key: ${keyPath}`);

const { privateKey } = generateKeyPairSync("ed25519");
const jwk = privateKey.export({ format: "jwk" });
const keyId = randomBytes(8);
const pub = Buffer.from(jwk.x, "base64url");

mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
writeFileSync(keyPath, JSON.stringify({
  comment: "4w release signing key (Ed25519). Keep this file private and backed up.",
  key_id: keyId.toString("hex"),
  seed_b64: jwk.d,
  pub_b64: pub.toString("base64"),
  created_at: new Date().toISOString(),
}, null, 2) + "\n", { mode: 0o600 });

// minisign-format public key blob: "Ed" + key_id(8) + pubkey(32)
const pubBlob = Buffer.concat([Buffer.from("Ed"), keyId, pub]).toString("base64");
const pubFile = `untrusted comment: minisign public key ${keyId.toString("hex").toUpperCase()}\n${pubBlob}\n`;
writeFileSync(new URL("../minisign.pub", import.meta.url), pubFile);

console.log(`Private key: ${keyPath}`);
console.log(`Public key file: minisign.pub (commit this one)`);
console.log(`Embed in src/commands.ts UPDATE_PUBKEYS: ${pubBlob}`);
