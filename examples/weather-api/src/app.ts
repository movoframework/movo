/**
 * The weather API, assembled but not started.
 *
 * Kept separate from `server.ts` so that tests can mount the same application onto their own
 * Express instance with their own facilitator, without a process listening on a port. The e2e
 * suite starts it for real; the integration suite drives it through the real middleware with a
 * stub facilitator and no network at all.
 */

import { defineApp, defineConfig } from "@movoframework/core";
import { currentWeather } from "./resources.js";

/**
 * Project configuration.
 *
 * `payTo` reads straight from the environment, which is the ordinary thing to write and which
 * compiles because Movo's config input accepts `string | undefined` — see ADR-0006. If it is
 * unset, `resolveConfig` fails at startup with `MOVO_E_PAYTO_MISSING` rather than at the moment
 * a buyer tries to pay.
 */
export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: process.env["MOVO_PAY_TO"],
  facilitator: {
    url: process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator",
  },
  defaults: {
    maxTimeoutSeconds: 60,
  },
  discovery: {
    enabled: true,
    serviceName: "Example Weather",
    tags: ["weather", "forecast"],
  },
});

/** The paid resources. */
export const app = defineApp({ resources: [currentWeather] });
