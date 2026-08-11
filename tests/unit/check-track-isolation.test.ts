import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkTrackIsolation, extractSpecifiers } from "../../scripts/check-track-isolation.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-track-isolation.ts");
const CLEAN = join(REPO_ROOT, "tests", "fixtures", "track-isolation", "clean");
const VIOLATING = join(REPO_ROOT, "tests", "fixtures", "track-isolation", "violating");

interface SpawnResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(root: string): SpawnResult {
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

describe("specifier extraction", () => {
  it("finds static, side-effect, dynamic and require specifiers", () => {
    const source = [
      'import { a } from "@movoframework/core";',
      'import "./side-effect.js";',
      'const b = await import("@movoframework/catalog");',
      'const c = require("@movoframework/mcp");',
    ].join("\n");

    expect(
      extractSpecifiers(source)
        .map((entry) => entry.specifier)
        .sort(),
    ).toEqual([
      "./side-effect.js",
      "@movoframework/catalog",
      "@movoframework/core",
      "@movoframework/mcp",
    ]);
  });
});

describe("track isolation gate", () => {
  it("passes on a fixture where the dependency direction is one-way", () => {
    const report = checkTrackIsolation(CLEAN);
    expect(report.violations).toHaveLength(0);
    expect(report.scanned).toBeGreaterThan(0);
  });

  it("catches a core-track package importing an SCF-track package by name", () => {
    const report = checkTrackIsolation(VIOLATING);
    expect(report.violations.map((violation) => violation.specifier)).toContain(
      "@movoframework/catalog",
    );
  });

  it("catches a core-track package reaching into the SCF track by relative path", () => {
    const report = checkTrackIsolation(VIOLATING);
    const reasons = report.violations.map((violation) => violation.reason);
    expect(reasons.some((reason) => reason.includes("by relative path"))).toBe(true);
  });

  it("catches an SCF dependency declared in a core-track package.json", () => {
    const report = checkTrackIsolation(VIOLATING);
    const reasons = report.violations.map((violation) => violation.reason);
    expect(reasons.some((reason) => reason.includes("package.json declares"))).toBe(true);
  });

  it("exits 0 on the clean fixture", () => {
    const result = runGate(CLEAN);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("track isolation PASSED");
  });

  it("exits non-zero on the violating fixture", () => {
    const result = runGate(VIOLATING);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("track isolation FAILED");
  });

  it("passes on the real repository", () => {
    expect(checkTrackIsolation(REPO_ROOT).violations).toHaveLength(0);
  });
});
