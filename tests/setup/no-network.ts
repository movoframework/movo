/**
 * The unit suite's network guard.
 *
 * Spec §1.16 layer 1: the unit suite performs no network I/O, and the suite *fails* if any
 * test performs a real `fetch`. The distinction between "we intend not to hit the network" and
 * "the suite fails when we do" is the whole value: an accidental live call makes a test suite
 * slow, flaky and dependent on a third party's uptime, and it does so silently — the test
 * still passes, just not for the reason anyone thinks.
 *
 * Both halves are needed. Throwing stops the call. Counting catches the case where the code
 * under test catches the error and carries on, which would otherwise turn a network violation
 * into a passing test with a `catch` block in it.
 *
 * Proven to fire by `tests/unit/network-guard.test.ts`, which runs a fixture that calls
 * `fetch` in a child Vitest process and asserts that process fails (spec amendment 001 §5: no
 * gate ships without a proof-of-failure test).
 */

import { afterEach, expect } from "vitest";

/** How many times `fetch` was invoked since the last assertion. */
let invocations = 0;

/** What the replacement `fetch` throws. Matched on by the proof-of-failure test. */
export const NETWORK_GUARD_MESSAGE =
  "MOVO_TEST_NETWORK_GUARD: the unit suite performs no network I/O, but globalThis.fetch was invoked. " +
  "Move this test to the integration suite with MockFacilitator, or to the e2e suite behind MOVO_E2E=1.";

globalThis.fetch = ((...args: unknown[]): never => {
  invocations += 1;
  const target = args[0];
  const description =
    typeof target === "string" ? target : target instanceof URL ? target.toString() : "<request>";
  throw new Error(`${NETWORK_GUARD_MESSAGE} Target: ${description}`);
}) as unknown as typeof fetch;

afterEach(() => {
  const observed = invocations;
  invocations = 0;
  expect(observed, NETWORK_GUARD_MESSAGE).toBe(0);
});
