/**
 * Wiring the catalog to the facilitator's settle path.
 *
 * This file is the whole of "automatic cataloging": a settlement completes, the observer hands
 * the payload and the settled requirements to the catalog, and the catalog decides. There is no
 * registration endpoint anywhere in this service, by design — §28's objective is that a
 * developer gets paid once and is findable, and a second step is a step most sellers never take.
 *
 * **The observer is deliberately toothless.** It cannot abort, retry or alter the settlement; it
 * receives a finished `SettleResponse` and returns only what to report in `EXTENSION-RESPONSES`.
 * A catalog that could fail a payment would make discovery a liability for every seller using
 * the facilitator.
 *
 * **§B.1 lives one layer down, and is worth restating here** because this is where someone would
 * be tempted to "improve" it: the observer passes `paymentRequirements` through untouched, and
 * ingest takes the listing owner from `requirements.payTo`. It never inspects the settled
 * transaction. If it did, it would find the facilitator as the transaction source on every
 * settlement — fee sponsorship — and, read against the old four-position literal, would refuse
 * every listing it was handed.
 */

import {
  type Catalog,
  type CatalogStore,
  createCatalog,
  type Embedder,
  SqliteCatalogStore,
} from "@movoframework/catalog";
import type { ExtensionResponse, SettlementObserver } from "@movoframework/facilitator";

/** The bazaar extension key, as it appears in `EXTENSION-RESPONSES`. */
const BAZAAR_KEY = "bazaar";

/** Options for {@link createCatalogObserver}. */
export interface CatalogWiringOptions {
  readonly catalog: Catalog;
}

/**
 * Build the settle-path observer that catalogues a payment.
 *
 * @param options - The catalog to write into
 * @returns An observer for `createFacilitator`
 */
export function createCatalogObserver(options: CatalogWiringOptions): SettlementObserver {
  return async (event): Promise<ExtensionResponse | undefined> => {
    // Nothing to report when the payment carried no discovery declaration at all. Emitting a
    // `rejected` here would put a scary header on every ordinary non-discoverable payment.
    const payload = event.paymentPayload as { extensions?: Record<string, unknown> };
    if (payload.extensions?.[BAZAAR_KEY] === undefined) return undefined;

    const outcome = await options.catalog.ingest({
      paymentPayload: event.paymentPayload,
      paymentRequirements: event.paymentRequirements,
      settleResponse: event.settleResponse,
    });

    if (outcome.status === "rejected") {
      return {
        key: BAZAAR_KEY,
        status: "rejected",
        // AC7.6 — always populated.
        rejectedReason: outcome.rejectedReason,
      };
    }

    return { key: BAZAAR_KEY, status: outcome.status };
  };
}

/**
 * Open the catalog a deployment is configured for.
 *
 * SQLite by default and by preference: a catalog whose cheapest deployment needs a database
 * cluster is a catalog most self-hosters will not run. Postgres is reached by setting
 * `MOVO_CATALOG_POSTGRES_URL`.
 *
 * @param env - The process environment
 * @returns A catalog, or undefined when discovery is switched off
 */
export async function openCatalogFromEnv(env: {
  readonly [key: string]: string | undefined;
}): Promise<Catalog | undefined> {
  if (env["MOVO_CATALOG"] === "off") return undefined;

  let store: CatalogStore;
  const postgresUrl = env["MOVO_CATALOG_POSTGRES_URL"];
  if (postgresUrl !== undefined && postgresUrl !== "") {
    const { PostgresCatalogStore } = await import("@movoframework/catalog");
    store = await PostgresCatalogStore.connect(postgresUrl);
  } else {
    store = await SqliteCatalogStore.open(env["MOVO_CATALOG_SQLITE_PATH"] ?? "movo-catalog.db");
  }

  // `"local"` loads the Apache-2.0 MiniLM model lazily on first search. When the optional peer
  // is absent the catalog runs lexical-only and search reports `partialResults: true` — the
  // degraded-retriever signal, rather than a silent quality drop.
  const embedder: Embedder | "local" | undefined =
    env["MOVO_CATALOG_EMBEDDINGS"] === "off" ? undefined : "local";

  return createCatalog({ store, embedder });
}
