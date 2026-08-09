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
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts", "tests/unit/**/*.test.ts"],
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
