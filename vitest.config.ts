import { defineConfig } from "vitest/config";

/**
 * Four named projects, matching the four testing layers of the specification (§1.16):
 *
 *   unit         no network; package smoke tests and the repository tooling tests
 *   integration  cross-package wiring against MockFacilitator; no network
 *   e2e          real Stellar testnet settlement; gated behind MOVO_E2E=1
 *   conformance  third-party services; gated behind MOVO_E2E=1, never blocks the PR gate
 *
 * `integration`, `e2e` and `conformance` are empty at M0; `passWithNoTests` is therefore set
 * at the root, because Vitest 4 accepts it only as a global option and not per project. The
 * four projects exist now so that later milestones add test files rather than infrastructure.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    /**
     * Coverage floor: 90% of lines in `@movoframework/core` (AC1.10, spec §3.2). Configured as
     * a threshold rather than a number someone reads off a report, because a floor nobody
     * enforces is a number that only ever goes down.
     *
     * The protocol module is excluded from the denominator: it is re-export declarations with
     * no branches, so covering it measures whether a test imported the module rather than
     * whether anything is tested. `protocol/upstream-conformance.test.ts` exercises it
     * directly and is where the real assurance lives.
     */
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/core/src/**/*.ts"],
      exclude: ["**/*.test.ts", "packages/core/src/protocol/index.ts"],
      thresholds: { lines: 90 },
    },
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          setupFiles: ["./tests/setup/no-network.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          environment: "node",
          include: ["tests/e2e/**/*.test.ts"],
          /**
           * One file at a time, because every e2e file spends from the **same funded testnet
           * buyer** and settles through the same sponsor pool.
           *
           * This is §B.2's lesson at the harness level: a Stellar account is a mutex, not a
           * weight. Run in parallel, the files race each other for one account's sequence
           * number and one sponsor pool, and the failures land wherever the timing puts them —
           * the M7 discovery file failed on a payment that had settled cleanly moments earlier
           * on its own. A suite that races itself reports on its own scheduling rather than on
           * the code, which is worse than a slow suite.
           *
           * Within a file, ordering is the file's own business; `facilitator-settlement.test.ts`
           * deliberately drives concurrent settlements, and that concurrency is the thing under
           * test rather than an accident of the runner.
           */
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "conformance",
          environment: "node",
          include: ["tests/conformance/**/*.test.ts"],
        },
      },
    ],
  },
});
