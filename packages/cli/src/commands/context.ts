/**
 * What a command is allowed to touch.
 *
 * Commands take this rather than reaching for `process` and `console` directly, for one reason
 * that matters more than tidiness: **AC5.4 asserts that a configured API key appears in zero
 * bytes of any doctor output**, and a claim like that is only checkable if every byte a command
 * writes goes through something a test can capture. A single `console.log` reaching the real
 * stdout would be a hole in the assertion rather than an untidy line.
 */

import type { Styler } from "../render/style.js";

/** The streams, environment and styling a command may use. */
export interface CommandContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly style: Styler;
  stdout(text: string): void;
  stderr(text: string): void;
}

/**
 * Build a context writing to the real process streams.
 *
 * @param style - The styler, decided from `NO_COLOR` and TTY state by the caller
 * @returns The context
 */
export function processContext(style: Styler): CommandContext {
  return {
    cwd: process.cwd(),
    env: process.env,
    style,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}
