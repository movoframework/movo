/**
 * check-licenses — the licence gate.
 *
 * Movo must ship under a permissive licence with no strong copyleft anywhere in the
 * dependency path. The reason is specific and not merely stylistic: a Movo facilitator
 * (spec §8, milestone M6) is designed to be operated as a *network service*, and the AGPL's
 * network clause would extend source-provision obligations to every third party that service
 * serves. SSPL and GPL-2.0/3.0 are excluded on the same reasoning applied to distribution.
 * See spec §1.12 and §14; the OpenZeppelin Relayer family named in CONTRIBUTING.md is the
 * concrete package family this gate exists to keep out.
 *
 * LGPL is warned about but not failed: dynamic linking to an LGPL library from a separate
 * work does not impose source obligations on that work, so it is a judgement call for a
 * reviewer rather than an automatic build failure.
 *
 * Usage:
 *   node scripts/check-licenses.ts                      # the real resolved tree
 *   node scripts/check-licenses.ts --tree <dir>         # any directory of packages
 *   node scripts/check-licenses.ts --json               # machine-readable report
 *
 * `--tree` exists so that the gate can be pointed at tests/fixtures/licenses/*, which is how
 * the gate is proven to fire rather than merely assumed to.
 */

import { readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

/** Licences that fail the build outright. Matched case-insensitively against SPDX ids. */
const DENIED: readonly RegExp[] = [/^AGPL-/i, /^SSPL-/i, /^GPL-2\.0/i, /^GPL-3\.0/i, /^GPL$/i];

/** Licences that are reported but do not fail the build. */
const WARNED: readonly RegExp[] = [/^LGPL-/i, /^UNLICENSED$/i, /^SEE LICENSE/i];

export interface PackageLicence {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly path: string;
}

export interface LicenceReport {
  readonly inspected: number;
  readonly denied: readonly PackageLicence[];
  readonly warned: readonly PackageLicence[];
  readonly unknown: readonly PackageLicence[];
}

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly license?: string | { type?: string };
  readonly licenses?: readonly { readonly type?: string }[];
}

/** Normalise the several shapes npm has used for the licence field into one string. */
export function readLicenceField(manifest: PackageManifest): string {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license.trim() !== "") return license.trim();
  if (license !== null && typeof license === "object" && typeof license.type === "string") {
    return license.type.trim();
  }
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((entry) => entry.type)
      .filter((type): type is string => typeof type === "string" && type.trim() !== "");
    if (types.length > 0) return types.join(" OR ");
  }
  return "";
}

/**
 * Evaluate an SPDX expression against a matcher.
 *
 * The nesting matters for correctness. `(AGPL-3.0 OR MIT)` is a dual licence: a consumer may
 * take the MIT branch, so it is acceptable. `(AGPL-3.0 AND MIT)` imposes both, so it is not.
 * Treating the expression as a flat string would reject the first case and is the usual bug
 * in hand-rolled licence checks.
 */
export function expressionMatches(expression: string, matcher: (id: string) => boolean): boolean {
  const trimmed = expression.trim();
  if (trimmed === "") return false;

  const stripped = stripOuterParens(trimmed);
  const orParts = splitTopLevel(stripped, "OR");
  if (orParts.length > 1) {
    // Denied only if *every* alternative is denied — one clean branch is enough.
    return orParts.every((part) => expressionMatches(part, matcher));
  }

  const andParts = splitTopLevel(stripped, "AND");
  if (andParts.length > 1) {
    // Denied if *any* conjunct is denied — all obligations apply simultaneously.
    return andParts.some((part) => expressionMatches(part, matcher));
  }

  return matcher(stripped.replace(/\s+WITH\s+.*$/i, "").trim());
}

