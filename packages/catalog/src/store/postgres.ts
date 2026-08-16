/**
 * The Postgres store — the hosted deployment's shape.
 *
 * Identical semantics to SQLite, because AC7.10 requires the same suite to pass against both. A
 * store whose behaviour differs by backend turns every published number and every integrity
 * guarantee into a claim about one deployment.
 *
 * ## §B.2, again, and it is sharper here
 *
 * SQLite serialises writers for you; Postgres does not. Two facilitator instances behind a load
 * balancer can settle two payments for the same `routeTemplate` at the same instant, in
 * different processes, on different machines. `SELECT … then INSERT` is a race with a window
 * measured in network round trips.
 *
 * The fix is to make the database perform the comparison, not the application: a single
 * `INSERT … ON CONFLICT (id) DO UPDATE … WHERE listings.pay_to = EXCLUDED.pay_to`. The `WHERE`
 * on the conflict target is the whole control — when the owner differs the update matches no
 * row, nothing is written, and `RETURNING` comes back empty. One statement, one round trip, no
 * window. A second read then reports who actually owns it.
 *
 * `pgvector` is deliberately **not** used for the semantic index. The vectors live in memory
 * alongside the lexical index so that both stores rank identically; pushing similarity into
 * Postgres would give the hosted deployment a different ranker from the self-hosted one, and
 * the published nDCG@10 would then describe neither.
 */

import { retrievalText } from "../search/rank.js";
import type {
  CatalogListing,
  CatalogStore,
  ListFilters,
  ListingDocument,
  ListPage,
} from "../types.js";
import { clampLimit } from "./sqlite.js";

