/**
 * check-track-isolation — the two-track boundary gate.
 *
 * Movo is one repository with two tracks (spec §0.4, §1.8 D8). The core track
 * (`packages/{core,server,stellar,bazaar,client,testing,cli}` and `create-movo-app`) ships
 * v0.1.0 regardless of what happens to the SCF track (`packages/{facilitator,catalog,mcp}`).
 * That promise only holds if the dependency direction is one-way, so this gate fails the
 * build if a core-track package reaches into an SCF-track package — by module specifier, by
 * relative path, or by declared dependency.
 *
 * Without it the guarantee is a convention, and conventions do not survive a deadline.
 * See spec §4.2 invariant 4 and §16.9.
 *
 * Usage:
 *   node scripts/check-track-isolation.ts                 # this repository
 *   node scripts/check-track-isolation.ts --root <dir>    # any repository-shaped directory
 *   node scripts/check-track-isolation.ts --json
 *
 * `--root` exists so the gate can be pointed at tests/fixtures/track-isolation/*, which is
 * how it is proven to fire.
 */

import { readdirSync, readFileSync, type Stats, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");

const CORE_TRACK: readonly string[] = [
  "core",
  "server",
  "stellar",
  "bazaar",
  "client",
  "testing",
  "cli",
  "create-movo-app",
];

const SCF_TRACK: readonly string[] = ["facilitator", "catalog", "mcp"];

/** `@movo/facilitator`, `@movo/catalog`, `@movo/mcp` and any of their subpaths. */
const SCF_SPECIFIER = new RegExp(`^@movo/(${SCF_TRACK.join("|")})(/|$)`);

const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly reason: string;
}

export interface IsolationReport {
  readonly scanned: number;
  readonly violations: readonly Violation[];
}

/**
 * Extract module specifiers from a source file.
 *
 * This is a lexical scan, not a parse. That is a deliberate trade: a parser would add a
 * dependency to a gate whose whole purpose is to police dependencies, and the failure mode
 * of the lexical scan is a false positive on a specifier mentioned inside a comment — which
 * a reviewer resolves in seconds, whereas a false negative would silently defeat the gate.
 */
export function extractSpecifiers(source: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = [];
  const patterns: readonly RegExp[] = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const specifier = match[1];
      if (specifier !== undefined) {
        const line = source.slice(0, match.index).split("\n").length;
        found.push({ specifier, line });
      }
      match = pattern.exec(source);
    }
  }

  return found;
}

function listSourceFiles(directory: string, accumulator: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const child = join(directory, entry);
    let stats: Stats | undefined;
    try {
      stats = statSync(child, { throwIfNoEntry: false });
    } catch {
      continue;
    }
    if (stats === undefined) continue;
    if (stats.isDirectory()) {
      listSourceFiles(child, accumulator);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) accumulator.push(child);
  }
}

export function checkTrackIsolation(root: string): IsolationReport {
  const violations: Violation[] = [];
  let scanned = 0;

  for (const packageDirectory of CORE_TRACK) {
    const packageRoot = join(root, "packages", packageDirectory);
    const stats = statSync(packageRoot, { throwIfNoEntry: false });
    if (stats === undefined || !stats.isDirectory()) continue;

    const manifestViolation = checkManifest(packageRoot, root);
    if (manifestViolation !== null) violations.push(manifestViolation);

    const files: string[] = [];
    listSourceFiles(packageRoot, files);
    scanned += files.length;

    for (const file of files) {
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const { specifier, line } of extractSpecifiers(source)) {
        const reason = classify(specifier, file, root);
        if (reason !== null) {
          violations.push({ file: relative(root, file), line, specifier, reason });
        }
      }
    }
  }

  return { scanned, violations };
}

function classify(specifier: string, file: string, root: string): string | null {
  if (SCF_SPECIFIER.test(specifier)) {
    return `core-track source imports the SCF-track package "${specifier}"`;
  }
  if (specifier.startsWith(".")) {
    const resolved = resolve(join(file, ".."), specifier);
    const fromRoot = relative(root, resolved).split(sep).join("/");
    for (const scfPackage of SCF_TRACK) {
      if (fromRoot === `packages/${scfPackage}` || fromRoot.startsWith(`packages/${scfPackage}/`)) {
        return `core-track source reaches into packages/${scfPackage} by relative path`;
      }
    }
  }
  return null;
}

function checkManifest(packageRoot: string, root: string): Violation | null {
  const manifestPath = join(packageRoot, "package.json");
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }

  let manifest: { [key: string]: unknown };
  try {
    manifest = JSON.parse(raw) as { [key: string]: unknown };
  } catch {
    return null;
  }

  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const block = manifest[field];
    if (block === null || typeof block !== "object") continue;
    for (const dependency of Object.keys(block)) {
      if (SCF_SPECIFIER.test(dependency)) {
        return {
          file: relative(root, manifestPath),
          line: 1,
          specifier: dependency,
          reason: `core-track package.json declares "${dependency}" in ${field}`,
        };
      }
    }
  }

  return null;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const root = resolve(values.root ?? REPO_ROOT);
  const report = checkTrackIsolation(root);

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `track isolation: scanned ${report.scanned} core-track source file(s) under ${root}\n`,
    );
    for (const violation of report.violations) {
      process.stdout.write(
        `  VIOLATION ${violation.file}:${violation.line} — ${violation.reason}\n`,
      );
    }
  }

  if (report.violations.length > 0) {
    process.stderr.write(
      `\ntrack isolation FAILED: ${report.violations.length} violation(s).\n` +
        "The core track must ship v0.1.0 whether or not the SCF track proceeds, so the\n" +
        "dependency direction is one-way: SCF packages may depend on core packages, never\n" +
        "the reverse. See spec §1.8 D8 and §4.2 invariant 4.\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    "track isolation PASSED: no core-track package references an SCF package.\n",
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) main();
