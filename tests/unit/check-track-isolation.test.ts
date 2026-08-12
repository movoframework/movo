import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOVO_SCOPE, movoPackageName } from "../../packages/core/src/identity.ts";
import { checkTrackIsolation, extractSpecifiers } from "../../scripts/check-track-isolation.ts";
import { materialiseFixture } from "../support/materialise-fixture.ts";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-track-isolation.ts");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "track-isolation");

/**
 * The fixtures are committed as `.tmpl` files carrying a `__MOVO_SCOPE__` placeholder and are
 * rendered here from {@link MOVO_SCOPE}. That is deliberate: when the gate's pattern and its
 * proof-of-failure fixtures each spelled the scope out independently, the M0 rename updated
 * one and not the other, and this suite stayed green while the gate matched nothing in real
 * code. Rendering both sides from one constant makes that failure impossible.
 */
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
      `import { a } from "${movoPackageName("core")}";`,
      'import "./side-effect.js";',
      `const b = await import("${movoPackageName("catalog")}");`,
      `const c = require("${movoPackageName("mcp")}");`,
    ].join("\n");

    expect(
      extractSpecifiers(source)
        .map((entry) => entry.specifier)
        .sort(),
    ).toEqual(
      [
        "./side-effect.js",
        movoPackageName("catalog"),
        movoPackageName("core"),
        movoPackageName("mcp"),
      ].sort(),
    );
  });
});

describe("track isolation gate", () => {
  it("passes on a fixture where the dependency direction is one-way", () => {
    const report = checkTrackIsolation(clean.path);
    expect(report.violations).toHaveLength(0);
    expect(report.scanned).toBeGreaterThan(0);
  });

  it("catches a core-track package importing an SCF-track package by name", () => {
    const report = checkTrackIsolation(violating.path);
    expect(report.violations.map((violation) => violation.specifier)).toContain(
      movoPackageName("catalog"),
    );
  });

  it("catches a core-track package reaching into the SCF track by relative path", () => {
    const report = checkTrackIsolation(violating.path);
    const reasons = report.violations.map((violation) => violation.reason);
    expect(reasons.some((reason) => reason.includes("by relative path"))).toBe(true);
  });

  it("catches an SCF dependency declared in a core-track package.json", () => {
    const report = checkTrackIsolation(violating.path);
    const reasons = report.violations.map((violation) => violation.reason);
    expect(reasons.some((reason) => reason.includes("package.json declares"))).toBe(true);
  });

  it("exits 0 on the clean fixture", () => {
    const result = runGate(clean.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("track isolation PASSED");
  });

  it("exits non-zero on the violating fixture", () => {
    const result = runGate(violating.path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("track isolation FAILED");
  });

  it("passes on the real repository", () => {
    expect(checkTrackIsolation(REPO_ROOT).violations).toHaveLength(0);
  });

  it("detects a violation written with the scope as it is actually published today", () => {
    // The regression this guards: the gate derives its pattern from MOVO_SCOPE, and this
    // asserts that the derived pattern still matches source written the way the workspace
    // publishes packages *now*, not the way a fixture happens to spell it.
    const source = `import { x } from "${movoPackageName("facilitator")}";`;
    expect(extractSpecifiers(source)[0]?.specifier).toBe(`${MOVO_SCOPE}/facilitator`);

    const report = checkTrackIsolation(violating.path);
    expect(
      report.violations.every(
        (violation) =>
          violation.specifier.startsWith(MOVO_SCOPE) || violation.specifier.startsWith("."),
      ),
    ).toBe(true);
  });
});
