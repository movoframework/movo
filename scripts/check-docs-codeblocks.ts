/**
 * check-docs-codeblocks — every TypeScript block in the documentation must compile.
 *
 * Spec §17 makes this a release gate rather than style guidance, and the reason is specific:
 * documentation that does not compile is documentation that was true once. A reader who
 * copies a snippet and gets a type error learns that the docs are approximate, and from then
 * on reads them as prose rather than as instructions. For a payments framework whose central
 * claim is that the types carry real guarantees, that is an expensive thing to teach.
 *
 * Blocks are extracted, written to a temporary project that resolves the Movo core package to
 * this repository's sources, and compiled with `tsc --noEmit`. The package specifier is derived
 * from `MOVO_SCOPE`, never written out — see `packages/core/src/identity.ts`.
 *
 * Two escape hatches, both of which must be visible in the Markdown:
 *
 *   ```ts no-check      the block is illustrative and is not compiled
 *   ```ts expect-error  the block must FAIL to compile; the gate fails if it succeeds
 *
 * `expect-error` exists because some of the most useful documentation shows what Movo
 * *rejects* — a price named by ticker, a handler returning the wrong shape. A gate that could
 * only assert success would push those examples out of the docs.
 *
 * Usage:
 *   node scripts/check-docs-codeblocks.ts
 *   node scripts/check-docs-codeblocks.ts --docs <dir>   # any directory of Markdown
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { movoPackageName } from "../packages/core/src/identity.ts";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

/**
 * Directories excluded from the sweep.
 *
 * `context/` holds the architecture specification and its amendments — input documents whose
 * snippets are design sketches, deliberately not compilable. `reference/` is generated.
 */
const EXCLUDED_DIRECTORIES: readonly string[] = ["context", "reference"];

/**
 * Individual documents excluded from the sweep.
 *
 * `SPIKE_REPORT.md` is an evidence record, not instruction. Its TypeScript fences are verbatim
 * transcripts of upstream `.d.mts` declarations — `declare class`, constructor signatures — and
 * their value is that they are exactly what was read at the time. Rewriting them so a compiler
 * accepts them out of context would damage the evidence to satisfy a gate.
 */
const EXCLUDED_FILES: readonly string[] = ["SPIKE_REPORT.md"];

/** One extracted block. */
export interface CodeBlock {
  readonly file: string;
  readonly index: number;
  readonly line: number;
  readonly mode: "compile" | "no-check" | "expect-error";
  readonly source: string;
}

/**
 * Extract fenced TypeScript blocks from a Markdown document.
 *
 * @param markdown - The document text
 * @param file - Repository-relative path, recorded on each block
 * @returns Every TypeScript block, in document order
 */
export function extractCodeBlocks(markdown: string, file: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split("\n");

  let index = 0;
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    const opening = /^```(\S+)(.*)$/.exec(line);
    if (opening === null) {
      cursor += 1;
      continue;
    }

    const language = (opening[1] ?? "").toLowerCase();
    const attributes = opening[2] ?? "";
    const body: string[] = [];
    let scan = cursor + 1;
    while (scan < lines.length && (lines[scan] ?? "").trimEnd() !== "```") {
      body.push(lines[scan] ?? "");
      scan += 1;
    }

    if (language === "ts" || language === "typescript") {
      const mode = attributes.includes("no-check")
        ? "no-check"
        : attributes.includes("expect-error")
          ? "expect-error"
          : "compile";
      blocks.push({ file, index, line: cursor + 1, mode, source: body.join("\n") });
      index += 1;
    }

    cursor = scan + 1;
  }

  return blocks;
}

function listMarkdown(directory: string, root: string, accumulator: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const child = join(directory, entry);
    if (statSync(child).isDirectory()) {
      const fromRoot = relative(root, child).split(sep)[0];
      if (fromRoot !== undefined && EXCLUDED_DIRECTORIES.includes(fromRoot)) continue;
      listMarkdown(child, root, accumulator);
      continue;
    }
    if (entry.endsWith(".md") && !EXCLUDED_FILES.includes(entry)) accumulator.push(child);
  }
  return accumulator;
}

/** The result of compiling one block. */
export interface BlockResult {
  readonly block: CodeBlock;
  readonly compiled: boolean;
  readonly diagnostics: string;
}

/**
 * Compile every block in isolation.
 *
 * Blocks are compiled one project per block rather than all together, because a single
 * project would let two documents share a declaration by accident — and a snippet that only
 * compiles because another page declared a variable is a snippet a reader cannot use.
 *
 * @param blocks - Blocks to compile
 * @returns One result per compiled block; `no-check` blocks are omitted
 */
