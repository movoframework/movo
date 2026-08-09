import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The narrow-waist rule is the single most load-bearing gate in the repository: it is what
 * confines `@x402/*` churn to one directory (ADR-0004, spec §4.2 invariant 3). A lint rule
 * nobody has seen fail is indistinguishable from a lint rule that does not work, so this
 * suite writes a real violation to disk, runs the real linter over it, and asserts the real
 * diagnostic — then removes the file again.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const BIOME = join(REPO_ROOT, "node_modules", "@biomejs", "biome", "bin", "biome");

const FORBIDDEN_PROBE = join(REPO_ROOT, "packages", "stellar", "src", "narrow-waist-probe.ts");
const PERMITTED_DIRECTORY = join(REPO_ROOT, "packages", "core", "src", "protocol");
const PERMITTED_PROBE = join(PERMITTED_DIRECTORY, "narrow-waist-probe.ts");

const PROBE_SOURCE = [
  'import type { PaymentRequirements } from "@x402/core";',
  "",
  "export const probe: PaymentRequirements | undefined = undefined;",
  "",
].join("\n");

interface LintResult {
  readonly status: number;
  readonly output: string;
}

function lint(file: string): LintResult {
  try {
    const stdout = execFileSync(process.execPath, [BIOME, "lint", file], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

afterEach(() => {
  rmSync(FORBIDDEN_PROBE, { force: true });
  rmSync(PERMITTED_PROBE, { force: true });
  rmSync(PERMITTED_DIRECTORY, { force: true, recursive: true });
});

describe("the x402 narrow waist", () => {
  it("fails lint when a package outside core/src/protocol imports @x402/*", () => {
    writeFileSync(FORBIDDEN_PROBE, PROBE_SOURCE, "utf8");
    const result = lint(FORBIDDEN_PROBE);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("noRestrictedImports");
    expect(result.output).toContain("MOVO NARROW WAIST");
  });

  it("permits the same import inside packages/core/src/protocol", () => {
    mkdirSync(PERMITTED_DIRECTORY, { recursive: true });
    writeFileSync(PERMITTED_PROBE, PROBE_SOURCE, "utf8");
    const result = lint(PERMITTED_PROBE);

    expect(result.output).not.toContain("MOVO NARROW WAIST");
    expect(result.status).toBe(0);
  });

  it("catches a deep subpath import, not only the package root", () => {
    writeFileSync(
      FORBIDDEN_PROBE,
      'import { ExactStellarScheme } from "@x402/stellar/exact/server";\n\n' +
        "export const probe = ExactStellarScheme;\n",
      "utf8",
    );
    const result = lint(FORBIDDEN_PROBE);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("MOVO NARROW WAIST");
  });
});