function stripOuterParens(value: string): string {
  let current = value.trim();
  while (current.startsWith("(") && current.endsWith(")")) {
    let depth = 0;
    let balanced = true;
    for (let index = 0; index < current.length; index += 1) {
      const character = current[index];
      if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        balanced = false;
        break;
      }
    }
    if (!balanced) return current;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function splitTopLevel(value: string, operator: "OR" | "AND"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const upper = value.toUpperCase();
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth !== 0) continue;
    const isBoundary =
      upper.startsWith(` ${operator} `, index) ||
      (index === 0 && upper.startsWith(`${operator} `, index));
    if (isBoundary && index > 0) {
      parts.push(value.slice(start, index));
      start = index + operator.length + 2;
      index = start - 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * Collect every package manifest beneath `treeRoot`.
 *
 * pnpm's isolated node_modules puts the real packages under `node_modules/.pnpm/`, so the
 * walk deliberately does not skip dot-directories. Symlinks are not followed, which means
 * each physical package is inspected exactly once rather than once per symlink into it.
 */
export function collectPackages(treeRoot: string): PackageLicence[] {
  const found: PackageLicence[] = [];
  const seen = new Set<string>();

  const walk = (directory: string, depth: number): void => {
    if (depth > 12) return;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }

    if (entries.includes("package.json")) {
      const manifestPath = join(directory, "package.json");
      const manifest = readManifest(manifestPath);
      if (manifest !== null && typeof manifest.name === "string") {
        const key = `${manifest.name}@${manifest.version ?? "0.0.0"}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push({
            name: manifest.name,
            version: manifest.version ?? "0.0.0",
            licence: readLicenceField(manifest),
            path: relative(REPO_ROOT, directory) || ".",
          });
        }
      }
    }

    for (const entry of entries) {
      const child = join(directory, entry);
      let stats: Stats | undefined;
      try {
        stats = statSync(child, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (stats === undefined || !stats.isDirectory()) continue;
      walk(child, depth + 1);
    }
  };

  walk(treeRoot, 0);
  return found;
}

function readManifest(path: string): PackageManifest | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
  } catch {
    return null;
  }
}

export function auditTree(treeRoot: string): LicenceReport {
  const packages = collectPackages(treeRoot);
  const denied: PackageLicence[] = [];
  const warned: PackageLicence[] = [];
  const unknown: PackageLicence[] = [];

  for (const entry of packages) {
    if (entry.licence === "") {
      unknown.push(entry);
      continue;
    }
    if (expressionMatches(entry.licence, (id) => DENIED.some((pattern) => pattern.test(id)))) {
      denied.push(entry);
      continue;
    }
    if (expressionMatches(entry.licence, (id) => WARNED.some((pattern) => pattern.test(id)))) {
      warned.push(entry);
    }
  }

  return { inspected: packages.length, denied, warned, unknown };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      tree: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const treeRoot = resolve(values.tree ?? join(REPO_ROOT, "node_modules"));
  const report = auditTree(treeRoot);

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`licence gate: inspected ${report.inspected} packages in ${treeRoot}\n`);
    for (const entry of report.unknown) {
      process.stdout.write(`  unknown  ${entry.name}@${entry.version} (${entry.path})\n`);
    }
    for (const entry of report.warned) {
      process.stdout.write(
        `  warn     ${entry.name}@${entry.version} — ${entry.licence} (${entry.path})\n`,
      );
    }
    for (const entry of report.denied) {
      process.stdout.write(
        `  DENIED   ${entry.name}@${entry.version} — ${entry.licence} (${entry.path})\n`,
      );
    }
  }

  if (report.denied.length > 0) {
    process.stderr.write(
      `\nlicence gate FAILED: ${report.denied.length} package(s) carry a prohibited licence.\n` +
        "Movo's facilitator is operated as a network service, so AGPL/SSPL/GPL in the\n" +
        "dependency path would extend copyleft obligations to third parties. See\n" +
        "CONTRIBUTING.md and spec §1.12. Remove the dependency; relicensing is not an option.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `licence gate PASSED: 0 prohibited, ${report.warned.length} warned, ` +
      `${report.unknown.length} without a declared licence.\n`,
  );
}

// Run only when Node was asked to execute this file. Tests import `auditTree` directly.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
