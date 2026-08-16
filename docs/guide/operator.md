# Operator

You want to run a facilitator, and probably a catalog with it. This is the path with real
operational consequences: a facilitator holds sponsor keys and submits transactions, and a catalog
is a trust boundary that anyone who can pay you a tenth of a cent can attempt to write to.

## What a facilitator actually does

It verifies a buyer's signed authorisation and settles it on Stellar — **sponsoring the fee**,
which is why the facilitator is the transaction source of every settled transaction it submits.

That fact matters more than it looks. It is *not* custody: the facilitator must never be the
transfer `from`, the operation source of the transfer, or an auth-entry signer for it. The buyer
authorises a transfer the facilitator cannot redirect. Being the fee payer is the service being
provided. Any invariant written as "the facilitator appears nowhere in the transaction" is
unsatisfiable by construction, and a catalog built on that reading refuses every legitimate listing
it is handed.

## Running one

```sh
MOVO_FACILITATOR_NETWORKS=stellar:testnet \
MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS=S…,S… \
pnpm --filter @movoframework/facilitator-service start
```

Sponsor seeds are the operational risk in this whole system. Keep them out of source control, out
of logs and out of environment dumps; on mainnet they belong behind a KMS or HSM, not in a
variable.

**A sponsor account is a mutex, not a weight.** A Stellar account's sequence number means
concurrent submissions from one account collide — spreading load *across* sponsors as if they were
weights produces exactly one successful settlement per account per ledger. Lease one at a time and
queue. This was found the hard way: an early load test reported green while 190 of 200 settlements
failed, because the failures were collapsed into an opaque reason and the assertion grepped for a
string that was no longer there.

`/ready` reports whether any signer is above its XLM floor. Alert on it. A facilitator whose
sponsors are drained verifies fine and settles nothing.

See [deployment](../operating-a-facilitator/deployment.md) and the
[runbook](../operating-a-facilitator/runbook.md).

## Adding a catalog

The catalog opens automatically unless `MOVO_CATALOG=off`. SQLite by default; set
`MOVO_CATALOG_POSTGRES_URL` for a hosted multi-instance deployment.

```ts
import { createCatalog, SqliteCatalogStore } from "@movoframework/catalog";

const store = await SqliteCatalogStore.open("movo-catalog.db");
const catalog = createCatalog({ store, embedder: "local" });
```

That gives you `GET /discovery/resources`, `GET /discovery/search`, a read-only `/browse` page, and
automatic cataloguing on every settlement that carries a discovery declaration.

[Running a catalog](../discovery/running-a-catalog.md) covers stores, scale, and the operational
detail. [Integrity](../discovery/integrity.md) covers the trust boundary — read it before you run
one in public.

## Adding an MCP discovery server

```ts no-check
import { createMcpDiscoveryServer } from "@movoframework/mcp";

const mcp = createMcpDiscoveryServer({
  catalog,
  buyer: {
    signer,
    network: "stellar:testnet",
    budget: { maxAmountPerRequest: "100000", maxTotalSpend: "10000000" },
  },
});
```

**The budget is yours, not the agent's.** There is no tool argument that raises it, and
`createMcpDiscoveryServer` refuses to build without one. Set it to what you are willing to lose if
an agent connected to this server behaves badly, because that is exactly what it is.

## The promises you are making

Running a catalog means people rely on it. Three worth being explicit about:

**Ranking is never for sale.** No sponsored placement, no paid ordering, no operator thumb on the
scale. The ranking signals are relevance, activity above a dust threshold, and failure rate. This
is stated in the docs, in the ADR, on the `/browse` page, and it is the kind of promise that is
worth nothing unless it is written down before there is money in it.

**The numbers are published.** [Search quality](../discovery/search-quality.md) carries the actual
nDCG@10 and recall@20, the corpus size, the methodology and the refresh process. An unevaluated
ranker is a claim, not a feature.

**Inclusion is not editorial.** A resource is listed because it was paid for through you. You are
not curating.

## Upkeep

Discovery conventions are still moving. The conformance suite is how you find out you have drifted,
and the honest cost of operating a facilitator is roughly a one-week turnaround per convention
change, indefinitely. A facilitator that stops tracking the spec is worse than none — this is
explicitly the failure mode the SCF RFP screens for. If you cannot commit to that, run the
framework and point sellers at somebody else's facilitator; nothing in the core track requires you
to operate one.

## Pubnet

Testnet is proven. Pubnet requires funded sponsors, a KMS or HSM signer, an RPC provider with an
SLA, and a security review — all with lead times measured in weeks. Start them before you need
them, not at release. Movo refuses to run its in-process development facilitator against pubnet at
all, regardless of `MOVO_ALLOW_PUBNET`, because no development scenario wants it.

## See also

- [Deployment](../operating-a-facilitator/deployment.md)
- [Signers and channel accounts](../operating-a-facilitator/signers-and-channel-accounts.md)
- [Runbook](../operating-a-facilitator/runbook.md)
- [ADR-0013](../adr/0013-discovery-architecture.md)
