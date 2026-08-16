/**
 * `createCatalog` — ingest, list and search over a {@link CatalogStore}.
 *
 * The indexes are built in memory from the store's `documents()` and rebuilt when the catalog
 * changes. At the scale this is designed for — a facilitator's own listings, thousands rather
 * than millions — that is the right trade: no index to keep consistent with the store, no
 * separate service, and a rebuild costs milliseconds for the lexical half. The embedding half
 * is incremental, because re-embedding every document on every ingest would make cataloguing
 * cost seconds and grow with catalog size.
 *
 * When that trade stops holding, the seam is `CatalogStore.documents()` — a store that owns its
 * own index implements search behind the same port. `docs/discovery/running-a-catalog.md` says
 * so, and says at roughly what size to think about it.
 */

import type {
  DiscoveryResourcesResponse,
  ListDiscoveryResourcesParams,
  SearchDiscoveryResourcesParams,
  SearchDiscoveryResourcesResponse,
} from "@movoframework/core/bazaar";
import { type IngestOptions, ingestSettlement } from "./ingest.js";
import { type Embedder, loadLocalEmbedder, VectorIndex } from "./search/embedding.js";
import { BM25Index, type ScoredId } from "./search/lexical.js";
import {
  applySignals,
  DEFAULT_RANKING_WEIGHTS,
  type RankingSignals,
  type RankingWeights,
  reciprocalRankFusion,
} from "./search/rank.js";
import { clampLimit } from "./store/sqlite.js";
import {
  type CatalogListing,
  type CatalogStore,
  type IngestContext,
  type IngestOutcome,
  toDiscoveryResource,
} from "./types.js";

/** How many candidates each retriever contributes to fusion. */
const CANDIDATE_DEPTH = 100;

/** Query length cap — a resource-exhaustion control, per §7.3. */
export const MAX_QUERY_LENGTH = 512;

/** A ranked page of stored listings — {@link Catalog.searchListings}'s result. */
export interface SearchListingsPage {
  /** The listings, in rank order. */
  readonly listings: readonly CatalogListing[];
  /** True when a retriever was degraded or the results were truncated. */
  readonly partialResults: boolean;
  /** The page size actually applied, after clamping. */
  readonly limit: number;
  /** Opaque cursor for the next page, or null at the end. */
  readonly cursor: string | null;
}

/** Options for {@link createCatalog}. */
export interface CatalogOptions {
  readonly store: CatalogStore;
  /**
   * The semantic retriever.
   *
   * `undefined` means lexical-only, and search then reports `partialResults: true`. Pass
   * `"local"` to load the default Apache-2.0 model lazily on first use.
   */
  readonly embedder?: Embedder | "local" | undefined;
  readonly ingest?: IngestOptions;
  readonly ranking?: RankingWeights;
}

/** The catalog surface. */
export interface Catalog {
  /** Catalogue one settled payment. Returns what to put in `EXTENSION-RESPONSES`. */
  ingest(context: IngestContext): Promise<IngestOutcome>;
  /** `GET /discovery/resources`. */
  list(params: ListDiscoveryResourcesParams): Promise<DiscoveryResourcesResponse>;
  /** `GET /discovery/search`. */
  search(params: SearchDiscoveryResourcesParams): Promise<SearchDiscoveryResourcesResponse>;
  /**
   * The same search, returning **stored** listings rather than the wire shape.
   *
   * `DiscoveryResource` deliberately carries no `id` — it is a Movo storage key and no other
   * facilitator has one, so putting it on the wire would be the walled-garden field §25.11 warns
   * about. But an agent that has searched needs a handle it can pass back to `bazaar.get` and
   * `bazaar.paidCall`.
   *
   * The alternative was for `@movoframework/mcp` to re-derive the key from each result's URL.
   * That is a second copy of ingest's keying rule, and §A.2 rule 2 exists because of exactly
   * that shape: two copies of one identifier drift, and the drift is silent — a lookup that
   * quietly misses looks identical to a listing that is not there.
   */
  searchListings(params: SearchDiscoveryResourcesParams): Promise<SearchListingsPage>;
  /** Fetch one listing by its derived key. Backs `bazaar.get`. */
  get(id: string): Promise<CatalogListing | undefined>;
  /** Report a failed call against a listing, feeding failure-rate demotion. */
  reportFailure(id: string): Promise<void>;
  /** Whether the semantic retriever is live. Drives `partialResults`. */
  semanticReady(): Promise<boolean>;
  /** Rebuild both indexes from the store. Called automatically after ingest. */
  reindex(): Promise<void>;
  readonly store: CatalogStore;
}

