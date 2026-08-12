import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MOVO_SCOPE,
  movoPackageName,
  UNSCOPED_PACKAGE_DIRECTORIES,
} from "../../packages/core/src/identity.ts";

/**
 * The gate that stops the M0 scope rename from happening twice.
 *
 * When the project changed npm scope, the track-isolation check held the old scope as a
 * literal in its pattern, and its fixtures held it again independently. The rename updated
 * the fixtures, so the proof-of-failure test stayed green — while the gate's pattern matched
 * nothing that existed in real code any more. The gate reported success on a repository it
 * was no longer inspecting.
 *
 * Two assertions close that hole for good:
 *
 *  1. **The constant describes reality.** Every workspace package publishes under
 *     {@link MOVO_SCOPE}, so a rename that misses a manifest fails here rather than silently
 *     dividing the repository into two naming worlds.
 *  2. **Nothing re-spells it.** No gate, gate fixture or test writes the scope out; they all
 *     import it. A rename is then a one-line edit whose blast radius is mechanical.
 *
 * Production import specifiers are excluded from (2) because an import specifier must be a
 * literal — there is no way to derive one. Assertion (1) is what keeps those honest.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const PACKAGES_DIRECTORY = join(REPO_ROOT, "packages");

/**
 * Directories whose files must import the scope rather than spell it out: the gates, the
 * fixtures those gates are proven against, and the tests.
 */
const DERIVE_ONLY_ROOTS: readonly string[] = ["scripts", "tests"];

/** The one file allowed to contain the literal. */
const SINGLE_SOURCE_FILE = join("packages", "core", "src", "identity.ts");

const SCANNED_EXTENSIONS: readonly string[] = [
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".json",
  ".tmpl",
];

function listFiles(directory: string, accumulator: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const child = join(directory, entry);
    if (statSync(child).isDirectory()) {
      listFiles(child, accumulator);
      continue;
    }
    if (SCANNED_EXTENSIONS.some((extension) => entry.endsWith(extension))) accumulator.push(child);
  }
  return accumulator;
}

/**
 * Strip module specifiers before scanning.
 *
 * An import specifier has to be a literal — there is no way to derive one — so a package that
 * legitimately depends on another must write the scope. That case is covered instead by the
 * manifest assertion above, which pins every published name to `MOVO_SCOPE`.
 *
 * Everything else is still caught: a pattern built from the scope, a fixture that hard-codes it,
 * an assertion comparing against it. Those are the copies that drift, and they are the ones the
 * M0 rename actually broke.
 *
 * @param source - File contents
 * @returns The contents with `import`/`export … from "…"` specifiers removed
 */
function withoutImportSpecifiers(source: string): string {
  return source
    .replace(/\bfrom\s*["'][^"']*["']/g, "")
    .replace(/\bimport\s*\(\s*["'][^"']*["']\s*\)/g, "")
    .replace(/\bimport\s*["'][^"']*["']/g, "")
    .replace(/\brequire\s*\(\s*["'][^"']*["']\s*\)/g, "");
}

function readManifestName(packageDirectory: string): string {
  const raw = readFileSync(join(PACKAGES_DIRECTORY, packageDirectory, "package.json"), "utf8");
  return (JSON.parse(raw) as { name: string }).name;
}

const packageDirectories: readonly string[] = readdirSync(PACKAGES_DIRECTORY).filter((entry) =>
  statSync(join(PACKAGES_DIRECTORY, entry)).isDirectory(),
);

describe("the npm scope is single-sourced", () => {
  it("finds workspace packages to check", () => {
    expect(packageDirectories.length).toBeGreaterThan(0);
  });

  it.each(packageDirectories)("packages/%s publishes under the declared scope", (directory) => {
    const name = readManifestName(directory);
    if (UNSCOPED_PACKAGE_DIRECTORIES.includes(directory)) {
      expect(name).not.toContain(MOVO_SCOPE);
      return;
    }
    expect(name).toBe(movoPackageName(directory));
  });

  it("has every scoped cross-package dependency pointing at the same scope", () => {
    const offenders: string[] = [];
    for (const directory of packageDirectories) {
      const raw = readFileSync(join(PACKAGES_DIRECTORY, directory, "package.json"), "utf8");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
        const block = manifest[field];
        if (block === null || typeof block !== "object") continue;
        for (const dependency of Object.keys(block)) {
          // A dependency that looks like a Movo package but is not under MOVO_SCOPE is
          // exactly the half-finished-rename state this test exists to catch.
          if (/^@movo[a-z]*\//.test(dependency) && !dependency.startsWith(`${MOVO_SCOPE}/`)) {
            offenders.push(`packages/${directory} ${field} -> ${dependency}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no gate, gate fixture or test spelling the scope out", () => {
    const files: string[] = [];
    for (const root of DERIVE_ONLY_ROOTS) listFiles(join(REPO_ROOT, root), files);
    for (const directory of packageDirectories) {
      const source = join(PACKAGES_DIRECTORY, directory, "src");
      if (statSync(source, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
      for (const file of listFiles(source, [])) {
        if (file.endsWith(".test.ts")) files.push(file);
      }
    }

    const offenders = files
      .filter(
        (file) =>
          relative(REPO_ROOT, file).split(sep).join("/") !==
          SINGLE_SOURCE_FILE.split(sep).join("/"),
      )
      .filter((file) => withoutImportSpecifiers(readFileSync(file, "utf8")).includes(MOVO_SCOPE))
      .map((file) => relative(REPO_ROOT, file).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });

  it("still catches the scope written anywhere other than an import", () => {
    // Guards the exemption above from swallowing the rule. A pattern, a fixture literal or an
    // assertion must still be caught; only the module specifier is allowed to spell it out.
    const disguised = [
      `import { thing } from "${MOVO_SCOPE}/core";`,
      `const pattern = new RegExp("^${MOVO_SCOPE}/");`,
    ].join("\n");

    expect(withoutImportSpecifiers(disguised)).not.toContain("from");
    expect(withoutImportSpecifiers(disguised)).toContain(MOVO_SCOPE);
  });
});
