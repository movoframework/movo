/**
 * Reading what is installed and what the compatibility matrix records.
 *
 * This file does the **I/O** for the pin-drift check; the check itself — what counts as drift,
 * how serious it is, what to do — is `checkPinDrift` in `@movoframework/core`, which is a pure
 * function over the pairs this file assembles. That split is the M5 architectural rule applied
 * honestly: a downstream project wanting the same gate in its own CI imports `checkPinDrift`,
 * and only the environment-reading half is CLI-shaped.
 *
 * `docs/COMPATIBILITY.md` is parsed rather than imported because it is a generated document
 * (spec §1.14) whose whole value is being evidence of a real environment at a real moment. A
 * machine-readable sidecar would be a second artefact to keep in sync with the first.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { PinComparison } from "@movoframework/core";

/** The `@x402/*` packages Movo composes over. */
export const X402_PACKAGES: readonly string[] = [
  "@x402/core",
  "@x402/express",
  "@x402/extensions",
  "@x402/fetch",
  "@x402/stellar",
];

/** Where the matrix lives, relative to a repository root. */
export const COMPATIBILITY_PATH = "docs/COMPATIBILITY.md";

/**
 * Parse the installed-versions table out of `docs/COMPATIBILITY.md`.
 *
 * The table's rows look like:
 *
 * ```text
 * | `@x402/core` | `2.21.0` |
 * ```
 *
 * A row that records more than one version — which the generator emits when a workspace has
 * resolved two copies — is deliberately **not** collapsed to the first. Two installed copies is
 * itself the drift worth reporting, so the raw text is kept and compared as a whole.
 *
 * @param markdown - The file contents
 * @returns Package name → documented version text
 */
export function parseDocumentedPins(markdown: string): Map<string, string> {
  const pins = new Map<string, string>();
  const row = /^\|\s*`(@x402\/[a-z0-9-]+)`\s*\|\s*(.+?)\s*\|\s*$/gm;

  let match = row.exec(markdown);
  while (match !== null) {
    const name = match[1];
    const versions = match[2];
    if (name !== undefined && versions !== undefined) {
      // Strip the backticks the generator wraps each version in, and normalise the separator so
      // `` `1.0.0`, `2.0.0` `` and `1.0.0, 2.0.0` compare equal.
      pins.set(
        name,
        versions
          .split(",")
          .map((version) => version.replaceAll("`", "").trim())
          .filter((version) => version.length > 0)
          .join(", "),
      );
    }
    match = row.exec(markdown);
  }

  return pins;
}

/**
 * Read an installed package's version by resolving its manifest from a starting directory.
 *
 * `createRequire` rather than `import.meta.resolve` because a package's `exports` map need not
 * expose `./package.json`, and every `@x402/*` package's does not. Resolving the main entry and
 * walking up to the nearest manifest works regardless of what the export map permits.
 *
 * @param name - Package name
 * @param from - Directory to resolve from
 * @returns The installed version, or undefined when the package is not resolvable
 */
export function installedVersion(name: string, from: string): string | undefined {
  const require = createRequire(join(resolve(from), "noop.js"));

  let current: string;
  try {
    current = dirname(require.resolve(name));
  } catch {
    return undefined;
  }

  for (;;) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        const record = parsed as { name?: unknown; version?: unknown };
        // Guard against stopping at a nested manifest belonging to a different package.
        if (record.name === name && typeof record.version === "string") return record.version;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Locate `docs/COMPATIBILITY.md` by walking up from a directory.
 *
 * @param from - Where to start
 * @returns The absolute path, or undefined
 */
export function findCompatibilityMatrix(from: string): string | undefined {
  let current = resolve(from);

  for (;;) {
    const candidate = join(current, COMPATIBILITY_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Assemble the installed-versus-documented pairs `checkPinDrift` compares.
 *
 * Union of both sides rather than intersection: a package installed but absent from the matrix,
 * and one documented but not installed, are both drift, and an intersection would silently drop
 * exactly those two cases.
 *
 * @param from - Directory to resolve packages and the matrix from
 * @returns One comparison per package known to either side, name-sorted
 */
export function collectPinComparisons(from: string): PinComparison[] {
  const matrixPath = findCompatibilityMatrix(from);
  const documented =
    matrixPath === undefined
      ? new Map<string, string>()
      : parseDocumentedPins(readFileSync(matrixPath, "utf8"));

  const names = new Set<string>([...X402_PACKAGES, ...documented.keys()]);

  return [...names].sort().map((name) => ({
    name,
    installed: installedVersion(name, from),
    documented: documented.get(name),
  }));
}
