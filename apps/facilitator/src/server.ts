/**
 * The deployable entry point.
 *
 * Reads configuration from the environment, composes the facilitator, and serves. It is
 * deliberately thin: everything interesting is testable without a listening socket, and this
 * file is the part that cannot be.
 */

import { serve } from "@hono/node-server";
import { STELLAR_PUBNET_CAIP2 } from "@movoframework/core";
import { createFacilitator, facilitatorConfigFromEnv } from "@movoframework/facilitator";
import { createFacilitatorApp } from "./app.js";

const port = Number(process.env["PORT"] ?? "8402");
const config = facilitatorConfigFromEnv(process.env);
const facilitator = createFacilitator(config);
const app = createFacilitatorApp({ facilitator, version: process.env["MOVO_VERSION"] ?? "0.0.0" });

// A pubnet deployment configured from environment seeds is doing the one thing spec §24.8
// says production must not require. It is not blocked — an operator with a KMS sidecar that
// materialises a seed into the environment has made an informed choice — but it is stated
// loudly on every start, because the alternative is that it is never noticed.
for (const network of config.networks) {
  if (network.network === STELLAR_PUBNET_CAIP2) {
    process.stdout.write(
      `${JSON.stringify({
        level: "warn",
        event: "facilitator.pubnet_env_seed",
        message:
          "stellar:pubnet is configured from environment seeds. The sponsor key is this system's highest-value secret; inject a KMS- or HSM-backed signer through resolveFacilitatorConfig instead. See docs/operating-a-facilitator/signers-and-channel-accounts.md.",
        network: network.network,
        signers: network.signers.length,
      })}\n`,
    );
  }
}

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    event: "facilitator.start",
    port,
    networks: config.networks.map((network) => ({
      network: network.network,
      // Addresses, never seeds. A sponsor address is public ledger data and an operator needs
      // it in the log to reconcile a transaction; the seed must not exist outside the signer.
      signers: network.signers.map((signer) => signer.address),
      floorXlm: network.sponsorFloorXlm,
      areFeesSponsored: network.areFeesSponsored,
    })),
    authMode: config.auth.mode,
    rateLimit: config.rateLimit.enabled,
  })}\n`,
);

serve({ fetch: app.fetch, port });
