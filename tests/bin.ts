/** Conformance hook: the same suite runs against the TypeScript CLI (default)
 * or a compiled binary when FOURWORDS_TEST_BIN points to it (e.g. the Rust `4w`). */
import { fileURLToPath } from "node:url";

const tsEntry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

/** argv prefix that launches the CLI under test. */
export const cliCommand: string[] = process.env.FOURWORDS_TEST_BIN
  ? [process.env.FOURWORDS_TEST_BIN]
  : [process.execPath, tsEntry];

/** True when testing the TypeScript implementation (skip TS-only expectations otherwise). */
export const isTypeScript = !process.env.FOURWORDS_TEST_BIN;
