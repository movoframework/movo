# Running a catalog

A Bazaar catalog is an index of resources that have been **paid for at least once through your
facilitator**. There is no registration endpoint, no submission form and no approval queue — a
seller declares discovery metadata on their resource, a buyer pays and echoes the declaration, and
the facilitator that settled the payment catalogues it.

That design decision is load-bearing rather than cosmetic. Anything requiring a seller to act after
being paid gets skipped by exactly the developers a catalog exists to serve.

## Turning it on

The facilitator service opens a catalog automatically unless you switch it off.

| Variable | Effect |
|---|---|
| `MOVO_CATALOG=off` | No catalog. `/discovery/*` and `/browse` are not mounted. |
| `MOVO_CATALOG_SQLITE_PATH` | SQLite file. Defaults to `movo-catalog.db`. |
| `MOVO_CATALOG_POSTGRES_URL` | Use Postgres instead of SQLite. |
| `MOVO_CATALOG_EMBEDDINGS=off` | Lexical retrieval only. Search then reports `partialResults: true`. |

Wiring it yourself is four lines:

```ts
import { createCatalog, SqliteCatalogStore } from "@movoframework/catalog";

const store = await SqliteCatalogStore.open("movo-catalog.db");
const catalog = createCatalog({ store, embedder: "local" });
```

`embedder: "local"` lazily loads an Apache-2.0 MiniLM model on first search. It is optional at
install time; when the peer dependency is absent the catalog runs lexical-only and says so, rather
than dropping quality silently. See [search quality](./search-quality.md) for what the difference
is worth, measured.

## Which store

**SQLite** is the default and the preference. A catalog whose cheapest deployment needs a database
cluster is a catalog most self-hosters will not run. It serialises its own writers, so the
ownership race described below cannot occur.

**Postgres** is for hosted deployments running more than one facilitator instance. Two instances
behind a load balancer can settle two payments for the same route at the same instant, in different
processes; the ownership check is therefore performed by the database in a single
`INSERT … ON CONFLICT … WHERE listings.pay_to = EXCLUDED.pay_to`, not by the application.

`pgvector` is deliberately **not** used. Vectors live in memory alongside the lexical index so both
stores rank identically — pushing similarity into Postgres would give the hosted deployment a
different ranker from the self-hosted one, and the published nDCG@10 would then describe neither.

Both stores pass the same suite (`tests/integration/catalog-store-parity.test.ts`). Run the
Postgres half with:

```sh
MOVO_CATALOG_TEST_POSTGRES_URL=postgres://user:pass@host:5432/db pnpm test:integration
```

Without that variable the Postgres rows skip visibly rather than silently reporting one backend as
two.

## Scale, and when this design stops fitting

The lexical index is rebuilt in memory from the store on change; the semantic index is incremental,
because re-embedding the whole catalog on every ingest would make cataloguing cost grow with
catalog size — the wrong shape for a hook on the settle path.

At a facilitator's own scale — thousands of listings, not millions — that trade is right: no index
to keep consistent with the store and no separate service. Somewhere in the **tens of thousands of
listings** the rebuild cost stops being free and memory becomes the constraint. The seam is
`CatalogStore.documents()`: a store that owns its own index implements search behind the same port,
and nothing above it changes.

## Operating it

**`/browse`** is a read-only server-rendered page. It is not a marketplace: no accounts, no
operator-controlled ordering, no promotion. It exists because a catalog nobody can look at is hard
to trust or debug.

**Rejections.** Every ingest that refuses reports a distinct `listing_*` reason in the settle
response's `EXTENSION-RESPONSES` header. The six adversarial ones are covered in
[integrity](./integrity.md); the rest are ordinary:

| Reason | Usually means |
|---|---|
| `listing_not_discoverable` | The payment carried no bazaar extension. Not an error — most payments do not. |
| `listing_settlement_unsuccessful` | The settlement failed, so there is nothing to catalogue. |
| `listing_info_invalid` | The seller's `info` does not validate against their own declared `schema`. |
| `listing_spec_invalid` | The declaration violates the Bazaar protocol specification. |

**Dust.** A settlement below `dustThresholdAtomic` (default 1000 base units, $0.0001 at USDC's
seven decimals) still creates and refreshes the listing — the endpoint is real — but does not
increment `settlementCount`. That number feeds ranking, and without a floor a seller buys apparent
traffic one stroop at a time.

**Backups.** The catalog is derived data: every listing came from a settlement, and a lost catalog
rebuilds itself as sellers get paid again. Back it up for continuity of ranking signals
(`settlementCount`, `failureCount`, `firstSeen`), not because the data is irreplaceable.

## A seller declared metadata and nothing appeared

In order of likelihood:

1. **Nobody has paid them yet.** A catalog holds resources that have been paid for. This is the
   answer most of the time.
2. **They are pointed at a different facilitator.** Cataloguing happens at the facilitator that
   settled the payment. If their `MOVO_FACILITATOR_URL` is the public one, their listing is in
   whatever catalog that operator runs — or in none.
3. **The declaration was refused.** Check the settle log for a `listing_*` reason.
4. **They declared no `routeTemplate`.** The listing still appears, but keyed on the concrete path,
   so `/weather/SFO` and `/weather/LHR` become two listings. Declaring a template collapses them.

[Troubleshooting visibility](../bazaar/troubleshooting-visibility.md) covers the seller's side.

## Known upstream gap

**The buyer never sees `EXTENSION-RESPONSES`.** Upstream's resource server reads the header from
the facilitator's settle response and *logs* it (`logExtensionResponsesHeader` in `@x402/core`) but
does not forward it to the buyer. So a buyer's `readCatalogOutcome` returns `unknown` through any
x402 resource server today, no matter what the facilitator reported.

`unknown` is a first-class state precisely because of this, and it is not a failure. Forwarding the
header to the buyer is logged as an upstream contribution; until it lands, a seller confirming their
listing should query `/discovery/resources` rather than expect the buyer's response to tell them.

## See also

- [Catalog integrity](./integrity.md) — the trust boundary and its six controls
- [Search quality](./search-quality.md) — the measured numbers and the methodology
- [The MCP discovery server](../mcp/discovery-server.md)
- [ADR-0013](../adr/0013-discovery-architecture.md) — why the index is off-chain
