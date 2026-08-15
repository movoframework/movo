import { defineConfig } from "@movoframework/core";

/**
 * Configuration is five layers deep: `default < config < env < resource < argument`.
 *
 * Everything here is the `config` layer, which environment variables override. That is why
 * `payTo` reads from the environment rather than being written in — a repository is the wrong
 * place for the account that receives your money, and `.env` is gitignored.
 *
 * Run `movo doctor` to see every resolved value with the layer that supplied it. When a payment
 * goes to an account you did not expect, that table is where the answer is.
 */
export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",

  // Your Stellar account, which receives payment. Never a secret — a resource server signs
  // nothing. If you find yourself putting an S… seed in this file, something has gone wrong.
  payTo: process.env["MOVO_PAY_TO"],

  facilitator: {
    // The free, keyless facilitator that supports stellar:testnet.
    url: process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator",
  },

  defaults: {
    // A payment authorisation is valid for this long. Longer is friendlier to slow clients and
    // widens the window in which a signed authorisation could be replayed.
    maxTimeoutSeconds: 60,
  },
});

export default config;
