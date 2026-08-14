/**
 * `queryCatalog` — buyer-side catalog queries, over upstream's real client.
 *
 * Thin on purpose. `withBazaar` wraps an `HTTPFacilitatorClient` and adds
 * `extensions.bazaar.listResources` and `.search`; this composes those and returns what the
 * facilitator returned. Movo does not re-shape the results, does not normalise them into a
 * Movo vocabulary, and does not cache.
 *
 * **What Movo deliberately does not abstract: the inclusion policy.** A catalog belongs to
 * whichever facilitator the seller configured. Whether a resource appears in it, how it ranks,
 * and how long indexing takes are that operator's decisions. `queryCatalog` reports what the
 * facilitator says; it promises nothing about what the facilitator should say (spec §5.7).
 *
 * The discarded M4 WIP shipped this as two methods returning `{ resources: [] }` unconditionally
 * — a shape that typechecks, satisfies its signature, and tells every caller the catalog is
 * empty (amendment 007 §1). `query.test.ts` asserts against a real `withBazaar` client with a
 * stubbed transport, so an empty result can only come from an empty response.
 */

import {
  type DiscoveryResourcesResponse,
  type ListDiscoveryResourcesParams,
  type SearchDiscoveryResourcesParams,
  type SearchDiscoveryResourcesResponse,
  withBazaar,
} from "@movoframework/core/bazaar";
// The facilitator client lives on the `server` half of the waist, not the `bazaar` half —
// `withBazaar` extends a client it does not construct.
import { HTTPFacilitatorClient } from "@movoframework/core/server";

/** Options for constructing a catalog client. */
export interface QueryCatalogOptions {
  /** Per-request timeout, forwarded to the facilitator client. */
  readonly timeoutMs?: number;
  /**
   * Credentials, when the facilitator requires them.
   *
   * A function, never a value — the same rule the resource server follows. Upstream requires
   * the returned object be keyed by request path.
   */
  readonly createAuthHeaders?: () => Promise<{
    readonly verify?: Record<string, string>;
    readonly settle?: Record<string, string>;
    readonly supported?: Record<string, string>;
    readonly bazaar?: Record<string, string>;
  }>;
}

/** The catalog surface Movo exposes. */
export interface CatalogClient {
  /**
   * List catalogued resources.
   *
   * @param params - Filters and pagination, all optional and all facilitator-defined
   * @returns Whatever the facilitator returned, unmodified
   */
  list(params?: ListDiscoveryResourcesParams): Promise<DiscoveryResourcesResponse>;
  /**
   * Search the catalog with a natural-language query.
   *
   * @param params - Search parameters; `query` is required
   * @returns Whatever the facilitator returned, unmodified
   */
  search(params: SearchDiscoveryResourcesParams): Promise<SearchDiscoveryResourcesResponse>;
}

/**
 * Build a catalog client for a facilitator.
 *
 * @param facilitatorUrl - The facilitator's base URL
 * @param options - Timeout and credentials
 * @returns A client with `list` and `search`
 */
export function queryCatalog(facilitatorUrl: string, options?: QueryCatalogOptions): CatalogClient {
  const client = new HTTPFacilitatorClient({
    url: facilitatorUrl,
    ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options?.createAuthHeaders === undefined
      ? {}
      : { createAuthHeaders: options.createAuthHeaders }),
  });

  const bazaar = withBazaar(client);

  return {
    list: async (params) => bazaar.extensions.bazaar.listResources(params),
    search: async (params) => bazaar.extensions.bazaar.search(params),
  };
}
