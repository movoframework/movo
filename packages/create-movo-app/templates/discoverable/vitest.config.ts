import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Registers Movo's matchers — `toBePaymentRequired`, `toBeSettled`,
    // `toBeRejectedWithReason`. `movo test` preloads this for you; it is listed here so that a
    // bare `vitest` run behaves identically.
    setupFiles: ["@movoframework/testing/setup"],
  },
});
