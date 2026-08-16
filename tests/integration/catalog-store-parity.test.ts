import { afterEach, describe, expect, it } from "vitest";
import { createCatalog } from "../../packages/catalog/src/catalog.ts";
import { listingKey } from "../../packages/catalog/src/ingest.ts";
import { ADVERSARIAL_CONTROLS, INGEST_REASONS } from "../../packages/catalog/src/reasons.ts";
import type {
  CatalogListing,
  CatalogStore,
  IngestContext,
} from "../../packages/catalog/src/types.ts";
import { CATALOG_BACKENDS, type CatalogBackend } from "../support/catalog-stores.ts";

/**
 * AC7.10 — the full catalog suite against **both** SQLite and Postgres.
 *
 * The criterion is parity, not existence. Everything here runs twice against two genuinely
 * different engines: SQLite serialises its writers, Postgres does not; SQLite stores timestamps
 * as text, Postgres as `TIMESTAMPTZ`; SQLite has `instr` over JSON text, Postgres has
 * `jsonb_exists`. Each of those is a place where the two could silently disagree, and each is
 * asserted below rather than assumed.
 *
 * **Assertions are on stored state.** Every adversarial case checks what the store contains —
 * the row count, the surviving owner — with the reason as a secondary signal. §B.2: a reason
 * string is evidence about what the code said; the store is evidence about what it did, and M6
 * shipped a green gate over 190 failed settlements by trusting the former.
 */

const SELLER = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";
const RIVAL = "GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV";
const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const open: CatalogStore[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((store) => store.close().catch(() => undefined)));
});

async function store(backend: CatalogBackend): Promise<CatalogStore> {
  const opened = await backend.open();
  open.push(opened);
  return opened;
}

/** A well-formed declaration, with the one field under test overridable. */
function declaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    info: {
      input: {
        type: "http",
        method: "GET",
        discoverable: true,
        queryParams: { city: { type: "string", description: "IATA airport code" } },
      },
      output: { type: "object" },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { input: { type: "object" }, output: { type: "object" } },
      required: ["input"],
    },
    routeTemplate: "/weather/:city",
    ...overrides,
  };
}

interface SettlementOptions {
  readonly payTo?: string;
  readonly echoedPayTo?: string;
  readonly url?: string;
  readonly amount?: string;
  readonly serviceName?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly iconUrl?: string;
  readonly extension?: Record<string, unknown>;
}

function settlement(options: SettlementOptions = {}): IngestContext {
  const payTo = options.payTo ?? SELLER;
  const resource = {
    url: options.url ?? "https://weather.example.com/weather/SFO",
    serviceName: options.serviceName ?? "Example Weather",
    description: options.description ?? "Current weather conditions for a city",
    tags: options.tags === undefined ? ["weather", "forecast"] : [...options.tags],
    ...(options.iconUrl === undefined ? {} : { iconUrl: options.iconUrl }),
  };
  const requirements = {
    scheme: "exact",
    network: "stellar:testnet",
    amount: options.amount ?? "10000",
    asset: ASSET,
    payTo,
    maxTimeoutSeconds: 300,
    resource,
  };

  return {
    paymentPayload: {
      x402Version: 2,
      accepted: { ...requirements, payTo: options.echoedPayTo ?? payTo },
      resource,
      payload: { transaction: "AAAA" },
      extensions: { bazaar: options.extension ?? declaration() },
    },
    paymentRequirements: requirements as never,
    settleResponse: {
      success: true,
      transaction: "not-an-on-chain-hash",
      network: "stellar:testnet",
    },
  } as IngestContext;
}

const WEATHER_ID = listingKey("http", "/weather/:city");

