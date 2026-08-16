/**
 * The two catalog backends, so one suite can be run against both (AC7.10).
 *
 * AC7.10 is not "a Postgres store exists". It is that **the same suite passes against both**,
 * and the difference matters: a store whose behaviour differs by backend turns every published
 * search number and every integrity guarantee into a claim about one deployment. The Postgres
 * store shipped in the first M7 session had never been executed, and the first run of this
 * module found a `list()` filter that could not have parsed — a defect invisible to typecheck,
 * to review, and to any suite that only ever opened SQLite.
 *
 * ## Isolation, and why each Postgres backend gets its own schema
 *
 * The tests write and count rows, so they cannot share a table. Each opened store creates a
 * fresh schema and pins the pool's `search_path` to it, which gives per-test isolation without
 * a database per test and without a `TRUNCATE` between tests that would hide a migration bug.
 *
 * ## Why a Pool rather than a single Client
 *
 * The §B.2 concurrency assertion needs two writers that are genuinely concurrent. A single
 * `pg.Client` serialises its queries, so a concurrency test run over one would pass without ever
 * racing anything — the plausible-fake shape again, this time in the harness rather than the
 * implementation. A pool opens real separate connections, so the race is real.
 *
 * Set `MOVO_CATALOG_TEST_POSTGRES_URL` to enable the Postgres backend. When it is absent the
 * Postgres rows **skip loudly** rather than silently reporting one backend as two.
 */

import { PostgresCatalogStore } from "../../packages/catalog/src/store/postgres.ts";
import { SqliteCatalogStore } from "../../packages/catalog/src/store/sqlite.ts";
import type { CatalogStore } from "../../packages/catalog/src/types.ts";

/** The connection URL for the Postgres backend, or undefined when it is not configured. */
export const POSTGRES_URL: string | undefined = process.env["MOVO_CATALOG_TEST_POSTGRES_URL"];

/** Whether the Postgres half of AC7.10 can run in this environment. */
export const POSTGRES_ENABLED: boolean = POSTGRES_URL !== undefined && POSTGRES_URL !== "";

/** One backend under test. */
export interface CatalogBackend {
  readonly name: "sqlite" | "postgres";
  /** True when this backend cannot run here and its rows should be skipped. */
  readonly skip: boolean;
  open(): Promise<CatalogStore>;
}

let schemaCounter = 0;

/**
 * Open a Postgres store in a schema of its own.
 *
 * @returns A migrated store isolated from every other store this run opened
 */
async function openPostgres(): Promise<CatalogStore> {
  const pg = (await import("pg")) as unknown as {
    default?: { Pool: new (config: Record<string, unknown>) => never };
    Pool?: new (config: Record<string, unknown>) => never;
  };
  const Pool = pg.Pool ?? pg.default?.Pool;
  if (Pool === undefined) throw new Error("pg is not installed");

  schemaCounter += 1;
  const schema = `movo_test_${String(process.pid)}_${String(schemaCounter)}`;

  // A throwaway connection creates the schema; the pool below is then pinned to it. `options`
  // is applied by node-postgres on every connection it opens, which is what makes the pinning
  // hold across the pool rather than only on the first connection.
  const bootstrap = new Pool({ connectionString: POSTGRES_URL }) as unknown as {
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
  await bootstrap.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await bootstrap.end();

  const pool = new Pool({
    connectionString: POSTGRES_URL,
    options: `-c search_path=${schema}`,
  }) as never;

  const store = new PostgresCatalogStore(pool);
  await store.migrate();
  return store;
}

/**
 * The backends AC7.10 names.
 *
 * SQLite always runs. Postgres runs when configured and is skipped — visibly — otherwise.
 */
export const CATALOG_BACKENDS: readonly CatalogBackend[] = [
  {
    name: "sqlite",
    skip: false,
    open: async () => SqliteCatalogStore.open(":memory:"),
  },
  {
    name: "postgres",
    skip: !POSTGRES_ENABLED,
    open: openPostgres,
  },
];
