/**
 * `@movoframework/catalog` — the Stellar Bazaar catalog.
 *
 * Automatic cataloging at settle time, `GET /discovery/resources`, `GET /discovery/search` with
 * hybrid retrieval, and the trust-boundary controls that make ingesting attacker-influenced
 * fields safe.
 *
 * **This package implements no validator.** Every rule about whether a declaration is
 * acceptable belongs to `@x402/extensions`, reached through `@movoframework/core/bazaar`. What
 * Movo adds is ownership (which upstream cannot know), size caps against this deployment's
 * configuration, retrieval, and ranking — none of which upstream ships.
 *
 * @see docs/adr/0013-discovery-architecture.md
 * @see docs/discovery/search-quality.md
 */

export {
  type Catalog,
  type CatalogOptions,
  createCatalog,
  decodeCursor,
  encodeCursor,
  MAX_QUERY_LENGTH,
  type SearchListingsPage,
} from "./catalog.js";
export {
  DEFAULT_DUST_THRESHOLD_ATOMIC,
  type IngestOptions,
  ingestSettlement,
  listingKey,
} from "./ingest.js";
export {
  checkDeclaration,
  checkFieldSizes,
  checkOwnership,
  checkPayToNotForged,
  checkRouteTemplate,
  checkSchemaRefs,
  checkServiceMetadata,
  DEFAULT_FIELD_CAPS,
  type FieldCaps,
  type IntegrityRefusal,
  type IntegrityResult,
} from "./integrity.js";
export {
  ADVERSARIAL_CONTROLS,
  INGEST_REASON_MESSAGE,
  INGEST_REASON_VALUES,
  INGEST_REASONS,
  type IngestReason,
} from "./reasons.js";
export {
  cosineSimilarity,
  DEFAULT_EMBEDDING_MODEL,
  type Embedder,
  loadLocalEmbedder,
  VectorIndex,
} from "./search/embedding.js";
export { BM25Index, type ScoredId, tokenize } from "./search/lexical.js";
export {
  applySignals,
  DEFAULT_RANKING_WEIGHTS,
  parameterDescriptions,
  type RankingSignals,
  type RankingWeights,
  RRF_K,
  reciprocalRankFusion,
  retrievalText,
} from "./search/rank.js";
export { PostgresCatalogStore } from "./store/postgres.js";
export {
  buildWhere,
  clampLimit,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SqliteCatalogStore,
} from "./store/sqlite.js";
export {
  type CatalogListing,
  type CatalogStore,
  type IngestContext,
  type IngestOutcome,
  type ListFilters,
  type ListingDocument,
  type ListingType,
  type ListPage,
  toDiscoveryResource,
} from "./types.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
