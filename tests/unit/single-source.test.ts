import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCS_BASE_URL, MOVO_ERROR_CODES } from "../../packages/core/src/errors/registry.ts";

/**
 * Single-source constants, and the tests that keep them single.
 *
 * The lesson these encode came from the M0 scope rename: a value written out in two places
 * does not stay in two places for long, and when the copies diverge the one that is *checked*
 * keeps reporting success. The rule adopted afterwards is that a value with more than one
 * consumer is exported from exactly one module, and a test asserts nothing else spells it out.
 *
 * `scope-drift.test.ts` covers `MOVO_SCOPE`. This file covers the other two: the error
 * documentation base URL (Spec Amendment 002 §4) and the resolved Zod major (spec §1.13).
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const REGISTRY = join("packages", "core", "src", "errors", "registry.ts");

function listSources(directory: string, accumulator: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return accumulator;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const child = join(directory, entry);
    if (statSync(child).isDirectory()) {
      listSources(child, accumulator);
      continue;
    }
    if (entry.endsWith(".ts")) accumulator.push(child);
  }
  return accumulator;
}

describe("the error docs base URL is written in exactly one place", () => {
  it("appears in registry.ts and nowhere else in the sources", () => {
    const files = [
      ...listSources(join(REPO_ROOT, "packages"), []),
      ...listSources(join(REPO_ROOT, "scripts"), []),
    ];

    const offenders = files
      .filter((file) => readFileSync(file, "utf8").includes(DOCS_BASE_URL))
      .map((file) => relative(REPO_ROOT, file).split(sep).join("/"))
      .filter((file) => file !== REGISTRY.split(sep).join("/"));

    expect(offenders).toEqual([]);
  });

  it("is what every registry code's URL is built from", () => {
    // Amendment 002 §4's stated test: acquiring a domain later must be a one-line change, not
    // a sweep across a registry holding dozens of codes.
    for (const code of MOVO_ERROR_CODES) {
      expect(`${DOCS_BASE_URL}/errors/${code}`.startsWith(DOCS_BASE_URL)).toBe(true);
    }
  });

  it("resolves to somewhere real rather than a placeholder", () => {
    // An error message pointing at a 404 is worse than one pointing nowhere: it spends the
    // reader's trust before it spends their time.
    expect(DOCS_BASE_URL).toMatch(/^https:\/\//);
    expect(DOCS_BASE_URL).not.toContain("example.com");
    expect(DOCS_BASE_URL).not.toContain("TODO");
  });
});

describe("zod resolves to exactly one copy", () => {
  const store = join(REPO_ROOT, "node_modules", ".pnpm");

  const resolutions = readdirSync(store).filter((entry) => /^zod@\d/.test(entry));

  it("finds zod installed", () => {
    expect(resolutions.length).toBeGreaterThan(0);
  });

  it("has a single resolution, so types do not disagree across the boundary", () => {
    // Two zod majors either side of the narrow waist produce type errors that read as if Movo
    // and upstream disagree about a schema when in fact they agree and the packages differ.
    expect(resolutions).toHaveLength(1);
  });

  it("matches the major @x402/core depends on", () => {
    const upstream = JSON.parse(
      readFileSync(
        join(store, "@x402+core@2.21.0", "node_modules", "@x402", "core", "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };

    const declared = upstream.dependencies?.["zod"];
    expect(declared).toBeDefined();

    const declaredMajor = declared?.replace(/^[^\d]*/, "").split(".")[0];
    const resolvedMajor = resolutions[0]?.replace("zod@", "").split(".")[0];
    expect(resolvedMajor).toBe(declaredMajor);
  });
});
