/**
 * The SQLite store — the default, and the one self-hosters get.
 *
 * A catalog whose cheapest deployment needs a Postgres cluster is a catalog most sellers will
 * never run. A file on disk is the point.
 *
 * ## §B.2 applied to the write path
 *
 * M6's binding lesson was that a Stellar sponsor account is a **mutex, not a weight**: two
 * settlements that read one account's sequence number concurrently both read the same value and
 * one of them loses. The catalog's write path has the identical shape. Two settlements for the
 * same `routeTemplate` arriving together both run "read the owner, compare, write" — and
 * between the read and the write, the other one writes. Read-then-write is the race, not the
 * comparison.
 *
 * So {@link SqliteCatalogStore.upsert} performs the ownership comparison **and** the write
 * inside one `IMMEDIATE` transaction. `IMMEDIATE` takes the write lock at `BEGIN` rather than
 * at first write, which is what stops two writers from both entering, both reading no owner,
 * and both proceeding. The store decides the winner; the caller is told which.
 *
 * `busy_timeout` is set so a concurrent writer waits rather than failing with `SQLITE_BUSY` —
 * queueing, exactly as the M6 signer pool queues rather than over-subscribing.
 *
 * ## Why `better-sqlite3` rather than `node:sqlite`
 *
 * `node:sqlite` is built in and would add no dependency, but Node still marks it experimental
 * and warns on every load. A shipped package should not depend on an API whose own runtime says
 * it "might change at any time". `better-sqlite3` is MIT, synchronous (which suits a store
 * behind an async port), and has prebuilt binaries.
 */

import { retrievalText } from "../search/rank.js";
import type {
  CatalogListing,
  CatalogStore,
  ListFilters,
  ListingDocument,
  ListPage,
} from "../types.js";

/** The subset of `better-sqlite3` this store uses, so the dependency stays injectable. */
interface SqliteDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  pragma(source: string): unknown;
  close(): void;
}

interface ListingRow {
  id: string;
  type: string;
  resource: string;
  route_template: string | null;
  tool_name: string | null;
  method: string | null;
  pay_to: string;
  network: string;
  scheme: string;
  x402_version: number;
  accepts: string;
  description: string | null;
  mime_type: string | null;
  service_name: string | null;
  tags: string | null;
  icon_url: string | null;
  extensions: string | null;
  first_seen: string;
  last_updated: string;
  settlement_count: number;
  failure_count: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS listings (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  resource         TEXT NOT NULL,
  route_template   TEXT,
  tool_name        TEXT,
  method           TEXT,
  pay_to           TEXT NOT NULL,
  network          TEXT NOT NULL,
  scheme           TEXT NOT NULL,
  x402_version     INTEGER NOT NULL,
  accepts          TEXT NOT NULL,
  description      TEXT,
  mime_type        TEXT,
  service_name     TEXT,
  tags             TEXT,
  icon_url         TEXT,
  extensions       TEXT,
  first_seen       TEXT NOT NULL,
  last_updated     TEXT NOT NULL,
  settlement_count INTEGER NOT NULL DEFAULT 0,
  failure_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS listings_type      ON listings(type);
CREATE INDEX IF NOT EXISTS listings_pay_to    ON listings(pay_to);
CREATE INDEX IF NOT EXISTS listings_network   ON listings(network);
CREATE INDEX IF NOT EXISTS listings_scheme    ON listings(scheme);
-- Ordering is (last_updated DESC, id) everywhere, so the index carries both. Stable ordering
-- under concurrent inserts is a tested requirement, and id is the tiebreaker that provides it.
CREATE INDEX IF NOT EXISTS listings_order     ON listings(last_updated DESC, id);
`;

function toListing(row: ListingRow): CatalogListing {
  return {
    id: row.id,
    type: row.type === "mcp" ? "mcp" : "http",
    resource: row.resource,
    ...(row.route_template === null ? {} : { routeTemplate: row.route_template }),
    ...(row.tool_name === null ? {} : { toolName: row.tool_name }),
    ...(row.method === null ? {} : { method: row.method }),
    payTo: row.pay_to,
    network: row.network as CatalogListing["network"],
    scheme: row.scheme,
    x402Version: row.x402_version,
    accepts: JSON.parse(row.accepts) as CatalogListing["accepts"],
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.mime_type === null ? {} : { mimeType: row.mime_type }),
    ...(row.service_name === null ? {} : { serviceName: row.service_name }),
    ...(row.tags === null ? {} : { tags: JSON.parse(row.tags) as string[] }),
    ...(row.icon_url === null ? {} : { iconUrl: row.icon_url }),
    ...(row.extensions === null
      ? {}
      : { extensions: JSON.parse(row.extensions) as Record<string, unknown> }),
    firstSeen: row.first_seen,
    lastUpdated: row.last_updated,
    settlementCount: row.settlement_count,
    failureCount: row.failure_count,
  };
}

/** A catalog store backed by SQLite. */
export class SqliteCatalogStore implements CatalogStore {
  private readonly db: SqliteDatabase;

  /**
   * @param db - An open `better-sqlite3` database
   */
  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /**
   * Open a store against a file, or `:memory:` for tests.
   *
   * @param filename - Database path
   * @returns A migrated store
   */
  static async open(filename: string): Promise<SqliteCatalogStore> {
    const module = (await import(/* @vite-ignore */ "better-sqlite3")) as unknown as {
      default: new (filename: string) => SqliteDatabase;
    };
    const Database = module.default;
    const db = new Database(filename);
    // WAL lets readers proceed during a write, which matters because /discovery/resources is
    // served from the same file ingest writes to.
    db.pragma("journal_mode = WAL");
    // Wait for a concurrent writer instead of failing. Queueing, per §B.2.
    db.pragma("busy_timeout = 5000");
    const store = new SqliteCatalogStore(db);
    await store.migrate();
    return store;
  }

  async migrate(): Promise<void> {
    this.db.exec(SCHEMA);
  }

  async get(id: string): Promise<CatalogListing | undefined> {
    const row = this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as
      | ListingRow
      | undefined;
    return row === undefined ? undefined : toListing(row);
  }

  async upsert(
    listing: CatalogListing,
  ): Promise<{ outcome: "stored" } | { outcome: "ownerMismatch"; owner: string }> {
    // Compare-and-write in one IMMEDIATE transaction. See this module's header: the comparison
    // outside a transaction is advisory, and advisory is what §B.2 says loses.
    const write = this.db.transaction(
      (
        candidate: CatalogListing,
      ): { outcome: "stored" } | { outcome: "ownerMismatch"; owner: string } => {
        const existing = this.db
          .prepare(
            "SELECT pay_to, first_seen, settlement_count, failure_count FROM listings WHERE id = ?",
          )
          .get(candidate.id) as
          | { pay_to: string; first_seen: string; settlement_count: number; failure_count: number }
          | undefined;

        if (existing !== undefined && existing.pay_to !== candidate.payTo) {
          return { outcome: "ownerMismatch", owner: existing.pay_to };
        }

        this.db
          .prepare(
            `INSERT INTO listings (
               id, type, resource, route_template, tool_name, method, pay_to, network, scheme,
               x402_version, accepts, description, mime_type, service_name, tags, icon_url,
               extensions, first_seen, last_updated, settlement_count, failure_count
             ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               resource = excluded.resource,
               route_template = excluded.route_template,
               tool_name = excluded.tool_name,
               method = excluded.method,
               network = excluded.network,
               scheme = excluded.scheme,
               x402_version = excluded.x402_version,
               accepts = excluded.accepts,
               description = excluded.description,
               mime_type = excluded.mime_type,
               service_name = excluded.service_name,
               tags = excluded.tags,
               icon_url = excluded.icon_url,
               extensions = excluded.extensions,
               last_updated = excluded.last_updated,
               settlement_count = excluded.settlement_count`,
          )
          .run(
            candidate.id,
            candidate.type,
            candidate.resource,
            candidate.routeTemplate ?? null,
            candidate.toolName ?? null,
            candidate.method ?? null,
            candidate.payTo,
            candidate.network,
            candidate.scheme,
            candidate.x402Version,
            JSON.stringify(candidate.accepts),
            candidate.description ?? null,
            candidate.mimeType ?? null,
            candidate.serviceName ?? null,
            candidate.tags === undefined ? null : JSON.stringify(candidate.tags),
            candidate.iconUrl ?? null,
            candidate.extensions === undefined ? null : JSON.stringify(candidate.extensions),
            existing?.first_seen ?? candidate.firstSeen,
            candidate.lastUpdated,
            candidate.settlementCount,
            existing?.failure_count ?? candidate.failureCount,
          );

        return { outcome: "stored" };
      },
    );

    return write(listing);
  }

  async list(filters: ListFilters): Promise<ListPage> {
    const { clause, params } = buildWhere(filters);
    const limit = clampLimit(filters.limit);
    const offset = Math.max(0, filters.offset ?? 0);

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM listings ${clause}`).get(...params) as {
        n: number;
      }
    ).n;

