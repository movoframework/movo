/**
 * check-protocol-purity — Movo reimplements no protocol primitive, checked rather than claimed.
 *
 * The project's central thesis is that the protocol layer already works and only the project
 * layer was missing. That claim is worth exactly as much as its enforcement: a package that
 * quietly starts constructing XDR, verifying a signature, or writing `PAYMENT-SIGNATURE` into a
 * header has stopped composing upstream and started competing with it, and it will do so one
 * plausible commit at a time.
 *
 * Two rules, from two different places:
 *
 *  1. **AC2.7** — the server and stellar packages contain no XDR construction, no signature
 *     verification, and no `PAYMENT-*` header literals outside tests.
 *  2. **Spec Amendment 003 §1** — `packages/core` never imports `@stellar/stellar-sdk`
 *     directly. It may reach the SDK transitively through `@x402/stellar`, which is
 *     unavoidable; a direct import is a boundary being crossed on purpose.
 *
 * The header names are imported from the narrow waist rather than written here, and the
 * proof-of-failure fixtures are rendered from the same constants. That is the M0 lesson applied:
 * when a gate and its fixtures each spell a string out independently, a rename updates the
 * fixtures, the fixture test stays green, and the gate quietly stops matching real code.
 *
 * Usage:
 *   node scripts/check-protocol-purity.ts
 *   node scripts/check-protocol-purity.ts --root <dir>   # for the proof-of-failure fixtures
 *   node scripts/check-protocol-purity.ts --json
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { movoPackageName } from "../packages/core/src/identity.ts";
import { PAYMENT_HEADERS } from "../packages/core/src/protocol/index.ts";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

/** One thing a package must not contain. */
export interface PurityRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Escape a literal for use inside a regular expression.
 *
 * @param literal - Text to match literally
 * @returns The escaped form
 */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rules applied to the packages that mount and diagnose. */
export const COMPOSITION_RULES: readonly PurityRule[] = [
  {
    id: "xdr-construction",
    // `xdr.` namespace access and the transaction/auth builders. Reading a contract's decimals
    // through `contract.Client` is not on this list and is deliberately permitted — it builds
    // no transaction, signs nothing and pays no fee (ADR-0007).
    pattern:
      /\bxdr\.[A-Z]|\bTransactionBuilder\b|\bSorobanDataBuilder\b|\bbuildAuthorizationEntryPreimage\b|\bauthorizeInvocation\b|\bauthorizeEntry\b/,
    why: "constructs XDR or an authorization entry. @x402/stellar owns auth entries, simulation and settlement; a Movo package building them is in the wrong layer.",
  },
  {
    id: "signature-handling",
    pattern: /\bsignAuthEntry\b|\bKeypair\.fromSecret\b|\bcheckAuthEntryReadiness\b|\bnacl\.sign\b/,
    why: "signs or verifies payment authorisation. Movo never holds a payer key and never verifies a signature — the buyer signs and the facilitator verifies.",
  },
  {
    id: "payment-header-literal",
    // Built from the waist's own constants, so a rename cannot leave this pattern matching
    // nothing while the fixtures keep passing.
    pattern: new RegExp(Object.values(PAYMENT_HEADERS).map(escapeForRegExp).join("|")),
    why: "writes an x402 wire header name as a literal. Import PAYMENT_HEADERS from the narrow waist instead — a package spelling protocol headers out is a package that has begun implementing the protocol.",
  },
];

/** The rule applied to core, from Spec Amendment 003 §1. */
export const CORE_RULES: readonly PurityRule[] = [
  {
    id: "direct-stellar-sdk-import",
    pattern: /from\s*["']@stellar\/stellar-sdk|require\(\s*["']@stellar\/stellar-sdk/,
    why: `imports @stellar/stellar-sdk directly. packages/core reaches the SDK only transitively through @x402/stellar (Spec Amendment 003 §1); ${movoPackageName("stellar")} is the package permitted to import it.`,
  },
];

/** Which directories each rule set applies to. */
export const SCOPES: readonly {
  readonly directory: string;
  readonly rules: readonly PurityRule[];
}[] = [
  { directory: join("packages", "server", "src"), rules: COMPOSITION_RULES },
  { directory: join("packages", "stellar", "src"), rules: COMPOSITION_RULES },
  { directory: join("packages", "core", "src"), rules: CORE_RULES },
];

/** One rule violation. */
export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly why: string;
  readonly text: string;
}

/** The result of a scan. */
export interface PurityReport {
  readonly scanned: number;
  readonly violations: readonly Violation[];
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
    // Tests are exempt by design: the integration and e2e suites must name headers and drive a
    // real buyer, and forbidding that would forbid the evidence.
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) accumulator.push(child);
  }
  return accumulator;
}

/**
 * Scan a repository-shaped directory for protocol-purity violations.
 *
 * @param root - Repository root
 * @returns Files scanned and any violations found
 */
export function checkProtocolPurity(root: string): PurityReport {
  const violations: Violation[] = [];
  let scanned = 0;

  for (const scope of SCOPES) {
    const files = listSources(join(root, scope.directory), []);
    scanned += files.length;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");

      for (const rule of scope.rules) {
        for (const [index, line] of lines.entries()) {
          // A line that merely *describes* the prohibition is not a violation. The comment
          // marker keeps the gate from firing on the documentation that explains it, which is
          // otherwise the first thing it flags.
          const trimmed = line.trim();
          if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;

          if (rule.pattern.test(line)) {
            violations.push({
              file: relative(root, file).split(sep).join("/"),
              line: index + 1,
              rule: rule.id,
              why: rule.why,
              text: trimmed.slice(0, 120),
            });
          }
        }
      }
    }
  }

  return { scanned, violations };
}

function main(): void {
  const { values } = parseArgs({
    options: { root: { type: "string" }, json: { type: "boolean", default: false } },
  });

  const root = resolve(values.root ?? REPO_ROOT);
  const report = checkProtocolPurity(root);

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `protocol purity: scanned ${String(report.scanned)} source file(s) under ${root}\n`,
    );
    for (const violation of report.violations) {
      process.stdout.write(
        `  VIOLATION ${violation.file}:${String(violation.line)} [${violation.rule}]\n` +
          `    ${violation.text}\n` +
          `    ${violation.why}\n`,
      );
    }
  }

  if (report.violations.length > 0) {
    process.stderr.write(
      `\nprotocol purity FAILED: ${String(report.violations.length)} violation(s).\n` +
        "Movo composes the x402 and Stellar protocol layers and reimplements no part of them.\n" +
        "See CONTRIBUTING.md hard rule 1, ADR-0004 and ADR-0007.\n",
    );
    process.exit(1);
  }

  process.stdout.write("protocol purity PASSED: no protocol primitive is reimplemented.\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