/**
 * Compose a catalog over a store.
 *
 * @param options - Store, embedder and tunables
 * @returns The catalog surface
 */
export function createCatalog(options: CatalogOptions): Catalog {
  const { store } = options;
  const weights = options.ranking ?? DEFAULT_RANKING_WEIGHTS;

  let lexical = new BM25Index([]);
  let vectors = new VectorIndex();
  let embedder: Embedder | undefined;
  let embedderResolved = options.embedder !== "local";
  let indexedIds = new Set<string>();
  let dirty = true;

  if (options.embedder !== undefined && options.embedder !== "local") {
    embedder = options.embedder;
  }

  async function resolveEmbedder(): Promise<Embedder | undefined> {
    if (embedderResolved) return embedder;
    embedderResolved = true;
    // Failure here is not fatal: it degrades search and is reported as `partialResults`.
    embedder = await loadLocalEmbedder();
    return embedder;
  }

  async function ensureIndexes(): Promise<void> {
    const documents = await store.documents();

    if (dirty) {
      lexical = new BM25Index(documents);
      dirty = false;
    }

    const model = await resolveEmbedder();
    if (model === undefined) return;

    // Only embed what is new. Re-embedding the whole catalog on every ingest would make the
    // cost of cataloguing grow with catalog size, which is the wrong shape for a hook on the
    // settle path.
    const pending = documents.filter((document) => !indexedIds.has(document.id));
    if (pending.length > 0) {
      await vectors.index(model, pending);
      for (const document of pending) indexedIds.add(document.id);
    }
  }

  return {
    store,

    ingest: async (context) => {
      const outcome = await ingestSettlement(context, store, options.ingest);
      if (outcome.status === "success") {
        dirty = true;
        // A changed listing must be re-embedded, not just re-scored lexically.
        indexedIds.delete(outcome.id);
      }
      return outcome;
    },

    get: (id) => store.get(id),

    reportFailure: async (id) => {
      await store.recordFailure(id);
    },

    semanticReady: async () => (await resolveEmbedder()) !== undefined,

    reindex: async () => {
      dirty = true;
      indexedIds = new Set();
      vectors = new VectorIndex();
      await ensureIndexes();
    },

    list: async (params) => {
      const page = await store.list({
        ...(params.type === undefined ? {} : { type: params.type }),
        ...(params.payTo === undefined ? {} : { payTo: params.payTo }),
        ...(params.scheme === undefined ? {} : { scheme: params.scheme }),
        ...(params.network === undefined ? {} : { network: params.network }),
        ...(params.extensions === undefined ? {} : { extensions: params.extensions }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
        ...(params.offset === undefined ? {} : { offset: params.offset }),
      });

      return {
        x402Version: 2,
        items: page.items.map(toDiscoveryResource),
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      };
    },

    search: async (params) => {
      const page = await searchListings(params);
      return {
        x402Version: 2,
        resources: page.listings.map(toDiscoveryResource),
        partialResults: page.partialResults,
        pagination: { limit: page.limit, cursor: page.cursor },
      };
    },

    searchListings,
  };

  /**
   * The one ranking pass.
   *
   * `search` is a projection of this onto upstream's wire shape. Having the wire form call the
   * stored form — rather than the two running the retrieval independently — is what makes
   * `GET /discovery/search` and `bazaar.search` provably the same ranker. If they diverged, the
   * published nDCG@10 would describe one of them and nobody would know which.
   */
  async function searchListings(
    params: SearchDiscoveryResourcesParams,
  ): Promise<SearchListingsPage> {
    const query = (params.query ?? "").slice(0, MAX_QUERY_LENGTH).trim();
    const limit = clampLimit(params.limit);

    // Filters apply before ranking: a search restricted to one network must not spend its
    // result slots on listings from another and then drop them.
    const filtered = await store.list({
      ...(params.type === undefined ? {} : { type: params.type }),
      ...(params.payTo === undefined ? {} : { payTo: params.payTo }),
      ...(params.scheme === undefined ? {} : { scheme: params.scheme }),
      ...(params.network === undefined ? {} : { network: params.network }),
      ...(params.extensions === undefined ? {} : { extensions: params.extensions }),
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    });
    const eligible = new Set(filtered.items.map((listing) => listing.id));

    if (query === "" || eligible.size === 0) {
      const cursorPage = decodeCursor(params.cursor);
      return {
        listings: filtered.items.slice(cursorPage, cursorPage + limit),
        partialResults: false,
        limit,
        cursor: encodeCursor(cursorPage + limit, filtered.items.length),
      };
    }

    await ensureIndexes();

    const lists: ScoredId[][] = [];
    const lexicalHits = lexical
      .search(query, CANDIDATE_DEPTH)
      .filter((candidate) => eligible.has(candidate.id));
    lists.push(lexicalHits);

    let semanticDegraded = true;
    const model = await resolveEmbedder();
    if (model !== undefined) {
      try {
        const [queryVector] = await model.embed([query]);
        if (queryVector !== undefined) {
          lists.push(
            vectors
              .search(queryVector, CANDIDATE_DEPTH)
              .filter((candidate) => eligible.has(candidate.id)),
          );
          semanticDegraded = false;
        }
      } catch {
        // A retriever that fails at query time degrades the result rather than failing it.
        semanticDegraded = true;
      }
    }

    const fused = reciprocalRankFusion(lists);

    const signals = new Map<string, RankingSignals>(
      filtered.items.map((listing) => [
        listing.id,
        { settlementCount: listing.settlementCount, failureCount: listing.failureCount },
      ]),
    );
    const ranked = applySignals(fused, signals, weights);

    const start = decodeCursor(params.cursor);
    const page = ranked.slice(start, start + limit);

    return {
      listings: await store.byIds(page.map((candidate) => candidate.id)),
      // True when a retriever was unavailable OR when results were truncated — both mean
      // "there is more or better than what you are holding", which is what a caller needs.
      partialResults: semanticDegraded || ranked.length > start + limit,
      limit,
      cursor: encodeCursor(start + limit, ranked.length),
    };
  }
}

/**
 * Cursors are an opaque offset.
 *
 * Opaque because the specification calls them advisory and a caller must not compute one; an
 * offset because ranked results are recomputed per query and a keyset cursor over a score that
 * changes between requests would silently skip or repeat rows.
 *
 * @param next - The next start offset
 * @param total - Total ranked candidates
 * @returns An encoded cursor, or null at the end of the results
 */
export function encodeCursor(next: number, total: number): string | null {
  if (next >= total) return null;
  return Buffer.from(JSON.stringify({ o: next }), "utf8").toString("base64url");
}

/**
 * Decode a cursor, treating anything unreadable as the start.
 *
 * A malformed cursor is a client bug or a probe, and neither deserves a 500.
 *
 * @param cursor - The supplied cursor
 * @returns The start offset
 */
export function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      o?: unknown;
    };
    const offset = typeof decoded.o === "number" && Number.isFinite(decoded.o) ? decoded.o : 0;
    return Math.max(0, Math.floor(offset));
  } catch {
    return 0;
  }
}
