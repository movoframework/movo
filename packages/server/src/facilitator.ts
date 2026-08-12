/**
 * Building a `FacilitatorClient` from resolved configuration.
 *
 * Movo defines no facilitator interface of its own. `@x402/core/server` exports
 * `FacilitatorClient` and `HTTPFacilitatorClient`; Movo constructs them from config and adds
 * nothing to the contract (spec §1.8 D5). A parallel interface would need adapters in both
 * directions and would break the moment upstream added a method.
 */

import type { FacilitatorClient, ResolvedConfig } from "@movoframework/core";
import { HTTPFacilitatorClient } from "@movoframework/core/server";

/** How a mount obtains its facilitator. */
export type FacilitatorOption = "config" | FacilitatorClient;

/**
 * Construct the facilitator client a mount should use.
 *
 * **The credential never lands on the instance.** `createAuthHeaders` is passed through as a
 * function, so an API key is read at the moment a request needs it and lives only inside that
 * closure. Nothing that walks the client — a debugger, a diagnostic dump, a serialiser nobody
 * has written yet — can reach it. Upstream requires the returned object be keyed by request
 * path (`verify`, `settle`, `supported`) and throws on a flat headers object, which is worth
 * knowing because the flat form is the obvious thing to write.
 *
 * @param config - Resolved configuration
 * @param option - `"config"` to build from configuration, or a caller-supplied client
 * @returns The facilitator client to hand to the resource server
 */
export function createFacilitatorClient(
  config: ResolvedConfig,
  option: FacilitatorOption = "config",
): FacilitatorClient {
  if (option !== "config") return option;

  const authHeaders = config.facilitator.authHeaders.value;

  return new HTTPFacilitatorClient({
    url: config.facilitator.url.value,
    timeoutMs: config.facilitator.timeoutMs.value,
    ...(authHeaders === undefined
      ? {}
      : {
          // Movo's config field is `authHeaders`; upstream's is `createAuthHeaders`. The
          // translation happens here, once, rather than forcing Movo's configuration surface to
          // mirror an upstream field name that would then be part of Movo's own compatibility
          // promise.
          createAuthHeaders: authHeaders,
        }),
  });
}
