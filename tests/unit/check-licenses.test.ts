import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditTree, expressionMatches, readLicenceField } from "../../scripts/check-licenses.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-licenses.ts");
const CLEAN_TREE = join(REPO_ROOT, "tests", "fixtures", "licenses", "clean-tree");
const AGPL_TREE = join(REPO_ROOT, "tests", "fixtures", "licenses", "agpl-tree");

interface SpawnResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(tree: string): SpawnResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--tree", tree], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

describe("licence expression evaluation", () => {
  it("denies a bare AGPL licence", () => {
    expect(expressionMatches("AGPL-3.0-or-later", (id) => id.startsWith("AGPL"))).toBe(true);
  });

  it("accepts a dual licence that offers a permissive branch", () => {
    // (AGPL OR MIT) lets a consumer take MIT, so it must not fail the build.
    expect(expressionMatches("(AGPL-3.0-only OR MIT)", (id) => id.startsWith("AGPL"))).toBe(false);
  });

  it("denies a conjunction that includes a prohibited licence", () => {
    expect(expressionMatches("AGPL-3.0-only AND MIT", (id) => id.startsWith("AGPL"))).toBe(true);
  });

  it("ignores a WITH exception clause when matching the identifier", () => {
    expect(
      expressionMatches("GPL-3.0-only WITH Classpath-exception-2.0", (id) =>
        id.startsWith("GPL-3"),
      ),
    ).toBe(true);
  });

  it("reads the legacy array-shaped licences field", () => {
    expect(readLicenceField({ licenses: [{ type: "BSD-3-Clause" }] })).toBe("BSD-3-Clause");
  });
});

describe("licence gate", () => {
  it("passes on a permissive fixture tree and warns rather than fails on LGPL", () => {
    const report = auditTree(CLEAN_TREE);
    expect(report.denied).toHaveLength(0);
    expect(report.warned.map((entry) => entry.name)).toContain("lgpl-warned");
  });

  it("fails on the planted AGPL fixture", () => {
    const report = auditTree(AGPL_TREE);
    expect(report.denied.map((entry) => entry.name)).toContain("planted-agpl");
  });

  it("walks nested directories so a transitive plant cannot hide", () => {
    const report = auditTree(AGPL_TREE);
    expect(report.denied.map((entry) => entry.name)).toContain("planted-sspl");
  });

  it("exits 0 on the clean fixture tree", () => {
    const result = runGate(CLEAN_TREE);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("licence gate PASSED");
  });

  it("exits non-zero on the AGPL fixture tree", () => {
    const result = runGate(AGPL_TREE);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("licence gate FAILED");
  });
});