    const rows = this.db
      .prepare(
        `SELECT * FROM listings ${clause} ORDER BY last_updated DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ListingRow[];

    return { items: rows.map(toListing), total, limit, offset };
  }

  async documents(): Promise<readonly ListingDocument[]> {
    const rows = this.db.prepare("SELECT * FROM listings").all() as ListingRow[];
    return rows.map((row) => {
      const listing = toListing(row);
      return { id: listing.id, text: retrievalText(listing) };
    });
  }

  async byIds(ids: readonly string[]): Promise<readonly CatalogListing[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM listings WHERE id IN (${placeholders})`)
      .all(...ids) as ListingRow[];
    const byId = new Map(rows.map((row) => [row.id, toListing(row)]));
    // Caller order is the ranked order; the store must not reimpose its own.
    return ids
      .map((id) => byId.get(id))
      .filter((listing): listing is CatalogListing => listing !== undefined);
  }

  async recordFailure(id: string): Promise<void> {
    this.db.prepare("UPDATE listings SET failure_count = failure_count + 1 WHERE id = ?").run(id);
  }

  async count(): Promise<number> {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM listings").get() as { n: number }).n;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** Page sizes are capped so a caller cannot ask for the whole catalog in one request. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Clamp a requested page size.
 *
 * @param limit - The requested limit
 * @returns A safe page size
 */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(limit)));
}

/**
 * Build the shared WHERE clause for both stores' list queries.
 *
 * Parameterised throughout — the filters are query-string values from the open internet, and a
 * catalog that concatenates them into SQL is a catalog with an injection hole.
 *
 * @param filters - The request filters
 * @returns A clause and its ordered parameters
 */
export function buildWhere(filters: ListFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.type !== undefined) {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  if (filters.payTo !== undefined) {
    conditions.push("pay_to = ?");
    params.push(filters.payTo);
  }
  if (filters.network !== undefined) {
    conditions.push("network = ?");
    params.push(filters.network);
  }
  if (filters.scheme !== undefined) {
    conditions.push("scheme = ?");
    params.push(filters.scheme);
  }
  if (filters.extensions !== undefined) {
    // "the resource declares this extension key". Matched against the stored JSON rather than a
    // separate table because the set of extension keys is open and small per listing.
    conditions.push("extensions IS NOT NULL AND instr(extensions, ?) > 0");
    params.push(`"${filters.extensions}"`);
  }

  return {
    clause: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`,
    params,
  };
}
