import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * PROOF-OF-FAILURE HARNESS — runs `calls-fetch.test.ts` under the real network guard.
 *
 * A separate config rather than the root one, because the root `unit` project deliberately
 * does not match anything under `tests/fixtures/`: a fixture that violates the guard must not
 * be picked up by an ordinary `pnpm test`. This config exists solely so that
 * `tests/unit/network-guard.test.ts` can spawn a child process that *does* pick it up, and
 * assert the child fails.
 *
 * `passWithNoTests` is false here on purpose. If the fixture ever stops matching — a rename, a
 * moved directory — the child would otherwise exit 0 and the proof-of-failure test would pass
 * while proving nothing at all. That is the exact failure this whole apparatus exists to
 * prevent, so it must not be reintroduced by the apparatus itself.
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../../..", import.meta.url)),
    passWithNoTests: false,
    include: ["tests/fixtures/network-guard/calls-fetch.test.ts"],
    setupFiles: ["./tests/setup/no-network.ts"],
    environment: "node",
  },
});