for (const backend of CATALOG_BACKENDS) {
  // `describe.skipIf` rather than omitting the block, so an unconfigured Postgres shows as a
  // skipped row in the report instead of silently reporting one backend as two.
  describe.skipIf(backend.skip)(`AC7.10 — ${backend.name}`, () => {
    describe("the store port's contract", () => {
      it("stores, reads back and counts a listing", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const outcome = await catalog.ingest(settlement());
        expect(outcome.status).toBe("success");
        expect(await backing.count()).toBe(1);

        const stored = await backing.get(WEATHER_ID);
        expect(stored?.payTo).toBe(SELLER);
        expect(stored?.routeTemplate).toBe("/weather/:city");
        expect(stored?.serviceName).toBe("Example Weather");
        expect(stored?.tags).toEqual(["weather", "forecast"]);
        // Round-tripping the timestamp is where the two engines could diverge: text in SQLite,
        // TIMESTAMPTZ in Postgres. Both must yield a parseable ISO 8601 instant.
        expect(Number.isNaN(Date.parse(stored?.lastUpdated ?? ""))).toBe(false);
        expect(Number.isNaN(Date.parse(stored?.firstSeen ?? ""))).toBe(false);
      });

      it("collapses many concrete paths onto one listing, and keeps firstSeen", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        await catalog.ingest(settlement({ url: "https://weather.example.com/weather/SFO" }));
        const first = await backing.get(WEATHER_ID);

        await catalog.ingest(settlement({ url: "https://weather.example.com/weather/LHR" }));
        await catalog.ingest(settlement({ url: "https://weather.example.com/weather/JFK" }));

        expect(await backing.count()).toBe(1);
        const stored = await backing.get(WEATHER_ID);
        expect(stored?.firstSeen).toBe(first?.firstSeen);
        expect(stored?.settlementCount).toBe(3);
      });

      it("applies every specification filter, including the JSON extensions filter", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });
        await catalog.ingest(settlement());

        expect((await backing.list({ type: "http" })).total).toBe(1);
        expect((await backing.list({ type: "mcp" })).total).toBe(0);
        expect((await backing.list({ payTo: SELLER })).total).toBe(1);
        expect((await backing.list({ payTo: RIVAL })).total).toBe(0);
        expect((await backing.list({ network: "stellar:testnet" })).total).toBe(1);
        expect((await backing.list({ network: "stellar:pubnet" })).total).toBe(0);
        expect((await backing.list({ scheme: "exact" })).total).toBe(1);
        expect((await backing.list({ scheme: "upto" })).total).toBe(0);

        // The filter that had never been executed against Postgres. `instr` over JSON text on
        // one engine, `jsonb_exists` on the other, one answer.
        expect((await backing.list({ extensions: "bazaar" })).total).toBe(1);
        expect((await backing.list({ extensions: "no-such-extension" })).total).toBe(0);

        // Combined, and the total is the true total rather than the page's length.
        const combined = await backing.list({ type: "http", payTo: SELLER, limit: 1 });
        expect(combined.total).toBe(1);
        expect(combined.items).toHaveLength(1);
      });

      it("orders stably and paginates without repeating or dropping a listing", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        for (let index = 0; index < 7; index += 1) {
          await catalog.ingest(
            settlement({
              url: `https://svc${String(index)}.example.com/weather/SFO`,
              extension: declaration({ routeTemplate: `/svc${String(index)}/:city` }),
            }),
          );
        }
        expect(await backing.count()).toBe(7);

        const seen: string[] = [];
        for (let offset = 0; offset < 7; offset += 3) {
          const page = await backing.list({ limit: 3, offset });
          seen.push(...page.items.map((listing) => listing.id));
          expect(page.total).toBe(7);
        }

        expect(seen).toHaveLength(7);
        expect(new Set(seen).size).toBe(7);

        // Stable: the same query twice yields the same order.
        const once = (await backing.list({ limit: 7 })).items.map((listing) => listing.id);
        const twice = (await backing.list({ limit: 7 })).items.map((listing) => listing.id);
        expect(twice).toEqual(once);
      });

      it("caps the page size rather than honouring an unbounded limit", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });
        await catalog.ingest(settlement());

        const page = await backing.list({ limit: 100_000 });
        expect(page.limit).toBeLessThanOrEqual(100);
      });

      it("hydrates by id in the caller's order, and drops ids it does not hold", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        await catalog.ingest(settlement({ extension: declaration({ routeTemplate: "/a/:x" }) }));
        await catalog.ingest(settlement({ extension: declaration({ routeTemplate: "/b/:x" }) }));

        const a = listingKey("http", "/a/:x");
        const b = listingKey("http", "/b/:x");

        expect((await backing.byIds([b, a])).map((listing) => listing.id)).toEqual([b, a]);
        expect((await backing.byIds([a, "absent", b])).map((listing) => listing.id)).toEqual([
          a,
          b,
        ]);
        expect(await backing.byIds([])).toEqual([]);
      });

      it("records a failure against a listing", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });
        await catalog.ingest(settlement());

        await backing.recordFailure(WEATHER_ID);
        await backing.recordFailure(WEATHER_ID);

        expect((await backing.get(WEATHER_ID))?.failureCount).toBe(2);
      });

      it("produces a retrieval document per listing", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });
        await catalog.ingest(settlement());

        const documents = await backing.documents();
        expect(documents).toHaveLength(1);
        expect(documents[0]?.id).toBe(WEATHER_ID);
        expect(documents[0]?.text.toLowerCase()).toContain("weather");
      });

      it("migrates idempotently", async () => {
        const backing = await store(backend);
        await backing.migrate();
        await backing.migrate();
        expect(await backing.count()).toBe(0);
      });
    });

    describe("AC7.5 — the six adversarial controls fail closed on this backend too", () => {
      it("1. refuses to let one seller overwrite another's listing, and the owner is unchanged", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        await catalog.ingest(settlement({ payTo: SELLER }));
        const outcome = await catalog.ingest(settlement({ payTo: RIVAL }));

        expect(outcome.status).toBe("rejected");
        expect(outcome.status === "rejected" && outcome.rejectedReason).toBe(
          ADVERSARIAL_CONTROLS["overwrite another seller's listing"],
        );
        // The state, which is the assertion that matters.
        expect((await backing.get(WEATHER_ID))?.payTo).toBe(SELLER);
        expect(await backing.count()).toBe(1);
      });

      it("2. refuses a forged payTo — nothing lands at all", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const outcome = await catalog.ingest(settlement({ payTo: SELLER, echoedPayTo: RIVAL }));

        expect(outcome.status === "rejected" && outcome.rejectedReason).toBe(
          ADVERSARIAL_CONTROLS["forge payTo"],
        );
        expect(await backing.count()).toBe(0);
      });

      it("3. refuses percent-encoded traversal in routeTemplate — nothing lands", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const outcome = await catalog.ingest(
          settlement({ extension: declaration({ routeTemplate: "/weather/%2e%2e%2fadmin" }) }),
        );

        expect(outcome.status === "rejected" && outcome.rejectedReason).toBe(
          ADVERSARIAL_CONTROLS["percent-encoded traversal in routeTemplate"],
        );
        expect(await backing.count()).toBe(0);
      });

      it("4. refuses a loopback iconUrl — nothing lands", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const outcome = await catalog.ingest(
          settlement({ iconUrl: "http://127.0.0.1:8080/icon.png" }),
        );

        expect(outcome.status === "rejected" && outcome.rejectedReason).toBe(
          ADVERSARIAL_CONTROLS["loopback iconUrl"],
        );
        expect(await backing.count()).toBe(0);
      });

      it("5. refuses an external $ref — nothing lands", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const outcome = await catalog.ingest(
          settlement({
            extension: declaration({
              // The schema stays consistent with `info`, so upstream's own validation passes
              // and the ONLY thing that can refuse this is Movo's `$ref` control. A fixture
              // that also broke info-vs-schema consistency would be refused a step earlier and
              // would prove nothing about the control it is named after.
              schema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                properties: { input: { type: "object" }, output: { type: "object" } },
                required: ["input"],
                $defs: { fetched: { $ref: "https://evil.example.com/schema.json" } },
              },
            }),
          }),
        );

        expect(outcome.status === "rejected" && outcome.rejectedReason).toBe(
          ADVERSARIAL_CONTROLS["external $ref"],
        );
        expect(await backing.count()).toBe(0);
      });

      it("6. refuses oversized fields — nothing lands", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const outcome = await catalog.ingest(settlement({ description: "x".repeat(100_000) }));

        expect(outcome.status === "rejected" && outcome.rejectedReason).toBe(
          ADVERSARIAL_CONTROLS["oversized fields"],
        );
        expect(await backing.count()).toBe(0);
      });

      it("produces six pairwise-distinct reasons", () => {
        const reasons = Object.values(ADVERSARIAL_CONTROLS);
        expect(reasons).toHaveLength(6);
        expect(new Set(reasons).size).toBe(6);
        for (const reason of reasons) expect(reason).not.toBe("");
      });
    });

    describe("§B.2 — the write path is mutex-correct on this backend", () => {
      it("lets exactly one of two concurrent conflicting writers win", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        // Both settle for the same routeTemplate at the same instant, naming different owners.
        // Neither has read the store first, so a read-then-write implementation lets both
        // through. The assertion is on the surviving state, never on a reason string.
        const [first, second] = await Promise.all([
          catalog.ingest(settlement({ payTo: SELLER })),
          catalog.ingest(settlement({ payTo: RIVAL })),
        ]);

        const outcomes = [first.status, second.status].sort();
        expect(outcomes).toEqual(["rejected", "success"]);

        expect(await backing.count()).toBe(1);
        const survivor = await backing.get(WEATHER_ID);
        expect([SELLER, RIVAL]).toContain(survivor?.payTo);

        // And the loser cannot take it afterwards either.
        const loser = survivor?.payTo === SELLER ? RIVAL : SELLER;
        const late = await catalog.ingest(settlement({ payTo: loser }));
        expect(late.status).toBe("rejected");
        expect(late.status === "rejected" && late.rejectedReason).toBe(
          INGEST_REASONS.ownerMismatch,
        );
        expect((await backing.get(WEATHER_ID))?.payTo).toBe(survivor?.payTo);
      });

      it("keeps the row count correct under many concurrent identical writers", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        const results = await Promise.all(
          Array.from({ length: 12 }, () => catalog.ingest(settlement({ payTo: SELLER }))),
        );

        // Same owner, so every write is legitimate — but they must collapse onto one row.
        expect(results.every((outcome) => outcome.status === "success")).toBe(true);
        expect(await backing.count()).toBe(1);
      });
    });

    describe("activity counting", () => {
      it("does not count a settlement below the dust threshold", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({
          store: backing,
          embedder: undefined,
          ingest: { dustThresholdAtomic: 1_000n },
        });

        await catalog.ingest(settlement({ amount: "10000" }));
        expect((await backing.get(WEATHER_ID))?.settlementCount).toBe(1);

        // One stroop. The listing is still refreshed — the endpoint is real — but activity,
        // which feeds ranking, does not move.
        await catalog.ingest(settlement({ amount: "1" }));
        const stored: CatalogListing | undefined = await backing.get(WEATHER_ID);
        expect(stored?.settlementCount).toBe(1);
        expect(await backing.count()).toBe(1);
      });
    });

    describe("search parity", () => {
      it("ranks the same listing top on this backend, with ids the agent can act on", async () => {
        const backing = await store(backend);
        const catalog = createCatalog({ store: backing, embedder: undefined });

        await catalog.ingest(settlement());
        await catalog.ingest(
          settlement({
            serviceName: "Freight Rates",
            description: "Container shipping rates between ports",
            tags: ["freight", "logistics"],
            extension: declaration({ routeTemplate: "/rates/:lane" }),
          }),
        );

        const page = await catalog.searchListings({ query: "weather forecast" });
        expect(page.listings[0]?.serviceName).toBe("Example Weather");
        expect(page.listings[0]?.id).toBe(WEATHER_ID);

        // The wire projection agrees with the stored one — same ranker, one pass.
        const wire = await catalog.search({ query: "weather forecast" });
        expect(wire.resources.map((resource) => resource.resource)).toEqual(
          page.listings.map((listing) => listing.resource),
        );
      });
    });
  });
}
