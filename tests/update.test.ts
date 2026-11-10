import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSemver, help, helpTopic, VERSION } from "../src/help";

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
let directory: string;
let server: ReturnType<typeof Bun.serve>;
let servedVersion = "0.4.0";

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
  const p = Bun.spawn([process.execPath, cli, ...args], {
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
