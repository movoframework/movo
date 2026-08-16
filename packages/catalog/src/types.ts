/**
 * The catalog's domain types and its store port.
 *
 * **The wire shapes are upstream's, not Movo's.** `DiscoveryResource`,
 * `DiscoveryResourcesResponse`, `ListDiscoveryResourcesParams`, `SearchDiscoveryResourcesParams`
 * and `SearchDiscoveryResourcesResponse` all come from `@x402/extensions/bazaar` through the
 * narrow waist. That is what keeps Stellar from being a walled garden (§25.11): a buyer's
 * `withBazaar` client, pointed at this facilitator, gets back exactly the shape it gets from any
 * other facilitator, because it is literally the same type.
 *
 * What this file adds is the *stored* form — {@link CatalogListing} — which carries fields the
 * wire shape has no place for and no buyer should see: who owns the listing, how many
 * settlements have counted toward it, how often calls through it have failed. Those are ranking
 * and integrity inputs, and they are deliberately not echoed back.
 */

import type { Network, PaymentRequirements } from "@movoframework/core";
import type { DiscoveryResource } from "@movoframework/core/bazaar";

/** How a listing is keyed, which differs by resource type. */
export type ListingType = "http" | "mcp";

/**
 * A catalog listing, as stored.
 *
 * The `id` is the deduplication key and is derived, never supplied:
 *
 * - **HTTP** — the `routeTemplate`. This is what collapses `/weather/SFO`, `/weather/LHR` and
 *   ten thousand other concrete paths into one listing. Cataloguing concrete paths would
 *   produce a catalog that grows with traffic instead of with the number of endpoints, which is
 *   the failure mode `routeTemplate` exists to prevent.
 * - **MCP** — the `(resource.url, input.toolName)` tuple, because one MCP server exposes many
 *   tools at one URL and each is separately payable and separately discoverable.
 */
export interface CatalogListing {
  /** Derived deduplication key. See {@link ListingType}. */
  readonly id: string;
  readonly type: ListingType;
  /** The resource URL as echoed by the buyer. */
  readonly resource: string;
  /** HTTP only: the template the concrete paths collapse to. */
  readonly routeTemplate?: string;
  /** MCP only: the tool name. */
  readonly toolName?: string;
  /** HTTP only, when the server extension enriched it. */
  readonly method?: string;

  /**
   * **The owner.** The `payTo` that *actually settled*, taken from the settled requirements and
   * never from the buyer-echoed resource block.
   *
   * This single field is the anti-spoofing control (§7.3). An update whose settled payTo differs
   * from this is refused, which is what stops one seller overwriting another's listing.
   */
  readonly payTo: string;
  readonly network: Network;
  readonly scheme: string;

  readonly x402Version: number;
  readonly accepts: readonly PaymentRequirements[];

  readonly description?: string;
  readonly mimeType?: string;
  /** Sanitised by upstream's `sanitizeResourceServiceMetadata`, never by Movo. */
  readonly serviceName?: string;
  readonly tags?: readonly string[];
  readonly iconUrl?: string;

  /** The echoed extension payloads, including the bazaar `info`/`schema`. */
  readonly extensions?: Readonly<Record<string, unknown>>;

  /** ISO 8601. */
  readonly firstSeen: string;
  /** ISO 8601. Drives `lastUpdated` on the wire and recency in ranking. */
  readonly lastUpdated: string;

  /**
   * Settlements that counted toward this listing.
   *
   * "Counted" is doing work: a settlement below the configured dust threshold does **not**
   * increment this. Without that, listing activity is purchasable for the price of a rounding
   * error, and activity feeds ranking (§7.3, activity inflation).
   */
  readonly settlementCount: number;
  /** Calls reported as failed. Feeds failure-rate demotion. */
  readonly failureCount: number;
}

/** The text a listing contributes to lexical and semantic retrieval. */
export interface ListingDocument {
  readonly id: string;
  readonly text: string;
}

/** Filters accepted by {@link CatalogStore.list}, mirroring upstream's params. */
export interface ListFilters {
  readonly type?: string;
  readonly payTo?: string;
  readonly scheme?: string;
  readonly network?: string;
  readonly extensions?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** A page of listings plus the total matching the filter. */
export interface ListPage {
  readonly items: readonly CatalogListing[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * The store port. Two implementations must satisfy it identically (AC7.10): SQLite for
 * self-hosters and tests, Postgres for hosted deployments.
 */
export interface CatalogStore {
  /** Create tables and indexes if absent. Idempotent. */
  migrate(): Promise<void>;

  /** Fetch one listing by its derived key. */
  get(id: string): Promise<CatalogListing | undefined>;

  /**
   * Insert or update a listing **atomically with its ownership check**.
   *
   * The atomicity is the point, and it is §B.2 applied to this layer. M6's lesson was that a
   * Stellar account is a mutex rather than a weight, and concurrent settlements against one
   * account collide. The same shape appears here: two settlements for the same
   * `routeTemplate` arriving together must not both read "no existing owner" and both write. So
   * the owner comparison and the write happen inside one transaction, and the store — not the
   * caller — decides the winner.
   *
   * @param listing - The listing to write
   * @returns `stored` on success, or `ownerMismatch` with the address that already owns it
   */
  upsert(
    listing: CatalogListing,
  ): Promise<{ outcome: "stored" } | { outcome: "ownerMismatch"; owner: string }>;

  /** Filtered, stably ordered page. */
  list(filters: ListFilters): Promise<ListPage>;

  /** Every listing's retrieval document, for index building. */
  documents(): Promise<readonly ListingDocument[]>;

  /** Listings by id, preserving the caller's order. Used to hydrate ranked ids. */
  byIds(ids: readonly string[]): Promise<readonly CatalogListing[]>;

  /** Record a reported failure against a listing, for failure-rate demotion. */
  recordFailure(id: string): Promise<void>;

  /** Total listings. */
  count(): Promise<number>;

  /** Release resources. */
  close(): Promise<void>;
}

/** Everything ingest needs about a completed settlement. */
export interface IngestContext {
  /** The buyer's payment payload, carrying the echoed extension. */
  readonly paymentPayload: unknown;
  /** The requirements that settled. The source of truth for `payTo`, network and scheme. */
  readonly paymentRequirements: PaymentRequirements;
  /** Upstream's settle response. */
  readonly settleResponse: {
    readonly success: boolean;
    readonly transaction: string;
    readonly network: string;
    readonly payer?: string;
  };
}

/** What ingest concluded, in the vocabulary `EXTENSION-RESPONSES` uses. */
export type IngestOutcome =
  | { readonly status: "success"; readonly id: string }
  | { readonly status: "processing"; readonly id: string }
  | { readonly status: "rejected"; readonly rejectedReason: string; readonly message?: string };

/** Converts a stored listing to the upstream wire shape. */
export function toDiscoveryResource(listing: CatalogListing): DiscoveryResource {
  return {
    resource: listing.resource,
    type: listing.type,
    x402Version: listing.x402Version,
    accepts: [...listing.accepts],
    lastUpdated: listing.lastUpdated,
    ...(listing.description === undefined ? {} : { description: listing.description }),
    ...(listing.mimeType === undefined ? {} : { mimeType: listing.mimeType }),
    ...(listing.serviceName === undefined ? {} : { serviceName: listing.serviceName }),
    ...(listing.tags === undefined ? {} : { tags: [...listing.tags] }),
    ...(listing.iconUrl === undefined ? {} : { iconUrl: listing.iconUrl }),
    ...(listing.extensions === undefined ? {} : { extensions: { ...listing.extensions } }),
  };
}