export function compileBlocks(blocks: readonly CodeBlock[]): BlockResult[] {
  const compilable = blocks.filter((block) => block.mode !== "no-check");
  if (compilable.length === 0) return [];

  // The workspace lives inside `packages/core/` rather than in the system temp directory, so
  // that ordinary Node resolution walks up and finds the real `node_modules` — `zod`,
  // `@x402/*`, `@types/node`. A snippet then compiles against the same package graph a reader's
  // project would, instead of against a synthetic one that has to be kept in step by hand.
  const workspace = mkdtempSync(join(REPO_ROOT, "packages", "core", ".docs-codeblocks-"));
  const results: BlockResult[] = [];

  try {
    for (const block of compilable) {
      const directory = join(workspace, `block-${String(results.length)}`);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "snippet.ts"), `${block.source}\n`, "utf8");
      // Snippets are ESM, like everything Movo publishes (spec §1.8 D9).
      writeFileSync(join(directory, "package.json"), '{ "type": "module" }\n', "utf8");
      writeFileSync(
        join(directory, "tsconfig.json"),
        `${JSON.stringify(
          {
            extends: join(REPO_ROOT, "tsconfig.base.json").split(sep).join("/"),
            compilerOptions: {
              noEmit: true,
              composite: false,
              declaration: false,
              declarationMap: false,
              sourceMap: false,
              // Relaxed for snippets only. A documentation example legitimately declares a
              // value to show its shape and never uses it, and it is not a published surface,
              // so `isolatedDeclarations` buys nothing here.
              isolatedDeclarations: false,
              noUnusedLocals: false,
              noUnusedParameters: false,
              // No `baseUrl`: TypeScript 7 removed it. Paths carry absolute targets instead.
              // The key is derived from MOVO_SCOPE rather than written out — a gate that spells
              // the scope itself is the exact failure `packages/core/src/identity.ts` documents.
              paths: {
                [movoPackageName("core")]: [
                  join(REPO_ROOT, "packages", "core", "src", "index.ts").split(sep).join("/"),
                ],
              },
              typeRoots: [join(REPO_ROOT, "node_modules", "@types").split(sep).join("/")],
            },
            include: ["snippet.ts"],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      let compiled = true;
      let diagnostics = "";
      try {
        execFileSync(
          process.execPath,
          [join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", directory],
          { encoding: "utf8", cwd: REPO_ROOT },
        );
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        compiled = false;
        diagnostics = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      }

      results.push({ block, compiled, diagnostics });
    }
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }

  return results;
}

/**
 * Collect every block under a documentation directory.
 *
 * @param docsRoot - Directory to sweep
 * @returns Every extracted block
 */
export function collectBlocks(docsRoot: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  for (const file of listMarkdown(docsRoot, docsRoot, [])) {
    const relativePath = relative(REPO_ROOT, file).split(sep).join("/");
    blocks.push(...extractCodeBlocks(readFileSync(file, "utf8"), relativePath));
  }
  return blocks;
}

function main(): void {
  const { values } = parseArgs({ options: { docs: { type: "string" } } });
  const docsRoot = resolve(values.docs ?? join(REPO_ROOT, "docs"));

  const blocks = collectBlocks(docsRoot);
  const results = compileBlocks(blocks);

  const failures = results.filter((result) =>
    result.block.mode === "expect-error" ? result.compiled : !result.compiled,
  );

  process.stdout.write(
    `docs codeblocks: ${String(results.length)} compiled, ` +
      `${String(blocks.length - results.length)} skipped (no-check), under ${docsRoot}\n`,
  );

  for (const failure of failures) {
    const { block } = failure;
    if (block.mode === "expect-error") {
      process.stdout.write(
        `  UNEXPECTED SUCCESS ${block.file}:${String(block.line)} — a block marked expect-error compiled cleanly\n`,
      );
      continue;
    }
    process.stdout.write(`  FAILED ${block.file}:${String(block.line)}\n`);
    for (const line of failure.diagnostics.trim().split("\n")) {
      process.stdout.write(`    ${line}\n`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\ndocs codeblocks FAILED: ${String(failures.length)} block(s).\n` +
        "Documentation that does not compile is documentation that was true once. Fix the\n" +
        "snippet, or mark the fence `no-check` if it is deliberately illustrative.\n",
    );
    process.exit(1);
  }

  process.stdout.write("docs codeblocks PASSED.\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
