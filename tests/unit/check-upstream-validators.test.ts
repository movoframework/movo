import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUpstreamValidators } from "../../scripts/check-upstream-validators.ts";
import { materialiseFixture } from "../support/materialise-fixture.ts";

/**
 * AC4.8, proven to fire.
 *
 * The criterion — "every validation call resolves to an upstream export" — would have failed on
 * four of the discarded WIP's eight files (Spec Amendment 007 §7). The gate that encodes it is
 * therefore exactly the kind that must be watched failing before it can be trusted.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-upstream-validators.ts");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "upstream-validators");

let clean: ReturnType<typeof materialiseFixture>;
let violating: ReturnType<typeof materialiseFixture>;

beforeAll(() => {
  clean = materialiseFixture(join(FIXTURES, "clean"));
  violating = materialiseFixture(join(FIXTURES, "violating"));
});

afterAll(() => {
  clean.cleanup();
  violating.cleanup();
});

function runGate(root: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--root", root], {
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

describe("the real packages/bazaar", () => {
  it("passes AC4.8", () => {
    expect(checkUpstreamValidators(REPO_ROOT).violations).toEqual([]);
  });

  it("actually delegates, rather than passing by validating nothing", () => {
    // The positive half of the criterion. A package that stopped calling upstream entirely
    // would satisfy every negative rule while doing no validation at all.
    const report = checkUpstreamValidators(REPO_ROOT);

    expect(report.scanned).toBeGreaterThan(0);
    expect(report.upstreamImports).toContain("validateRouteTemplate");
    expect(report.upstreamImports).toContain("sanitizeResourceServiceMetadata");
    expect(report.upstreamImports).toContain("validateDiscoveryExtensionSpec");
    expect(report.upstreamImports).toContain("validateDiscoveryExtension");
  });
});

describe("proof of failure", () => {
  it("catches a Movo-owned validator function", () => {
    const violations = checkUpstreamValidators(violating.path).violations;

    expect(violations.map((violation) => violation.rule)).toContain("declared-validator");
    expect(violations.find((violation) => violation.rule === "declared-validator")?.text).toContain(
      "isValidServiceName",
    );
  });

  it("catches a re-derived character-class regex", () => {
    expect(checkUpstreamValidators(violating.path).violations.map((v) => v.rule)).toContain(
      "regex-literal",
    );
  });

  it("catches restated length and count limits", () => {
    expect(checkUpstreamValidators(violating.path).violations.map((v) => v.rule)).toContain(
      "constraint-constant",
    );
  });

  it("exits non-zero on the violating fixture", () => {
    const result = runGate(violating.path);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("upstream validators FAILED");
    expect(result.stderr).toContain("D3");
  });

  it("fails a package that delegates to nothing at all", () => {
    // The inverse failure, and the one an "absence of violations" check would miss entirely.
    const directory = join(clean.path, "..", "empty", "packages", "bazaar", "src");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "nothing.ts"), "export const x = 1;\n", "utf8");

    try {
      const result = runGate(join(clean.path, "..", "empty"));

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("imports no upstream validator at all");
    } finally {
      rmSync(join(clean.path, "..", "empty"), { force: true, recursive: true });
    }
  });
});

describe("the clean fixture", () => {
  it("passes, so the gate is not merely flagging everything", () => {
    const result = runGate(clean.path);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("upstream validators PASSED");
  });

  it("reports which upstream validators it found", () => {
    const report = checkUpstreamValidators(clean.path);

    expect(report.upstreamImports).toEqual(["isValidIconUrl", "sanitizeTags"]);
  });
});
