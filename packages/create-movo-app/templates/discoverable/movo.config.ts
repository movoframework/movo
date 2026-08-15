import { defineConfig } from "@movoframework/core";

/**
 * Configuration is five layers deep: `default < config < env < resource < argument`.
 *
 * Run `movo doctor` to see every resolved value with the layer that supplied it.
 */
export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",

  // Your Stellar account, which receives payment. Never a secret.
  payTo: process.env["MOVO_PAY_TO"],

  facilitator: {
    url: process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator",
  },

  /**
   * Discovery — the metadata a facilitator's catalog lists you under.
   *
   * **Declaring this does not create a listing.** A listing is created by the facilitator you
   * configured, when a buyer pays and echoes your declaration, and only if that facilitator
   * operates a catalog at all. Movo cannot promise inclusion and does not pretend to.
   *
   * What Movo does promise is that you will hear about a problem at build time rather than
   * discovering it as a listing with no icon. Run `movo bazaar validate`.
   */
  discovery: {
    enabled: true,
    serviceName: "Example Weather",
    tags: ["weather", "forecast"],

    // Fetched by a catalog, so upstream enforces an SSRF control on it: loopback addresses,
    // private ranges and bare IP literals are refused. `movo bazaar validate` reports that
    // before a facilitator silently drops the field.
    iconUrl: "https://raw.githubusercontent.com/movoframework/movo/main/docs/icon.png",
  },

  defaults: {
    maxTimeoutSeconds: 60,
  },
});

export default config;
