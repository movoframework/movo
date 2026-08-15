/**
 * `movo test` — a Vitest wrapper, and nothing more.
 *
 * The scope note in M5 is blunt about this: **do not reimplement a test runner.** What the
 * command adds is one thing a project would otherwise have to configure by hand — preloading
 * `@movoframework/testing`'s setup so the custom matchers are registered — and it adds it by
 * passing a flag to Vitest rather than by owning any part of the run.
 *
 * Every argument after the command name is forwarded untouched, so `movo test --watch`,
 * `movo test src/weather.test.ts` and `movo test -t "settles"` all behave exactly as the Vitest
 * documentation says they do. A wrapper that reinterpreted its arguments would make every
 * Vitest answer on the internet wrong for Movo users.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { MovoError } from "@movoframework/core";
import { findProjectRoot } from "../project.js";
import type { CommandContext } from "./context.js";

/** The setup module `movo test` preloads. */
export const SETUP_MODULE = "@movoframework/testing/setup";

/**
 * Resolve Vitest's own CLI entry from the project.
 *
 * Resolved from the **project**, not from the CLI's own dependencies, so a project pinning a
 * particular Vitest gets that one. A wrapper that silently ran its own bundled version would
 * produce results that do not match what the project's CI runs.
 *
 * @param root - The project root
 * @returns Absolute path to Vitest's CLI entry
 */
export function resolveVitest(root: string): string {
  const require = createRequire(join(root, "noop.js"));

  try {
    return require.resolve("vitest/dist/cli.js");
  } catch {
    // Fall through to the error below rather than silently trying a different runner.
  }

  throw new MovoError(
    "MOVO_E_APP_INVALID",
    "Vitest is not installed in this project. `movo test` is a thin wrapper around Vitest rather than a test runner of its own, so it needs Vitest present. Run `pnpm add -D vitest`.",
    { context: { root } },
  );
}

/**
 * Run `movo test`.
 *
 * @param argv - Arguments to forward to Vitest, verbatim
 * @param context - Streams and environment
 * @returns The process exit code, which is Vitest's own
 */
export async function testCommand(
  argv: readonly string[],
  context: CommandContext,
): Promise<number> {
  const root = findProjectRoot(context.cwd);

  if (root === undefined) {
    throw new MovoError(
      "MOVO_E_APP_INVALID",
      `No movo.config.ts found in ${context.cwd} or any parent directory, so there is no project to test.`,
      { context: { searchedFrom: context.cwd } },
    );
  }

  const vitest = resolveVitest(root);

  // `--setupFiles` is additive to whatever the project's own Vitest config declares, so the
  // matchers are registered without the wrapper having to read, merge or override that config.
  //
  // Arguments are otherwise forwarded verbatim, including the absence of `run`: Vitest already
  // watches in a TTY and runs once outside one, and a wrapper that injected `run` would make
  // `movo test --watch` mean something different from what every Vitest answer on the internet
  // says it means.
  const child = spawn(process.execPath, [vitest, "--setupFiles", SETUP_MODULE, ...argv], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  return await new Promise<number>((resolve) => {
    child.on("exit", (code, signal) => {
      resolve(signal !== null ? 1 : (code ?? 0));
    });
    child.on("error", () => {
      resolve(1);
    });
  });
}
