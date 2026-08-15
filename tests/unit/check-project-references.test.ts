import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkProjectReferences } from "../../scripts/check-project-references.ts";
import { materialiseFixture } from "../support/materialise-fixture.ts";

/**
 * Proven to fire (Amendment 001 §5).
 *
 * The `missing` fixture is the M4 defect itself: `packages/testing` depended on
 * `packages/server` and referenced only `packages/core`, so `tsc --build` scheduled it first
 * and its import of the server's declarations did not resolve. That passed every local run,
 * because a warm tree already had the declarations on disk, and only failed on CI's clean
 * checkout. A gate for it is worth nothing unless it is watched failing on that exact shape.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-project-references.ts");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "project-references");

let clean: ReturnType<typeof materialiseFixture>;
let missing: ReturnType<typeof materialiseFixture>;
let dangling: ReturnType<typeof materialiseFixture>;

beforeAll(() => {
  clean = materialiseFixture(join(FIXTURES, "clean"));
  missing = materialiseFixture(join(FIXTURES, "missing"));
  dangling = materialiseFixture(join(FIXTURES, "dangling"));
});

afterAll(() => {
  clean.cleanup();
  missing.cleanup();
  dangling.cleanup();
});

function runGate(root: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--root", root], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string; signal?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? "",
      stderr: `${failure.stderr ?? ""}${failure.signal === undefined ? "" : `\n[killed by signal ${failure.signal}]`}`,
    };
  }
}

describe("the real repository", () => {
  it("passes", () => {
    expect(checkProjectReferences(REPO_ROOT).violations).toEqual([]);
  });

  it("actually found projects, rather than passing because it looked at none", () => {
    expect(checkProjectReferences(REPO_ROOT).scanned).toBeGreaterThan(5);
  });

  it("actually found dependency edges, rather than passing because there were none to check", () => {
    // Without this the gate reports success on a repository where it resolved no workspace
    // dependency at all — which is what a broken manifest reader looks like from outside.
    expect(checkProjectReferences(REPO_ROOT).edges).toBeGreaterThan(5);
  });
});

describe("proof of failure", () => {
  it("catches a workspace dependency with no matching reference", () => {
    const report = checkProjectReferences(missing.path);
    const violation = report.violations.find((candidate) => candidate.rule === "missing-reference");

    expect(violation).toBeDefined();
    expect(violation?.project).toBe("packages/testing");
    expect(violation?.detail).toContain("packages/server");
  });

  it("catches a reference to a package that is not a declared dependency", () => {
    const report = checkProjectReferences(dangling.path);
    const violation = report.violations.find(
      (candidate) => candidate.rule === "dangling-reference",
    );

    expect(violation).toBeDefined();
    expect(violation?.detail).toContain("packages/stellar");
  });

  it("catches a tsconfig it cannot read, rather than treating it as having no references", () => {
    const report = checkProjectReferences(dangling.path);
    expect(report.violations.map((violation) => violation.rule)).toContain("unreadable-tsconfig");
  });

  it("exits non-zero and names the rule", () => {
    const result = runGate(missing.path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("project references FAILED");
    expect(result.stderr).toContain("missing-reference");
  });
});

describe("the clean fixture", () => {
  it("passes, so the gate is not simply flagging every project", () => {
    const result = runGate(clean.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("project references PASSED");
  });

  it("resolved its dependency edges", () => {
    // The clean tree declares three workspace edges. A gate reporting zero here would pass
    // this fixture by failing to read manifests rather than by finding them correct.
    expect(checkProjectReferences(clean.path).edges).toBe(3);
  });

  it("ignores a devDependency that is not a workspace package", () => {
    // `express` is a real devDependency of the testing fixture and must never be expected as
    // a project reference.
    expect(checkProjectReferences(clean.path).violations).toEqual([]);
  });
});
