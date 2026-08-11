import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NETWORK_GUARD_MESSAGE } from "../setup/no-network.ts";

/**
 * The proof-of-failure test for the unit suite's network guard (AC1.8).
 *
 * The guard cannot be demonstrated in-process: a test that called `fetch` to prove the guard
 * fires would itself trip the guard and fail the very suite it was proving. So the violation
 * runs in a child Vitest process against a fixture, and this test asserts the child exits
 * non-zero with the guard's message.
 */

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const VITEST = join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
const FIXTURE_CONFIG = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "network-guard",
  "vitest.fixture.config.ts",
);

interface ChildRun {
  readonly status: number;
  readonly output: string;
}

function runFixtureSuite(): ChildRun {
  const argv = [VITEST, "run", "--config", FIXTURE_CONFIG];
  try {
    const stdout = execFileSync(process.execPath, argv, {
      encoding: "utf8",
      cwd: REPO_ROOT,
      env: { ...process.env, CI: "1" },
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

describe("the unit suite network guard", () => {
  it("fails the suite when a test invokes fetch, even if the test swallows the error", {
    timeout: 120_000,
  }, () => {
    const result = runFixtureSuite();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("MOVO_TEST_NETWORK_GUARD");
  });

  it("states where a test that needs the network belongs", () => {
    expect(NETWORK_GUARD_MESSAGE).toContain("integration");
    expect(NETWORK_GUARD_MESSAGE).toContain("MOVO_E2E=1");
  });
});
