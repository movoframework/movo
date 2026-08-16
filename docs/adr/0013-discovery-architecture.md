# ADR-0013 — Discovery architecture

- **Status:** Accepted
- **Date:** 2026-08-16
- **Supersedes:** nothing
- **Related:** [ADR-0010 Bazaar boundary](./0010-bazaar-boundary.md),
  [ADR-0012 Facilitator architecture](./0012-facilitator-architecture.md)

## Context

M7 makes Stellar resources discoverable. Four decisions had to be made before any of it could be
built, and three of them are decisions to *not* do something.

No existing catalog carries Stellar — the reference implementations list Base and Solana — so this
is a genuine gap rather than a duplication. That also means there is no prior art to copy for the
parts that are Stellar-specific, and no established operator whose behaviour sets an expectation.

## Decision 1 — The index is off-chain

**A Soroban registry contract is rejected for v1.**

Three reasons, in order of weight:

1. **It doubles the per-payment cost.** Cataloguing happens on the settle path. Writing to a
   contract there adds a second on-chain operation to every discoverable payment, paid for by the
   facilitator, for an index nobody reads on-chain.
2. **Rent and TTL eviction make availability a funding problem.** Soroban state expires. A catalog
   that silently loses listings because nobody topped up a rent balance is worse than no catalog,
   because the failure is invisible until someone goes looking for a resource that used to be
   there.
3. **The index is derived data.** Every listing came from a settlement. A lost catalog rebuilds
   itself as sellers get paid again. Paying on-chain costs to make derived data durable is paying
   for the wrong property.

**What we give up:** censorship-resistance and cross-facilitator canonicality. A listing lives in
the catalog of whichever facilitator settled the payment, and that operator can drop it. We think
that is the correct trade for v1 and we say so in the documentation rather than implying a
neutrality the architecture does not provide.

**The seam if this changes:** `CatalogStore` is a port. An on-chain-backed store implements it
without anything above it changing. Nothing in the design forecloses the decision.

## Decision 2 — Ranking is never for sale

**No sponsored placement, no paid ordering, no operator thumb on the scale — ever.**

This is a product decision recorded in an architecture document on purpose. It costs nothing to
make now and is nearly impossible to make later, once there is revenue attached to reversing it.
The ranking inputs are:

- relevance (BM25 + embedding similarity, fused with reciprocal-rank fusion)
- activity, counted only above a dust threshold so it cannot be bought at a rounding error
- failure rate, as a demotion

Stated in [search quality](../discovery/search-quality.md), in the
[operator guide](../guide/operator.md), and on the `/browse` page itself.

The corollary is that search quality must be **measured**, or the promise is unfalsifiable. An
unevaluated ranker may not be described as "real ranking" in any Movo document. The published
nDCG@10 and recall@20, their floors, the corpus and the refresh process are the discharge of that.

## Decision 3 — Cataloguing happens at settle time, and requires nothing of the seller

**No registration endpoint. Not even as a convenience.**

A seller declares discovery metadata on their resource; a buyer pays and echoes it; the facilitator
that settled catalogues it. Manual registration would be a second step, and a second step gets
skipped by exactly the developers a catalog exists to serve.

Two consequences we accept:

- A resource nobody has paid for is not listed. The catalog is an index of things that have
  transacted, which is a narrower and more honest claim than "an index of things that exist".
- Ingest runs on the settle path, so it must be cheap and it must never be able to fail a payment.
  The observer receives a finished settlement and returns only what to report in
  `EXTENSION-RESPONSES`. A catalog that could fail a payment would make discovery a liability for
  every seller using the facilitator.

## Decision 4 — The catalog is a trust boundary, and controls read the raw payload

Clients echo the seller's resource block into the payment payload, so every ingested field is
attacker-influenced. Six controls fail closed with distinct, non-null reasons; ownership comes from
the `payTo` that actually settled.

The architecturally interesting part is **where** the controls read from. Upstream *soft-drops*
invalid fields — an invalid `routeTemplate` is discarded and the listing falls back to the concrete
path; an invalid `iconUrl` is silently removed. A control inspecting only upstream's output
therefore sees a clean result and reports success on the attack.

**Ruling: integrity escalation reads the raw resource extension from the payload, before upstream
extraction, and escalates any field upstream soft-dropped.** Asserting on post-extraction output
alone is not a weaker check; it is a check that passes because the evidence was swallowed.

The same reasoning fixes the check *order*: `$ref` validation runs before the schema validator,
because the validator resolves the schema and would otherwise dereference an attacker-supplied URL
from the settle path — and because with the checks reversed the external-`$ref` attack reported the
validator's generic reason instead of its own, collapsing six distinct reasons to five on the only
path that matters.

See [integrity](../discovery/integrity.md).

## Decision 5 — The MCP server exposes three tools and constructs its own buyer

`bazaar.search`, `bazaar.get`, `bazaar.paidCall`. No orchestration, no memory, no planning.

`createMcpDiscoveryServer` takes the buyer's *parts* — signer, network, budget options — rather
than a ready-made client. The specification sketched `{ catalog, client }`, but a `MovoClient`
captures its budget in a closure where nothing can inspect it, so accepting one would reduce
"`bazaar.paidCall` **requires** a budget policy" to a comment asking the caller to have been
careful. Constructing the client internally makes the requirement structural: there is no argument
that yields a paid-call tool without a spend cap.

Refusal is upstream's `PaymentPolicy`, which runs before payment creation — so an over-budget call
produces **no signature at all**, rather than one that merely went unsubmitted.

## Consequences

- Discovery is available to any self-hoster with a SQLite file and no additional infrastructure.
- Hosted deployments get Postgres with database-side ownership checks; both stores pass one suite.
- Search quality is a published number with a build-failing floor rather than an assertion.
- Stellar resources are legible to any stock x402 client, because the wire shapes are upstream's.
- We do not own a neutral registry, and we say so.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Soroban registry contract | Decision 1 |
| Federating across facilitators | No convention exists yet; premature |
| A marketplace UI | Not a marketplace. `/browse` is read-only and unordered by the operator |
| `pgvector` for the semantic index | Would give hosted and self-hosted deployments different rankers, and the published number would describe neither |
| The `upto` scheme | Out of M7 scope; the extension point stays open |
| Writing our own validators | `@x402/extensions` owns the rules. Movo escalates; it does not reimplement |
