/**
 * check-upstream-validators — AC4.8, made mechanical.
 *
 * "`packages/bazaar` contains no validator implementation of its own — every validation call
 * resolves to an upstream export." That is the acceptance criterion, and it is the one the
 * discarded M4 WIP would have failed on four of its eight files (Spec Amendment 007 §7).
 *
 * D3's reasoning is worth restating, because the rule looks arbitrary until you have watched it
 * fail: two validators that disagree is a bug factory. Upstream's icon-URL check is an SSRF
 * control. If Movo ships a second one and the two drift, a URL Movo blesses and a facilitator
 * rejects becomes a support ticket, and a URL Movo blesses and a facilitator *accepts* becomes a
 * security finding. Neither is worth the convenience of a local copy.
 *
 * Three signals, chosen because each is a genuine tell rather than a style preference:
 *
 *  1. A **declared function** whose name reads as a validator (`validate*`, `sanitize*`,
 *     `isValid*`). Movo may *call* these; declaring one is writing a second implementation.
 *  2. A **regular expression literal**. Character-class and length rules are what upstream's
 *     validators encode, and a regex in this package is almost always one being re-derived.
 *  3. A **numeric constraint constant** (`maxLength`, `maxCount`, and similar). The discarded
 *     WIP had a `BAZAAR_CONSTRAINTS` block re-stating upstream's 32-character and 5-tag limits.
 *
 * The gate also asserts the *positive*: that the package actually imports upstream validators.
 * Without that, deleting every call would pass — a package that validates nothing is not a
 * package that delegates.
 *
 * Usage:
 *   node scripts/check-upstream-validators.ts
 *   node scripts/check-upstream-validators.ts --root <dir>   # proof-of-failure fixtures
 *   node scripts/check-upstream-validators.ts --json
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { movoPackageName } from "../packages/core/src/identity.ts";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

/** The package under the rule. */
const GUARDED_DIRECTORY: string = join("packages", "bazaar", "src");

/** Where a lawful validator import must come from — derived, never spelled out. */
const UPSTREAM_SPECIFIER: string = `${movoPackageName("core")}/bazaar`;

/** Names that read as a validator. Movo may call these; it may not declare them. */
const VALIDATOR_NAME = /^(validate|sanitize|isValid)[A-Z_]/;

/**
 * The one declared name permitted, and why.
 *
 * `validateDiscoveryStrict` is the specification's own name for the **escalation orchestrator**
 * (§5.7) — it validates nothing itself, it calls upstream's validators and raises the severity
 * of what they report. The name reads like a validator because the spec chose it, not because
 * the function is one.
 *
 * This list is deliberately one entry long and must stay that way. Adding a name is how the
 * gate stops working, so an addition needs the same scrutiny as the code it would permit — and
 * the file-level delegation check below still applies to whatever file the name lives in.
 */
const PERMITTED_DECLARATIONS: ReadonlySet<string> = new Set(["validateDiscoveryStrict"]);

/** One violation. */
export interface ValidatorViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: "declared-validator" | "regex-literal" | "constraint-constant";
  readonly text: string;
  readonly why: string;
}

/** The result of a scan. */
export interface ValidatorReport {
  readonly scanned: number;
  /** Upstream validator names imported across the package. */
  readonly upstreamImports: readonly string[];
  readonly violations: readonly ValidatorViolation[];
}

function listSources(directory: string, accumulator: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return accumulator;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const child = join(directory, entry);
    if (statSync(child).isDirectory()) {
      listSources(child, accumulator);
      continue;
    }
    // Tests may name anything; they assert on validators rather than being them.
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) accumulator.push(child);
  }
  return accumulator;
}

/**
 * Collect the validator names a file imports from the upstream waist.
 *
 * @param source - File contents
 * @returns Imported names that read as validators
 */
