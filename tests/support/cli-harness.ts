/**
 * Driving the CLI in-process and capturing every byte it writes.
 *
 * AC5.4 claims that a configured API key appears in **zero bytes** of any doctor output. That is
 * only a checkable claim if the test can see all of the output, which is why the commands take a
 * `CommandContext` rather than reaching for `process.stdout`. This harness is the other half of
 * that arrangement.
 *
 * Colour is off by default: an assertion like `expect(out).toContain(payTo)` would otherwise fail
 * or pass depending on whether an escape sequence happened to land mid-value.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CommandContext,
  plainStyler,
  run,
  type Styler,
} from "../../packages/cli/src/index.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/** What a captured run produced. */
export interface CaptureResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Everything written to either stream — what AC5.4 searches. */
  readonly all: string;
}

/** Options for {@link runCli}. */
export interface RunCliOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly style?: Styler;
}

/**
 * Run the CLI and capture its output.
 *
 * @param argv - Arguments after the binary name
 * @param options - Working directory, environment and styling
 * @returns The exit code and captured streams
 */
export async function runCli(
  argv: readonly string[],
  options: RunCliOptions,
): Promise<CaptureResult> {
  let stdout = "";
  let stderr = "";

  const context: CommandContext = {
    cwd: options.cwd,
    env: options.env ?? {},
    style: options.style ?? plainStyler,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  };

  const code = await run(argv, context);

  return { code, stdout, stderr, all: stdout + stderr };
}

/** A throwaway project directory. */
export interface TempProject {
  readonly root: string;
  cleanup(): void;
}

/**
 * Where throwaway projects are written: `.movo-tmp/` at the repository root.
 *
 * Two constraints pin this down, and both were learned the hard way.
 *
 * **Not the OS temp directory.** Node resolves bare specifiers by walking up from the importing
 * file, so a project in `/tmp` cannot import the workspace packages at all — it would fail to
 * load for a reason unrelated to what the test is checking.
 *
 * **Not `node_modules` either**, which is the obvious way to satisfy the first constraint. Node
 * refuses to strip types for any file underneath it — *"Stripping types is currently unsupported
 * for files under node_modules"* — so a fixture placed there is loaded by Vitest's transform
 * rather than by the loader a real `movo` invocation uses. The tests would keep passing while the
 * real path was broken, which is the whole failure mode this harness exists to catch.
 */
const TEMP_ROOT = join(REPO_ROOT, ".movo-tmp");

/**
 * Write a minimal Movo project into a throwaway directory.
 *
 * The files are written as TypeScript and loaded the way a real project is — a fixture that used
 * pre-compiled JavaScript would not exercise the loader, which is where a first-time user's first
 * failure actually happens.
 *
 * @param files - Path (relative, forward-slashed) to contents
 * @returns The project root and a cleanup function
 */
export function tempProject(files: Readonly<Record<string, string>>): TempProject {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEMP_ROOT, "cli-"));

  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, ...path.split("/"));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }

  return {
    root,
    cleanup: (): void => {
      rmSync(root, { force: true, recursive: true });
    },
  };
}
