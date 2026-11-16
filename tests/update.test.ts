import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cliCommand } from "./bin";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { minisignSignature } from "../scripts/sign.mjs";
import { compareSemver, help, helpTopic, VERSION } from "../src/help";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
let directory: string;
let server: ReturnType<typeof Bun.serve>;
let servedVersion = "0.4.0";
let installerBody: string | undefined;
let installerSig: string | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "4w-update-test-"));
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/package.json") {
        return Response.json({ name: "4w-cli", version: servedVersion });
      }
      if (url.pathname === "/install.sh" && installerBody !== undefined) {
        return new Response(installerBody, { headers: { "Content-Type": "text/x-shellscript" } });
      }
      if (url.pathname === "/install.sh.minisig" && installerSig !== undefined) {
        return new Response(installerSig, { headers: { "Content-Type": "text/plain" } });
      }
      return new Response("Not found", { status: 404 });
    },
  });
});

afterAll(async () => {
  server.stop(true);
  await rm(directory, { recursive: true, force: true });
});

async function run(args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = {
    ...process.env,
    FOURWORDS_UPDATE_URL: `${server.url.origin}/package.json`,
    FOURWORDS_CONFIG_FILE: join(directory, "config.json"),
    FOURWORDS_NO_UPDATE_CHECK: "1",
    ...extraEnv,
  };
  const p = Bun.spawn([...cliCommand, ...args], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([p.exited, p.stdout.text(), p.stderr.text()]);
  return { code, out, err };
}

test("compareSemver compara números de versão semântica corretamente", () => {
  expect(compareSemver("0.3.2", "0.3.1")).toBe(1);
  expect(compareSemver("0.3.1", "0.3.2")).toBe(-1);
  expect(compareSemver("0.3.2", "0.3.2")).toBe(0);
  expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
  expect(compareSemver("0.10.0", "0.9.5")).toBe(1);
  expect(compareSemver("0.3.2", "0.3.2.1")).toBe(-1);
});

test("ajuda de update cobre tópicos em en, ptbr e es", () => {
  expect(help("update", "en")).toContain("Update 4w");
  expect(help("update", "ptbr")).toContain("Atualizar o 4w");
  expect(help("update", "es")).toContain("Actualizar 4w");
  expect(help(helpTopic(["update", "--help"]), "en")).toContain("4w update [--check] [--force]");
  expect(help(helpTopic(["help", "update"]), "ptbr")).toContain("--force");
});

test("4w update --check identifica se há versão mais recente no repositório", async () => {
  servedVersion = "0.9.0";
  const { code, out } = await run(["update", "--check"]);
  expect(code).toBe(0);
  const data = JSON.parse(out);
  expect(data.ok).toBe(true);
  expect(data.update_available).toBe(true);
  expect(data.latest_version).toBe("0.9.0");
  expect(data.current_version).toBe(VERSION);
  expect(data.command).toBe("4w update");

  servedVersion = VERSION;
  const noUp = await run(["update", "--check"]);
  expect(noUp.code).toBe(0);
  const noUpData = JSON.parse(noUp.out);
  expect(noUpData.ok).toBe(true);
  expect(noUpData.update_available).toBe(false);
  expect(noUpData.latest_version).toBe(VERSION);
});

test("4w update não reinstala quando versão já é a mais recente a menos que use --force", async () => {
  servedVersion = VERSION;
  const { code, out } = await run(["update"]);
  expect(code).toBe(0);
  const data = JSON.parse(out);
  expect(data.ok).toBe(true);
  expect(data.update_available).toBe(false);
  expect(data.message).toContain("already");
});

test("4w update executa script de instalação com sucesso e reporta versão anterior e nova", async () => {
  servedVersion = "1.0.0";
  const mockScript = join(directory, "mock-install.sh");
  await writeFile(mockScript, "#!/bin/sh\necho 'Mock install completed successfully.'\nexit 0\n", { mode: 0o755 });

  const { code, out } = await run(["update"], { FOURWORDS_INSTALLER_SCRIPT: mockScript });
  expect(code).toBe(0);
  const data = JSON.parse(out);
  expect(data.ok).toBe(true);
  expect(data.previous_version).toBe(VERSION);
  expect(data.updated_version).toBe("1.0.0");
  expect(data.output).toContain("Mock install completed successfully.");
});

test("4w update reporta erro caso o instalador falhe com código não zero", async () => {
  servedVersion = "1.0.0";
  const failingScript = join(directory, "failing-install.sh");
  await writeFile(failingScript, "#!/bin/sh\necho 'Disk full error' >&2\nexit 2\n", { mode: 0o755 });

  const { code, err } = await run(["update"], { FOURWORDS_INSTALLER_SCRIPT: failingScript });
  expect(code).toBe(1);
  expect(err).toContain("Disk full error");
});

test("4w update rejeita URLs de atualização e instalador sem HTTPS fora do loopback", async () => {
  const httpRemote = await run(["update", "--check"], { FOURWORDS_UPDATE_URL: "http://exemplo.com/package.json" });
  expect(httpRemote.code).toBe(1);
  expect(httpRemote.err).toContain("FOURWORDS_UPDATE_URL");

  const withCreds = await run(["update", "--check"], { FOURWORDS_UPDATE_URL: "https://user:pass@exemplo.com/package.json" });
  expect(withCreds.code).toBe(1);
  expect(withCreds.err).toContain("FOURWORDS_UPDATE_URL");

  const loopback = await run(["update", "--check"]);
  expect(loopback.code).toBe(0);

  const badInstaller = await run(["update", "--force"], { FOURWORDS_INSTALLER_URL: "http://exemplo.com/install.sh" });
  expect(badInstaller.code).toBe(1);
  expect(badInstaller.err).toContain("FOURWORDS_INSTALLER_URL");

  const missingScript = await run(["update", "--force"], { FOURWORDS_INSTALLER_SCRIPT: join(directory, "nao-existe.sh") });
  expect(missingScript.code).toBe(1);
  expect(missingScript.err).toContain("FOURWORDS_INSTALLER_SCRIPT");
});

function ephemeralReleaseKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = randomBytes(8);
  const rawPub = Buffer.from((publicKey.export({ format: "jwk" }) as { x: string }).x, "base64url");
  const pubBlob = Buffer.concat([Buffer.from("Ed"), keyId, rawPub]).toString("base64");
  return { key: { keyId, privateKey }, pubBlob };
}

