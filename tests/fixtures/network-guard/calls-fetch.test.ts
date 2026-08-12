/**
 * PROOF-OF-FAILURE FIXTURE — deliberately violates the unit suite's network guard.
 *
 * It lives under `tests/fixtures/` so that no ordinary Vitest run picks it up; only
 * `tests/unit/network-guard.test.ts` invokes it, in a child process, and asserts that the
 * child fails. A guard nobody has watched fail is indistinguishable from a guard that does not
 * work — which is exactly how M0's Biome configuration reported success while the narrow-waist
 * rule was not loaded at all (Spec Amendment 001 §5).
 *
 * The `catch` is the interesting half. It models the realistic mistake: code that calls out to
 * a network, catches the failure and carries on. Throwing alone would not fail this test — the
 * invocation counter does.
 */

import { expect, it } from "vitest";

it("calls fetch and swallows the failure", async () => {
  try {
    await fetch("https://example.invalid/should-never-be-reached");
  } catch {
    // Swallowed on purpose. The guard's counter must fail the suite anyway.
  }
  expect(true).toBe(true);
});
