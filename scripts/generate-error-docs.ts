/**
 * generate-error-docs — writes `docs/reference/errors.md` from the error registry.
 *
 * The reference page is generated, never hand-edited, for the same reason
 * `docs/COMPATIBILITY.md` is: a hand-maintained list of error codes drifts from the code that
 * raises them, and it drifts silently. A developer who hits `MOVO_E_TRUSTLINE_MISSING` and
 * finds no page for it learns that the diagnostics are decorative.
 *
 * `tests/unit/error-docs-sync.test.ts` regenerates the page in memory and fails if the
 * committed file differs, so the two cannot diverge (AC1.7).
 *
 * Usage:
 *   node scripts/generate-error-docs.ts                    # write the file
 *   node scripts/generate-error-docs.ts --check            # exit non-zero if it is stale
 *   node scripts/generate-error-docs.ts --check --path P   # check any file
 *
 * `--path` exists so the gate can be pointed at a deliberately stale copy in a temporary
 * directory, which is how it is proven to fire without touching the committed page.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  DOCS_BASE_URL,
  docsUrlFor,
  MOVO_ERROR_CODES,
  MOVO_ERROR_REGISTRY,
} from "../packages/core/src/errors/registry.ts";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

/** Where the generated page lives. */
export const ERROR_DOCS_PATH: string = join(REPO_ROOT, "docs", "reference", "errors.md");

/**
 * Escape a cell so a fix template containing a pipe cannot break the table.
 *
 * @param text - Cell text
 * @returns Text safe to place in a Markdown table cell
 */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * Render the reference page from the registry.
 *
 * @returns The complete Markdown document
 */
export function renderErrorDocs(): string {
  const errors = MOVO_ERROR_CODES.filter((code) => MOVO_ERROR_REGISTRY[code].severity === "error");
  const warnings = MOVO_ERROR_CODES.filter(
    (code) => MOVO_ERROR_REGISTRY[code].severity === "warning",
  );

  const lines: string[] = [
    "# Error reference",
    "",
    "<!-- GENERATED FILE — DO NOT EDIT BY HAND. Regenerate with `pnpm generate:errors`. -->",
    "",
    "Every failure Movo raises carries a stable code, a one-line meaning and a fix. Codes are",
    "permanent: a code is never reused for a different meaning and never renamed, because CI",
    "configurations and support threads reference them by string. A code that is withdrawn is",
    "marked deprecated and superseded, not deleted.",
    "",
    `Each code resolves to \`${DOCS_BASE_URL}/errors/<CODE>\`.`,
    "",
    "## Errors",
    "",
    "| Code | Meaning | Fix |",
    "|---|---|---|",
  ];

  for (const code of errors) {
    const entry = MOVO_ERROR_REGISTRY[code];
    lines.push(
      `| [\`${code}\`](${docsUrlFor(code)}) | ${cell(entry.meaning)} | ${cell(entry.fix)} |`,
    );
  }

  lines.push("", "## Warnings", "");
  lines.push(
    "Warnings surface as `Finding`s rather than exceptions. Whether a warning fails a build is",
    "policy, and policy belongs to the caller — `movo doctor --fail-on warn` is a flag for",
    "exactly that reason.",
    "",
    "| Code | Meaning | Fix |",
    "|---|---|---|",
  );

  for (const code of warnings) {
    const entry = MOVO_ERROR_REGISTRY[code];
    lines.push(
      `| [\`${code}\`](${docsUrlFor(code)}) | ${cell(entry.meaning)} | ${cell(entry.fix)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const { values } = parseArgs({
    options: { check: { type: "boolean", default: false }, path: { type: "string" } },
  });
  const target = values.path === undefined ? ERROR_DOCS_PATH : resolve(values.path);
  const rendered = renderErrorDocs();

  if (values.check === true) {
    let existing = "";
    try {
      existing = readFileSync(target, "utf8");
    } catch {
      process.stderr.write(`error docs missing at ${target}\n`);
      process.exit(1);
    }
    if (existing !== rendered) {
      process.stderr.write(
        `${target} is stale. Run \`pnpm generate:errors\` and commit the result.\n`,
      );
      process.exit(1);
    }
    process.stdout.write("error docs are up to date.\n");
    return;
  }

  writeFileSync(target, rendered, "utf8");
  process.stdout.write(`wrote ${target} (${String(MOVO_ERROR_CODES.length)} codes)\n`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
