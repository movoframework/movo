import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAYMENT_HEADERS } from "../../packages/core/src/protocol/index.ts";
import {
  COMPOSITION_RULES,
  CORE_RULES,
  checkProtocolPurity,
} from "../../scripts/check-protocol-purity.ts";
import { materialiseFixture } from "../support/materialise-fixture.ts";

/**
 * AC2.7 and Spec Amendment 003 §1, proven to fire.
 *
 * The gate asserts the project's central claim — that Movo reimplements no protocol primitive —
 * so it is exactly the kind of check that must be watched failing before it can be trusted
 * (Amendment 001 §5). The fixtures are templates rendered from `PAYMENT_HEADERS`, so a rename
 * upstream cannot leave them green while the gate matches nothing.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-protocol-purity.ts");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "protocol-purity");

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

describe("the real repository", () => {
  it("passes", () => {
    expect(checkProtocolPurity(REPO_ROOT).violations).toEqual([]);
  });

  it("actually scans files, rather than passing because it found none", () => {
    // Without this, deleting a scope silently turns the gate into a no-op that reports success.
    expect(checkProtocolPurity(REPO_ROOT).scanned).toBeGreaterThan(10);
  });
});

describe("proof of failure — AC2.7", () => {
  it("catches XDR and transaction construction", () => {
    const report = checkProtocolPurity(violating.path);
    expect(report.violations.map((violation) => violation.rule)).toContain("xdr-construction");
  });

  it("catches signing and key handling", () => {
    const report = checkProtocolPurity(violating.path);
    expect(report.violations.map((violation) => violation.rule)).toContain("signature-handling");
  });

  it("catches a PAYMENT-* header written as a literal", () => {
    const report = checkProtocolPurity(violating.path);
    const header = report.violations.find(
      (violation) => violation.rule === "payment-header-literal",
    );

    expect(header).toBeDefined();
    // Rendered from the constant, so this asserts the gate matches the header name the code
    // actually uses today.
    expect(header?.text).toContain(PAYMENT_HEADERS.signature);
  });

  it("exits non-zero on the violating fixture", () => {
    const result = runGate(violating.path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("protocol purity FAILED");
  });
});

describe("proof of failure — Spec Amendment 003 §1", () => {
  it("catches a direct @stellar/stellar-sdk import in packages/core", () => {
    const report = checkProtocolPurity(violating.path);
    const violation = report.violations.find(
      (candidate) => candidate.rule === "direct-stellar-sdk-import",
    );

    expect(violation).toBeDefined();
    expect(violation?.file).toContain("packages/core");
  });

  it("permits the same import in packages/stellar, which is the package allowed to make it", () => {
    const report = checkProtocolPurity(clean.path);
    expect(report.violations).toEqual([]);
  });
});

describe("the clean fixture", () => {
  it("passes, so the gate is not simply flagging everything", () => {
    const result = runGate(clean.path);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("protocol purity PASSED");
  });

  it("contains files that would trip a naive substring check", () => {
    // The clean fixtures deliberately import the SDK and reference the header constant. A gate
    // that flagged those would be unusable, so this asserts the rules are precise rather than
    // merely strict.
    const report = checkProtocolPurity(clean.path);
    expect(report.scanned).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  });
});

describe("the rule sets", () => {
  it("cover XDR, signatures and header literals for the composing packages", () => {
    expect(COMPOSITION_RULES.map((rule) => rule.id).sort()).toEqual([
      "payment-header-literal",
      "signature-handling",
      "xdr-construction",
    ]);
  });

  it("cover the direct SDK import for core", () => {
    expect(CORE_RULES.map((rule) => rule.id)).toEqual(["direct-stellar-sdk-import"]);
  });

  it("explains why, not just what", () => {
    for (const rule of [...COMPOSITION_RULES, ...CORE_RULES]) {
      expect(rule.why.length).toBeGreaterThan(40);
    }
  });
});
