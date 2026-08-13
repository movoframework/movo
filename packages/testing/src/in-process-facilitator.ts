import {
  type FacilitatorClient,
  type FacilitatorStellarSigner,
  type Network,
  STELLAR_PUBNET_CAIP2,
} from "@movoframework/core";
import { FacilitatorExactStellarScheme, x402Facilitator } from "@movoframework/core/server";

export interface InProcessFacilitatorOptions {
  readonly signer: FacilitatorStellarSigner;
  readonly network: Network;
  readonly allowMainnet?: boolean;
}

/**
 * Compose upstream's real Stellar facilitator for local development and gated testnet tests.
 *
 * It performs real verification and real on-chain settlement. It does not expose HTTP routes:
 * facilitator HTTP transport is an M6 deliverable, deliberately outside the core track.
 */
export function createInProcessFacilitator(
  options: InProcessFacilitatorOptions,
): FacilitatorClient {
  if (options.network === STELLAR_PUBNET_CAIP2 && options.allowMainnet !== true) {
    throw new Error("InProcessFacilitator refuses stellar:pubnet without allowMainnet: true");
  }

  const facilitator = new x402Facilitator().register(
    options.network,
    new FacilitatorExactStellarScheme([options.signer]),
  );

  // x402Facilitator is the in-process primitive. Its getSupported() is synchronous while the
  // resource-server client contract is asynchronous, so this small adapter preserves the
  // upstream FacilitatorClient contract without inventing a second facilitator interface.
  return {
    verify: (payment, requirements) => facilitator.verify(payment, requirements),
    settle: (payment, requirements) => facilitator.settle(payment, requirements),
    getSupported: async () => {
      const supported = facilitator.getSupported();
      return {
        ...supported,
        kinds: supported.kinds.map((kind) => ({
          x402Version: kind.x402Version,
          scheme: kind.scheme,
          network: kind.network as Network,
          ...(kind.extra === undefined ? {} : { extra: kind.extra }),
        })),
      };
    },
  };
}