function upstreamValidatorImports(source: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(
    String.raw`import\s*\{([^}]*)\}\s*from\s*["']${UPSTREAM_SPECIFIER.replace("/", "\\/")}["']`,
    "g",
  );

  let match = pattern.exec(source);
  while (match !== null) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = raw.replace(/^\s*type\s+/, "").trim();
      if (VALIDATOR_NAME.test(name)) names.push(name);
    }
    match = pattern.exec(source);
  }
  return names;
}

/**
 * Scan a repository-shaped directory for Movo-owned validators.
 *
 * @param root - Repository root
 * @returns Files scanned, upstream imports found, and any violations
 */
export function checkUpstreamValidators(root: string): ValidatorReport {
  const violations: ValidatorViolation[] = [];
  const upstreamImports = new Set<string>();
  const files = listSources(join(root, GUARDED_DIRECTORY), []);

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(root, file).split(sep).join("/");

    for (const name of upstreamValidatorImports(source)) upstreamImports.add(name);

    for (const [index, line] of source.split("\n").entries()) {
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

      const declared = /(?:function|const|let)\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
      if (
        declared !== null &&
        VALIDATOR_NAME.test(declared[1] ?? "") &&
        !PERMITTED_DECLARATIONS.has(declared[1] ?? "")
      ) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: "declared-validator",
          text: trimmed.slice(0, 120),
          why: `declares ${declared[1] ?? ""}, which reads as a validator. D3 assigns Bazaar validation to upstream — import it from ${UPSTREAM_SPECIFIER} instead. Two validators that disagree is a bug factory, and the icon-URL check is an SSRF control.`,
        });
      }

      // A regex literal, excluding the trivial replace/split helpers that are not validation.
      if (/=\s*\/(?![/*])[^/\n]{4,}\/[gimsuy]*\s*[;,)]/.test(trimmed)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: "regex-literal",
          text: trimmed.slice(0, 120),
          why: `contains a regular expression literal. Character-class and length rules are exactly what upstream's validators encode; a regex here is almost certainly one being re-derived.`,
        });
      }

      if (/\b(maxLength|minLength|maxCount|maxTags|MAX_LENGTH|MAX_COUNT)\b\s*[:=]/.test(trimmed)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: "constraint-constant",
          text: trimmed.slice(0, 120),
          why: `declares a length or count constraint. Upstream owns those limits; restating them creates a second source of truth that drifts the first time upstream changes one.`,
        });
      }
    }
  }

  return { scanned: files.length, upstreamImports: [...upstreamImports].sort(), violations };
}

function main(): void {
  const { values } = parseArgs({
    options: { root: { type: "string" }, json: { type: "boolean", default: false } },
  });

  const root = resolve(values.root ?? REPO_ROOT);
  const report = checkUpstreamValidators(root);

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `upstream validators: scanned ${String(report.scanned)} file(s) under ${join(root, GUARDED_DIRECTORY)}\n` +
        `  delegating to: ${report.upstreamImports.join(", ") || "NOTHING"}\n`,
    );
    for (const violation of report.violations) {
      process.stdout.write(
        `  VIOLATION ${violation.file}:${String(violation.line)} [${violation.rule}]\n` +
          `    ${violation.text}\n    ${violation.why}\n`,
      );
    }
  }

  // The positive half. A package that has stopped validating entirely would satisfy every
  // negative rule above, so "delegates to nothing" is itself a failure.
  if (report.scanned > 0 && report.upstreamImports.length === 0) {
    process.stderr.write(
      "\nupstream validators FAILED: the package imports no upstream validator at all.\n" +
        "AC4.8 requires that every validation call resolves to an upstream export — not that\n" +
        "there are no validation calls.\n",
    );
    process.exit(1);
  }

  if (report.violations.length > 0) {
    process.stderr.write(
      `\nupstream validators FAILED: ${String(report.violations.length)} violation(s).\n` +
        "Movo derives and escalates; upstream validates (spec §1.8 D3, AC4.8). If the rule you\n" +
        "need genuinely is not exported upstream, that is a contribution upstream and a shim\n" +
        "marked for deletion — not a Movo-owned validator.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    "upstream validators PASSED: every validation resolves to an upstream export.\n",
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