/** The subset of `pg` this store uses. */
interface PgClient {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
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
  accepts          JSONB NOT NULL,
  description      TEXT,
  mime_type        TEXT,
  service_name     TEXT,
  tags             JSONB,
  icon_url         TEXT,
  extensions       JSONB,
  first_seen       TIMESTAMPTZ NOT NULL,
  last_updated     TIMESTAMPTZ NOT NULL,
  settlement_count INTEGER NOT NULL DEFAULT 0,
  failure_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS listings_type    ON listings(type);
CREATE INDEX IF NOT EXISTS listings_pay_to  ON listings(pay_to);
CREATE INDEX IF NOT EXISTS listings_network ON listings(network);
CREATE INDEX IF NOT EXISTS listings_scheme  ON listings(scheme);
CREATE INDEX IF NOT EXISTS listings_order   ON listings(last_updated DESC, id);
`;

function jsonb(value: unknown): unknown {
  return value === undefined ? null : JSON.stringify(value);
}

function parse<T>(value: unknown): T | undefined {
  if (value === null || value === undefined) return undefined;
  // `pg` already parses jsonb into JS values; a string only appears when the column is text.
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function toListing(row: Record<string, unknown>): CatalogListing {
  const iso = (value: unknown): string =>
    value instanceof Date ? value.toISOString() : String(value);

  return {
    id: String(row["id"]),
    type: row["type"] === "mcp" ? "mcp" : "http",
    resource: String(row["resource"]),
    ...(row["route_template"] == null ? {} : { routeTemplate: String(row["route_template"]) }),
    ...(row["tool_name"] == null ? {} : { toolName: String(row["tool_name"]) }),
    ...(row["method"] == null ? {} : { method: String(row["method"]) }),
    payTo: String(row["pay_to"]),
    network: String(row["network"]) as CatalogListing["network"],
    scheme: String(row["scheme"]),
    x402Version: Number(row["x402_version"]),
    accepts: (parse<CatalogListing["accepts"]>(row["accepts"]) ?? []) as CatalogListing["accepts"],
    ...(row["description"] == null ? {} : { description: String(row["description"]) }),
    ...(row["mime_type"] == null ? {} : { mimeType: String(row["mime_type"]) }),
    ...(row["service_name"] == null ? {} : { serviceName: String(row["service_name"]) }),
    ...(row["tags"] == null ? {} : { tags: parse<string[]>(row["tags"]) ?? [] }),
    ...(row["icon_url"] == null ? {} : { iconUrl: String(row["icon_url"]) }),
    ...(row["extensions"] == null
      ? {}
      : { extensions: parse<Record<string, unknown>>(row["extensions"]) ?? {} }),
    firstSeen: iso(row["first_seen"]),
    lastUpdated: iso(row["last_updated"]),
    settlementCount: Number(row["settlement_count"]),
    failureCount: Number(row["failure_count"]),
  };
}

/** A catalog store backed by Postgres. */
export class PostgresCatalogStore implements CatalogStore {
  private readonly client: PgClient;

  /**
   * @param client - A connected `pg` Client or Pool
   */
  constructor(client: PgClient) {
    this.client = client;
  }

  /**
   * Connect and migrate.
   *
   * @param connectionString - A Postgres connection URL
   * @returns A migrated store
   */
  static async connect(connectionString: string): Promise<PostgresCatalogStore> {
    const pg = (await import(/* @vite-ignore */ "pg")) as unknown as {
      default?: { Pool: new (config: { connectionString: string }) => PgClient };
      Pool?: new (config: { connectionString: string }) => PgClient;
    };
    const Pool = pg.Pool ?? pg.default?.Pool;
    if (Pool === undefined) throw new Error("pg is not installed");
    const store = new PostgresCatalogStore(new Pool({ connectionString }));
    await store.migrate();
    return store;
  }

  async migrate(): Promise<void> {
    await this.client.query(SCHEMA);
  }

  async get(id: string): Promise<CatalogListing | undefined> {
    const { rows } = await this.client.query("SELECT * FROM listings WHERE id = $1", [id]);
    const row = rows[0];
    return row === undefined ? undefined : toListing(row);
  }

  async upsert(
    listing: CatalogListing,
  ): Promise<{ outcome: "stored" } | { outcome: "ownerMismatch"; owner: string }> {
    // One statement. The `WHERE listings.pay_to = EXCLUDED.pay_to` on the conflict clause is the
    // ownership check, evaluated by the database under its own row lock — see this module's
    // header for why an application-side compare is a race here.
    const { rows } = await this.client.query(
      `INSERT INTO listings (
         id, type, resource, route_template, tool_name, method, pay_to, network, scheme,
         x402_version, accepts, description, mime_type, service_name, tags, icon_url,
         extensions, first_seen, last_updated, settlement_count, failure_count
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO UPDATE SET
         resource = EXCLUDED.resource,
         route_template = EXCLUDED.route_template,
         tool_name = EXCLUDED.tool_name,
         method = EXCLUDED.method,
         network = EXCLUDED.network,
         scheme = EXCLUDED.scheme,
         x402_version = EXCLUDED.x402_version,
         accepts = EXCLUDED.accepts,
         description = EXCLUDED.description,
         mime_type = EXCLUDED.mime_type,
         service_name = EXCLUDED.service_name,
         tags = EXCLUDED.tags,
         icon_url = EXCLUDED.icon_url,
         extensions = EXCLUDED.extensions,
         last_updated = EXCLUDED.last_updated,
         settlement_count = EXCLUDED.settlement_count
       WHERE listings.pay_to = EXCLUDED.pay_to
       RETURNING id`,
      [
        listing.id,
        listing.type,
        listing.resource,
        listing.routeTemplate ?? null,
        listing.toolName ?? null,
        listing.method ?? null,
        listing.payTo,
        listing.network,
        listing.scheme,
        listing.x402Version,
        jsonb(listing.accepts),
        listing.description ?? null,
        listing.mimeType ?? null,
        listing.serviceName ?? null,
        listing.tags === undefined ? null : jsonb(listing.tags),
        listing.iconUrl ?? null,
        listing.extensions === undefined ? null : jsonb(listing.extensions),
        listing.firstSeen,
        listing.lastUpdated,
        listing.settlementCount,
        listing.failureCount,
      ],
    );

    if (rows.length > 0) return { outcome: "stored" };

    // No row returned means the conflict clause's WHERE excluded it — a different owner holds
    // this id. Read it back so the caller can name the owner in the rejection.
    const existing = await this.get(listing.id);
    return { outcome: "ownerMismatch", owner: existing?.payTo ?? "unknown" };
  }

  async list(filters: ListFilters): Promise<ListPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace("?", `$${String(params.length)}`));
    };

    if (filters.type !== undefined) add("type = ?", filters.type);
    if (filters.payTo !== undefined) add("pay_to = ?", filters.payTo);
    if (filters.network !== undefined) add("network = ?", filters.network);
    if (filters.scheme !== undefined) add("scheme = ?", filters.scheme);
    if (filters.extensions !== undefined) add("extensions ? ?", filters.extensions);

    const clause = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const limit = clampLimit(filters.limit);
    const offset = Math.max(0, filters.offset ?? 0);

    const totalResult = await this.client.query(
      `SELECT COUNT(*)::int AS n FROM listings ${clause}`,
      params,
    );
    const total = Number(totalResult.rows[0]?.["n"] ?? 0);

    const { rows } = await this.client.query(
      `SELECT * FROM listings ${clause} ORDER BY last_updated DESC, id ASC
       LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
      [...params, limit, offset],
    );

    return { items: rows.map(toListing), total, limit, offset };
  }

  async documents(): Promise<readonly ListingDocument[]> {
    const { rows } = await this.client.query("SELECT * FROM listings");
    return rows.map((row) => {
      const listing = toListing(row);
      return { id: listing.id, text: retrievalText(listing) };
    });
  }

  async byIds(ids: readonly string[]): Promise<readonly CatalogListing[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.client.query("SELECT * FROM listings WHERE id = ANY($1)", [ids]);
    const byId = new Map(rows.map((row) => [String(row["id"]), toListing(row)]));
    return ids
      .map((id) => byId.get(id))
      .filter((listing): listing is CatalogListing => listing !== undefined);
  }

  async recordFailure(id: string): Promise<void> {
    await this.client.query("UPDATE listings SET failure_count = failure_count + 1 WHERE id = $1", [
      id,
    ]);
  }

  async count(): Promise<number> {
    const { rows } = await this.client.query("SELECT COUNT(*)::int AS n FROM listings");
    return Number(rows[0]?.["n"] ?? 0);
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
