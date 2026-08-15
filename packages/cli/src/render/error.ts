/**
 * Rendering a failure the way M5's brief describes it: code, title, safe context, cause chain,
 * docs link.
 *
 * **Nothing here redacts.** That is not an omission — it is the point. `MovoError` redacts at
 * construction (spec §1.5 P6), so by the time a value reaches this file there is no unredacted
 * form of it anywhere to leak. A renderer that also redacted would imply the error object still
 * held something dangerous, and would create a second place for the redaction rules to drift.
 *
 * The cause chain is printed because the useful sentence is almost always in the third link.
 * A `MOVO_E_...` code with a one-line message and no chain reads as "Movo broke" rather than
 * "your facilitator URL resolves to nothing".
 */

import { isMovoError, type MovoError } from "@movoframework/core";
import type { Styler } from "./style.js";

/** How deep to follow `cause`. Guards against a cycle a user's own error class may contain. */
const MAX_CAUSE_DEPTH = 8;

function messageOf(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function causeChain(error: unknown): string[] {
  const chain: string[] = [];
  let current: unknown = (error as { cause?: unknown }).cause;
  let depth = 0;

  while (current !== undefined && current !== null && depth < MAX_CAUSE_DEPTH) {
    chain.push(messageOf(current));
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }

  return chain;
}

/**
 * Render a `MovoError` for a terminal.
 *
 * @param error - The error to render
 * @param style - The styler; pass a plain one outside a TTY
 * @returns The rendered block, newline-terminated
 */
export function renderMovoError(error: MovoError, style: Styler): string {
  const lines: string[] = [];

  lines.push(`${style.red(style.bold(error.code))}  ${error.message}`);

  const context = Object.entries(error.context);
  if (context.length > 0) {
    lines.push("");
    // Padded before styling, not after: an ANSI escape sequence counts toward `padEnd`'s length
    // while occupying no columns, so styling first produces a table that is aligned with colour
    // off and ragged with it on.
    const width = context.reduce((widest, [key]) => Math.max(widest, key.length), 0);
    for (const [key, value] of context) {
      lines.push(`  ${style.dim(key.padEnd(width))}  ${messageOf(value)}`);
    }
  }

  const causes = causeChain(error);
  if (causes.length > 0) {
    lines.push("");
    lines.push(`  ${style.dim("caused by")}`);
    for (const [index, cause] of causes.entries()) {
      lines.push(`  ${style.dim(`${"  ".repeat(index)}└─`)} ${cause}`);
    }
  }

  lines.push("");
  lines.push(`  ${style.bold("fix")}   ${error.fix}`);
  lines.push(`  ${style.bold("docs")}  ${style.blue(error.docs)}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

/**
 * Render any thrown value.
 *
 * A non-`MovoError` is rendered without a code or a docs link rather than being given a
 * plausible-looking one. An invented code would be worse than none: it would send a reader to a
 * documentation page that does not describe what happened to them.
 *
 * @param error - The thrown value
 * @param style - The styler
 * @returns The rendered block, newline-terminated
 */
export function renderUnknownError(error: unknown, style: Styler): string {
  if (isMovoError(error)) return renderMovoError(error, style);

  const lines = [`${style.red(style.bold("error"))}  ${messageOf(error)}`];
  const causes = causeChain(error);
  if (causes.length > 0) {
    lines.push("");
    lines.push(`  ${style.dim("caused by")}`);
    for (const [index, cause] of causes.entries()) {
      lines.push(`  ${style.dim(`${"  ".repeat(index)}└─`)} ${cause}`);
    }
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}
