---
"@movoframework/catalog": minor
"@movoframework/mcp": minor
"@movoframework/client": minor
"@movoframework/core": minor
---

Ship the Stellar Bazaar: automatic cataloguing at settle time, measured hybrid search, and an MCP
discovery server an agent can pay through.

**`@movoframework/catalog`.** A `CatalogStore` port with two implementations — SQLite for
self-hosters and tests, Postgres for hosted deployments — behind one suite that now runs against
both. Cataloguing hooks the facilitator's settle path and requires nothing of the seller: declare
discovery metadata, get paid once, be findable. Listings are keyed on `routeTemplate` for HTTP and
on the `(resource.url, toolName)` tuple for MCP, so a catalog grows with the number of endpoints
rather than with traffic.

Search is hybrid — BM25 over service names, descriptions, tags and per-parameter descriptions, plus
embedding similarity from a permissively licensed local model, fused with reciprocal-rank fusion,
demoted by failure rate, with activity counted only above a dust threshold. The numbers are
published with a build-failing floor. Ranking is never for sale.

`Catalog.searchListings` is new: the same ranking pass as `search`, returning the stored form so a
caller gets the listing id. `search` is now a projection of it, which is what makes
`GET /discovery/search` and `bazaar.search` provably the same ranker.

**Integrity is a trust boundary and the controls read the raw payload.** Upstream *soft-drops* an
invalid `routeTemplate` or `iconUrl`, so a control inspecting only upstream's output reports
success on the attack. Escalation therefore reads the raw resource extension before extraction and
escalates anything upstream discarded. `$ref` validation runs before the schema validator — the
validator resolves the schema and would otherwise dereference an attacker-supplied URL from the
settle path, and with the checks reversed the external-`$ref` attack reported the validator's
generic reason rather than its own, collapsing AC7.5's six distinct reasons to five on the only
path a real settlement takes.

**`@movoframework/mcp`.** `createMcpDiscoveryServer` exposes exactly three tools — `bazaar.search`,
`bazaar.get`, `bazaar.paidCall` — with structured deterministic I/O, machine-readable `MOVO_E_*`
codes from the single registry, and a non-null `reason` on every rejection, enforced by the type
rather than by a test.

`bazaar.paidCall` **requires** a budget. It takes the buyer's parts rather than a ready-made
client, because a client captures its budget in a closure where nothing can check it — this way
there is no argument that produces a paid-call tool with no spend cap. An over-budget call is
refused by an upstream `PaymentPolicy` before payment creation, so **no signature is ever
produced**; the refusal reports the budget's own code so an agent learns which constraint fired.

**`@movoframework/client` — a security fix.** `SettleResponse.amount` is optional and the `exact`
scheme does not populate it, so `budget.record` never ran on a real Stellar settlement, `spent()`
stayed at zero, and **`maxTotalSpend` was inert** — the per-request cap held while the cumulative
cap silently never fired. Settlements that report no amount are now counted against the amount the
policy authorised, which under `exact` is the same number by definition of the scheme. Found by an
e2e that asserted on the budget after a confirmed on-chain settlement rather than on the response
alone.

Also new: `MovoClient.callUrl`, which runs the full paid-call path — request building, payment
handling, spend accounting, catalog outcome — against a route the caller describes rather than a
`MovoResource`. That is what lets an agent pay for something it has no declaration for. `call` is
now implemented in terms of it, so neither can drift. `CallResult` gains `status`, because "did the
call work" and "was it paid for" are different questions.

**`@movoframework/core`.** Six new `MOVO_E_MCP_*` registry codes. They live in the one registry
rather than a namespace of their own, for the same reason `BAZAAR_E_*` was rejected: a prefix
naming the package a failure came from answers a question nobody asked.

Verified on Stellar testnet with confirmed on-chain transactions: a paid request makes an endpoint
findable with no registration step, natural-language search returns it, and an MCP agent searches,
selects and pays for a resource it holds no integration for.