test("4w update baixa o instalador da tag, verifica a assinatura minisign e só então executa", async () => {
  servedVersion = "1.0.0";
  const { key, pubBlob } = ephemeralReleaseKey();
  installerBody = "#!/bin/sh\necho 'signed install ok'\nexit 0\n";
  installerSig = minisignSignature(Buffer.from(installerBody), "install.sh", key);
  const env = {
    FOURWORDS_INSTALLER_URL: `${server.url.origin}/install.sh`,
    FOURWORDS_UPDATE_PUBKEY: pubBlob,
  };

  const ok = await run(["update"], env);
  expect(ok.code).toBe(0);
  const data = JSON.parse(ok.out);
  expect(data.ok).toBe(true);
  expect(data.output).toContain("signed install ok");

  // Tampered content: signature stays, one byte changes.
  installerBody = "#!/bin/sh\necho 'signed install ok '\nexit 0\n";
  const tampered = await run(["update"], env);
  expect(tampered.code).toBe(1);
  expect(tampered.err).toContain("signature");

  // Signature from an unknown key.
  const outro = ephemeralReleaseKey();
  installerBody = "#!/bin/sh\necho 'signed install ok'\nexit 0\n";
  installerSig = minisignSignature(Buffer.from(installerBody), "install.sh", outro.key);
  const wrongKey = await run(["update"], env);
  expect(wrongKey.code).toBe(1);
  expect(wrongKey.err).toContain("signature");

  // Missing .minisig file.
  installerSig = undefined;
  const missing = await run(["update"], env);
  expect(missing.code).toBe(1);
  expect(missing.err).toContain("signature");

  installerBody = undefined;
});
