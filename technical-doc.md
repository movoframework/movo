# Movo Technical Document

Movo is an open-source TypeScript framework and operations toolkit for building machine-payable HTTP APIs on Stellar using x402.

| Field | Value |
|---|---|
| Status | Testnet-ready. Not production-ready. |
| Milestones | M0 through M7 complete. M8 not started. |
| Repository | https://github.com/movoframework/movo |
| Licence | Apache-2.0 |
| Language | TypeScript 7, ESM only, Node.js 22 or later |
| Protocol | x402 via `@x402/core` 2.21.0 and `@x402/stellar` 2.21.0 |
| Chain | Stellar and Soroban. `stellar:testnet` proven. `stellar:pubnet` never run. |
| Packages | 11 publishable packages. 1 private service. 5 examples. |
| Published | Nothing. All packages sit at version `0.0.0`. |

This document describes what the repository contains. Where the repository and any prior summary disagree the repository wins.

## Evidence at a glance

Every claim below can be checked by running a command or reading a file.

| Claim | How to verify |
|---|---|
| The full payment path settles on Stellar testnet | `MOVO_E2E=1 pnpm test:e2e`. Hashes in `docs/CONFORMANCE.md`. |
| x402's own compatibility suite passes 7 of 7 | `docs/CONFORMANCE.md` section AC6.4. Seven hashes listed. |
| Search quality is measured | `pnpm test:search-eval`. Numbers in `docs/discovery/search-quality.md`. |
| No protocol primitive is reimplemented | `pnpm check:protocol-purity` |
| Every validation call resolves to an upstream export | `pnpm check:upstream-validators` |
| The core track never imports the RFP track | `pnpm check:track-isolation` |
| No package generates a private key | `pnpm check:key-generation` |
| No copyleft licence anywhere in the tree | `pnpm check:licenses` |
| Core line coverage exceeds its floor | `pnpm vitest run --project unit --coverage` |
| An agent discovers and pays over MCP | `tests/e2e/mcp-agent-discovery.test.ts` |

Each compliance gate ships with a proof-of-failure fixture. A gate that cannot be shown to fail is not evidence.

## 1. What Movo is

Movo sits between a developer and four moving parts.

**x402** is an HTTP payment protocol. A server answers an unpaid request with `402 Payment Required` and machine-readable terms. A client signs an authorization. A facilitator verifies it and settles it. The protocol is implemented in the `@x402/*` packages.

**Stellar** is the settlement network. Movo targets the `exact` scheme over Soroban with SEP-41 tokens. USDC is the default asset.

**Bazaar** is the x402 discovery extension. A seller attaches metadata to their payment terms. A facilitator that settles the payment can catalog the resource. Buyers query that catalog.

**MCP** is the Model Context Protocol. It is how an AI agent runtime learns which tools it can call.

**Movo** is the project layer around all four. It gives a developer one typed resource declaration that produces a paid route, a discovery declaration and a test fixture. It gives an operator a facilitator, a catalog with ranked search and an MCP server. It reimplements none of the protocol.

The split matters. `@x402/*` owns the wire. Movo owns the project and the operations around it.

## 2. The problem Movo solves

Building a paid API on Stellar with x402 alone means coordinating several things by hand.

- Route configuration lives in one object literal.
- Payment terms live beside it and must agree with it.
- Stellar specifics such as the asset contract and its decimals must be resolved separately.
- Bazaar discovery metadata must be written a second time and kept in step with the route.
- A JSON Schema for parameters must be authored by hand or omitted.
- Tests for payment failure modes must be built from scratch.
- Facilitator selection and environment separation are the developer's problem.
- Nothing checks that the receiving account is funded or holds the right trustline until a payment fails.

Each item is small. Together they are the reason a first Stellar x402 integration takes an afternoon rather than an hour.

Movo compiles one declaration into all of them. The route and the discovery declaration cannot drift because they come from the same source. Preflight runs before a payment is attempted rather than after one fails. The failure modes ship as a test matrix.

Movo does not replace x402. Remove Movo and the protocol still works. Remove x402 and Movo has nothing to compose.

## 3. Why Movo exists above `@x402/*`

The upstream SDK is more complete than its documentation suggests. Reading the installed type declarations rather than the docs is the only reliable way to see this. Movo treats that reading as a standing rule.

Upstream already provides the following.

| Provided upstream | Package |
|---|---|
| Route configuration and the payment middleware | `@x402/core` and `@x402/express` |
| The verify then handler then settle lifecycle with hooks | `@x402/core` |
| Payment requirement encoding and the 402 headers | `@x402/core` |
| Payload creation and client fetch wrapping | `@x402/core` and `@x402/fetch` |
| Soroban auth entries, XDR, signing and submission | `@x402/stellar` |
| Stellar constants, address and asset validators, signers | `@x402/stellar` |
| Bazaar declaration, validation and sanitisation | `@x402/extensions` |
| A facilitator primitive | `@x402/core/facilitator` |

Movo composes all of it. What Movo adds is listed below. Each row was checked against the repository.

| Added by Movo | Why upstream does not provide it |
|---|---|
| A project model with five configuration layers and provenance on every resolved value | x402 provides an object literal rather than a project |
| Resource modules compiling to a route plus a discovery declaration plus a fixture | Upstream requires those three to be kept in step by hand and drift is silent |
| Preflight diagnostics across account, trustline, asset, facilitator, expiry and clock | The largest onboarding cliff in Stellar x402 and unaddressed elsewhere |
| An error registry with generated documentation and construction-time redaction | Upstream returns opaque rejection strings |
| Build-time escalation of fields upstream silently drops | Soft-dropping is correct for a facilitator and wrong for an author |
| A stateful spend accountant for buyers | Upstream's `PaymentPolicy` is stateless and cannot track cumulative spend |
| A signer pool with sequence isolation, metering and rate limiting | The facilitator primitive handles protocol rather than operations |
| A catalog with automatic ingest at settle time and ranked search | No existing x402 catalog carries Stellar |
| Six integrity controls at the catalog trust boundary | Ownership is not something upstream can know |
| An MCP server exposing the catalog as three tools | Out of scope for a protocol SDK |
| A test harness for the developer's own API | Upstream's e2e suite tests upstream |
| A CLI and a scaffolder | Out of scope for a protocol SDK |

Three CI gates keep the boundary honest. `check:protocol-purity` scans 49 source files and fails if a protocol primitive is reimplemented. `check:upstream-validators` fails if a validation call resolves to anything other than an upstream export. A Biome rule fails if `@x402/*` is imported outside the protocol directory.

## 4. Architecture overview

```mermaid
flowchart TB
  dev[Developer] --> res[defineResource]
  res --> app[defineApp and compileApp]
  app --> mount[mountExpress or mountNodeHttp]

  subgraph waist["packages/core/src/protocol, the only x402 import site"]
    x402c["@x402/core"]
    x402s["@x402/stellar"]
    x402e["@x402/extensions"]
  end

  mount --> waist
  mount -->|402 with payment terms| buyer[Buyer or agent]
  buyer -->|budget filters the offer| waist
  buyer -->|signed payload| mount

  mount -->|verify then settle| fac[Movo facilitator]
  fac --> waist
  fac -->|submit| stellar[(Stellar and Soroban)]

  fac -->|settlement observer| cat[Catalog]
  res -.->|derived declaration| cat
  cat --> disc["/discovery/resources and /discovery/search"]
  cat --> mcp[MCP server]
  mcp --> agent[AI agent runtime]
```

Every box exists in the repository. Nothing above is planned work.

Two details are worth reading off the diagram. The catalog is fed by the facilitator rather than by the seller. The MCP server reads the same catalog that serves the HTTP discovery endpoints, through the same ranking pass.

## 5. Package architecture

Movo ships as two tracks. The core track is independent of the RFP track. No core-track package may reference an RFP-track package by specifier, relative path or declared dependency. `pnpm check:track-isolation` fails the build otherwise. It currently scans 111 core-track source files.

### Core track

| Package | Responsibility | Public surface | Imports `@x402/*` |
|---|---|---|---|
| `@movoframework/core` | Project model, resource compilation, error registry, redaction, the protocol waist | `defineConfig`, `defineResource`, `defineApp`, `compileApp`, `resolveConfig`, `MovoError`, `redact`. Subpaths `/server`, `/bazaar`, `/client`, `/facilitator`. | Yes. The only package that may. |
| `@movoframework/server` | Mounting compiled resources onto a Node HTTP framework | `mountExpress`, `mountNodeHttp` | No. Reaches upstream via `core/server`. |
| `@movoframework/stellar` | Preflight diagnostics | `preflight`, `readAssetMetadata` | No |
| `@movoframework/bazaar` | Discovery derivation, strict escalation, buyer catalog queries | `attachDiscovery`, `validateDiscoveryStrict`, `readCatalogOutcome`, `queryCatalog` | No. Via `core/bazaar`. |
| `@movoframework/client` | Buyer budget and typed calls | `createBudget`, `createMovoClient` | No. Via `core/client`. |
| `@movoframework/testing` | Test doubles and harness | `MockFacilitator`, `createInProcessFacilitator`, `withPaidServer`, `movoMatchers` | No |
| `@movoframework/cli` | The `movo` command | binary `movo` | No |
| `create-movo-app` | Scaffolding with two templates | binary `create-movo-app` | No |

### RFP track

| Package | Responsibility | Public surface | Imports `@x402/*` |
|---|---|---|---|
| `@movoframework/facilitator` | Signer pool, metering, rate limiting, configuration, transport reasons | `createFacilitator`, `SignerPool`, `resolveFacilitatorConfig`, `facilitatorConfigFromEnv`, `SettlementObserver` | No. Via `core/facilitator`. |
| `@movoframework/catalog` | Store port, settle-time ingest, integrity controls, hybrid search | `createCatalog`, `SqliteCatalogStore`, `PostgresCatalogStore`, `ingestSettlement`, `listingKey` | No. Via `core/bazaar`. |
| `@movoframework/mcp` | MCP discovery server | `createMcpDiscoveryServer`, `createBazaarTools` | No |

### Applications and examples

| Path | What it is |
|---|---|
| `apps/facilitator` | Deployable Hono service. Private. Dockerfile included. |
| `examples/weather-api` | Minimal paid API |
| `examples/discoverable-api` | Paid API with derived discovery metadata |
| `examples/agent-buyer` | Buyer with a budget and a pre-baked integration |
| `examples/catalog-quickstart` | Pay once then become discoverable. Settles on testnet. |
| `examples/mcp-agent` | Agent discovers and pays with no pre-baked integration. Settles on testnet. |

## 6. The protocol narrow waist

Only files under `packages/core/src/protocol/**` may import from `@x402/*`. Everything else reaches the protocol through re-exports from that directory.

The waist is organised as several entry modules. The root entry stays free of any HTTP framework. A `/server` subpath carries the `@x402/express` derived exports. A `/bazaar` subpath carries the `@x402/extensions` discovery surface. A `/client` subpath carries the client scheme and signers. A `/facilitator` subpath carries the facilitator primitive.

The reason is version churn. `@x402/*` releases roughly weekly. Without the boundary a breaking change surfaces in every package at once. With it the blast radius is one directory and the fix is usually a re-export.

The rule is enforced by Biome and proven to fire by `tests/unit/narrow-waist.test.ts`. A second gate catches the harder case where somebody reimplements a primitive rather than importing it.

See `docs/adr/0004-x402-narrow-waist.md`.

## 7. The x402 payment flow

The steps below are the real path. The owner of each step is named.

| Step | What happens | Owner |
|---|---|---|
| 1 | Client requests a protected resource with no payment | Client |
| 2 | Server answers 402 with payment terms and the Bazaar declaration in `extensions.bazaar` | `@x402/core` middleware over Movo's compiled route |
| 3 | The buyer's budget policy filters the offers | Movo `createBudget` registered as an upstream `PaymentPolicy` |
| 4 | Payment payload is created and the Soroban auth entry is signed | `@x402/stellar` `ExactStellarScheme` |
| 5 | Client retries with the payload header | `@x402/fetch` wrapped fetch |
| 6 | Facilitator verifies the payload | `@x402/stellar` facilitator scheme inside Movo's service |
| 7 | Handler runs and the response is buffered | `@x402/core` |
| 8 | Facilitator settles. A sponsor signer submits to Soroban. | `@x402/stellar` with Movo's signer pool |
| 9 | Settlement observer hands the payload to the catalog | Movo |
| 10 | Response is released with `PAYMENT-RESPONSE` carrying the transaction | `@x402/core` |

Three properties of that flow belong to upstream and Movo asserts them rather than building them. The handler runs before settlement. A handler that throws cancels settlement. A handler returning status 400 or above cancels settlement, so a paid route that returns 404 costs the buyer nothing. Tests live in `tests/integration/payment-invariants.test.ts` as invariants I1 through I6.

One property belongs to Movo and it is a security control. The budget filters offers before upstream creates a payment. A refused offer leaves no signature in existence rather than an unsubmitted one. `packages/client/src/budget.test.ts` asserts it with a signer spy.

## 8. Stellar integration

Only functionality present in the repository is listed.

| Aspect | Implementation |
|---|---|
| Networks | CAIP-2 identifiers throughout. `stellar:testnet` and `stellar:pubnet`. The string `stellar:mainnet` is rejected at configuration time. |
| Scheme | `exact` only. The `upto` scheme is not implemented. |
| Assets | Any SEP-41 token through upstream. USDC is the default and is resolved by upstream `getUsdcAddress` rather than hardcoded. |
| Decimals | Read from the asset contract and asserted to be 7 for testnet USDC rather than assumed. |
| Authorization | Soroban auth entries built and signed entirely by `@x402/stellar`. |
| Transaction construction | No Movo package builds XDR. A CI grep enforces this. |
| Signing | No Movo package signs. Signers are always supplied by the caller. |
| Settlement | Submitted by `@x402/stellar` using a sponsor signer leased from Movo's pool. |
| Fee sponsorship | The facilitator pays the network fee. This is advertised as `extra.areFeesSponsored` on `/supported`. |
| RPC | Soroban RPC through upstream helpers. Overridable per client and per facilitator network. `stellar:pubnet` requires an explicit RPC URL because no public mainnet default exists. |
| Horizon | Used only by tests for independent confirmation. It is not in the payment path. |
| Ledger expiry | `maxTimeoutSeconds` bounds the validity window and is validated at configuration time. |
| Trustlines | Checked by preflight. The check verifies the asset issuer derived from the contract rather than the asset code alone. |
| Classic accounts | Supported and proven. |
| Smart accounts | Upstream is confirmed to accept contract-address credentials. Movo needs no change. No payment from a `__check_auth` account has been demonstrated. |
| Stellar SDK | `@stellar/stellar-sdk` 16.2.0, present transitively. `core` must never import it directly and a CI check asserts no direct specifier. |

Fee sponsorship has a consequence that shapes the whole design. The facilitator is the transaction source of every settled transaction it submits. That is the mechanism rather than a defect. Non-custody is therefore asserted in two parts. On the buyer-signed transaction the facilitator appears in none of the four sensitive positions. On the settled transaction the facilitator is the source and fee payer and must not be the transfer sender, the operation source of the transfer or an auth-entry signer for it.

## 9. Facilitator architecture

Movo composes the upstream facilitator primitive. It does not implement the protocol.

`packages/facilitator` is a library. `apps/facilitator` is the deployable Hono service that mounts it. Both shapes are supported and both are proven on testnet.

### Endpoints

| Route | Purpose |
|---|---|
| `POST /verify` | Verify a payment payload against requirements |
| `POST /settle` | Settle a verified payment |
| `GET /supported` | Advertise schemes, networks and the Stellar `extra` block |
| `GET /health` | Liveness |
| `GET /ready` | Readiness. Fails when every sponsor is below its XLM floor. |
| `GET /metrics` | Operational metrics |
| `GET /discovery/resources` | Catalog listing with the specification's filters |
| `GET /discovery/search` | Natural-language catalog search |
| `GET /browse` | Read-only human-readable catalog page |

### Movo-owned behaviour

The signer pool is the part worth reading. A Stellar account's sequence number makes it a mutex rather than a weight. Concurrent submissions from one account collide. The pool leases one signer at a time and queues the rest. An earlier version spread load across accounts as if they were weights and produced exactly one successful settlement per account. The load test now asserts on the settled count rather than on rejection strings.

Other Movo-owned pieces are the balance floors that fail readiness, per-caller metering, per-IP and per-key rate limiting, a 128 KiB request body cap, constant-time API key comparison and a single registry of transport rejection reasons. Every rejection carries a non-null machine-readable reason.

The settlement observer is deliberately powerless. It receives a finished settle response and returns only what to place in `EXTENSION-RESPONSES`. It cannot abort, retry or alter a settlement. A catalog that could fail a payment would make discovery a liability for every seller using the facilitator.

### Configuration

Configuration comes from `MOVO_FACILITATOR_*` environment variables or from `resolveFacilitatorConfig` in code. Sponsor seeds can be supplied from the environment for testnet. For pubnet the service warns and directs the operator to inject a KMS-backed or HSM-backed signer instead. The injection point exists. No KMS integration is implemented.

See `docs/adr/0012-facilitator-architecture.md` and `docs/operating-a-facilitator/`.

## 10. Bazaar discovery architecture

A Bazaar catalog is an index of resources that have been paid for at least once through a given facilitator. There is no registration endpoint anywhere in the service.

### From resource to listing

A seller writes one `defineResource` declaration. Movo derives the Bazaar declaration from it, including a JSON Schema converted from a Zod v4 input schema. The declaration travels on the 402. A buyer echoes it back inside the payment payload. The facilitator that settles the payment catalogs it.

This is why the route and the listing cannot disagree. They come from the same declaration. A listing cannot advertise a path that no longer exists.

### Keying

HTTP listings are keyed on `routeTemplate`. MCP listings are keyed on the `(resource.url, toolName)` tuple. One MCP server exposes many tools at one URL and each is separately payable.

Keying HTTP on the template rather than the concrete path is what collapses `/weather/SFO` and `/weather/LHR` into one listing. Without it a catalog grows with traffic rather than with the number of endpoints.

### Integrity

The catalog is a trust boundary. Clients echo the seller's resource block into the payment payload, so every ingested field is attacker-influenced. Anyone able to pay a tenth of a cent can attempt a write.

| Attack | Reason emitted | Control |
|---|---|---|
| Overwrite another seller's listing | `listing_owner_mismatch` | Compare settled `payTo` against the stored owner inside one transaction |
| Forge `payTo` | `listing_pay_to_forged` | The echoed `payTo` must equal the one that settled |
| Percent-encoded traversal in `routeTemplate` | `listing_route_template_invalid` | Percent-decode before the traversal check |
| Loopback `iconUrl` | `listing_icon_url_invalid` | Upstream `isValidIconUrl` escalated rather than soft-dropped |
| External `$ref` | `listing_schema_ref_external` | References must be same-document JSON Pointer fragments |
| Oversized fields | `listing_field_too_large` | Per-field caps |

Two design points are load-bearing.

Ownership comes from `paymentRequirements.payTo`, the address that actually settled. It never comes from the echoed block and never from the settled transaction. Reading the settled transaction would find the facilitator as source on every settlement because of fee sponsorship, and the catalog would refuse every legitimate listing.

The controls read the raw resource extension from the payload before upstream extraction. Upstream soft-drops an invalid `routeTemplate` or `iconUrl`, so a control that inspected only upstream's output would see a clean result and report success on the attack. The controls compare raw against extracted and escalate anything upstream discarded.

Check order is part of the control. Reference validation runs before the schema validator. The validator resolves the declared schema, so running it first would hand an attacker-supplied URL to a resolver on the settle path. With the checks reversed the external reference attack also reported a generic reason, collapsing six distinct reasons to five on the only path a real settlement takes.

### Persistence

Storage is a port with two implementations. SQLite is the default and needs no infrastructure. Postgres is for hosted deployments running more than one instance, where the ownership comparison is performed by the database in a single upsert statement rather than by the application.

`pgvector` is deliberately unused. Vectors live in memory alongside the lexical index so both stores rank identically. Pushing similarity into Postgres would give hosted and self-hosted deployments different rankers and the published score would describe neither.

See `docs/discovery/running-a-catalog.md` and `docs/discovery/integrity.md`.

## 11. Bazaar search and ranking

Search is hybrid retrieval with reciprocal-rank fusion.

| Stage | Behaviour |
|---|---|
| Filtering | Filters apply before ranking so a network-restricted search does not spend result slots on listings it will drop |
| Lexical retrieval | BM25 over service names, descriptions, tags and per-parameter descriptions |
| Semantic retrieval | Embedding similarity from a permissively licensed local model |
| Fusion | Reciprocal-rank fusion over both candidate lists |
| Signals | Failure-rate demotion, plus settlement activity counted only above a dust threshold |
| Pagination | Opaque cursor. Ranked results are recomputed per query so a keyset cursor over a changing score would skip or repeat rows. |
| Degradation | `partialResults` is true when a retriever is unavailable or results were truncated |
| Query bound | Queries are truncated at 512 characters as a resource-exhaustion control |

The dust threshold matters for integrity rather than performance. Activity feeds ranking. Without a floor a seller buys apparent traffic one stroop at a time.

Ranking is never for sale. There is no sponsored placement in any form. This is stated in the code, in the documentation and on the browse page.

### Evaluation

Running `pnpm test:search-eval` reproduces the following.

| Configuration | nDCG@10 | recall@20 |
|---|---|---|
| Hybrid, BM25 plus embeddings with RRF | **0.9332** | **1.0000** |
| Lexical only | 0.8524 | 0.8711 |

| Floor | Value |
|---|---|
| Hybrid nDCG@10 | 0.70 |
| Hybrid recall@20 | 0.90 |
| Lexical nDCG@10 | 0.55 |
| Lexical recall@20 | 0.75 |

The evaluation set holds 55 resources, 114 queries and **169 graded query pairs**. Relevance is graded rather than binary. Each query maps resource identifiers to a grade.

What the numbers measure. nDCG@10 measures whether relevant resources appear near the top of the first ten results, weighted by grade. recall@20 measures what fraction of the resources labelled relevant appear anywhere in the first twenty. Neither is a usage metric. Neither says anything about adoption.

What the numbers do not measure. The corpus is synthetic and authored for the evaluation rather than drawn from real traffic. A score on a synthetic corpus shows that the ranker behaves as designed. It does not predict behaviour on a live catalog. The interesting figure is the gap between the two rows rather than the absolute value. Adding the semantic retriever moves recall@20 from 0.871 to 1.000, which means roughly one relevant resource in eight was not being found at all by lexical retrieval.

Methodology, floors and the refresh process are in `docs/discovery/search-quality.md`.

## 12. MCP discovery

`@movoframework/mcp` exposes a catalog to an agent runtime as exactly three tools, built on `@modelcontextprotocol/sdk` 1.30.0.

| Tool | What it does |
|---|---|
| `bazaar.search` | Natural-language query over the catalog. Returns listings with an identifier the agent can act on. |
| `bazaar.get` | One listing by identifier or by the `(resource, toolName)` tuple, with its settlement and failure counts. |
| `bazaar.paidCall` | Pays for and calls a discovered resource within a spend cap the operator sets. |

**MCP does perform paid invocation.** This is verified end to end on Stellar testnet in `tests/e2e/mcp-agent-discovery.test.ts`. The agent reads the resource URL out of the search result. No URL, price, parameter name or schema is written anywhere in the test. That is what no pre-baked integration means.

Three properties are worth stating precisely.

`bazaar.paidCall` requires a budget. The server constructs the buyer itself rather than accepting a ready-made client, because a client captures its budget in a closure where nothing can inspect it. There is no argument a caller can pass that produces a paid-call tool with no spend cap. The cap belongs to the operator. No tool argument raises it.

An over-budget call is refused before a payment is created. No signature ever exists. The test asserts this with a signer spy showing zero calls and with the budget showing exactly one recorded refusal. The second assertion is what stops the first being vacuously true. A paired proof-of-failure test raises only the cap and shows the failure move past the budget. On testnet the seller's Horizon transaction count is unchanged across a refused call.

Results are structured and deterministic. Rejections travel in `structuredContent` rather than in the MCP error channel, because a budget refusal is a well-formed answer that an agent needs to branch on. Every rejection carries a code from the single `MOVO_E_*` registry and a non-null reason enforced by the type rather than by a test.

What MCP does not do. The server reads a local catalog. Pointing it at a remote facilitator requires an adapter and none is written. There is no orchestration, memory or planning. Those belong to the agent runtime.

See `docs/mcp/discovery-server.md` and `docs/mcp/agent-integration.md`.

## 13. Developer experience

The intended flow, using real syntax from the repository.

**1. Create a project.** The scaffolder produces `movo.config.ts`, one resource, a server, a test, an `.env.example` and a README.

**2. Define a resource.** One declaration carries the route, the price, the types and the discovery metadata.

```ts
import { defineApp, defineConfig, defineResource } from "@movoframework/core";
import { z } from "zod/v4";

export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: process.env["MOVO_PAY_TO"],
  facilitator: { url: process.env["MOVO_FACILITATOR_URL"] },
  discovery: {
    enabled: true,
    serviceName: "Example Weather",
    tags: ["weather", "forecast"],
  },
});

export const currentWeather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  mimeType: "application/json",
  input: z.object({
    city: z.string().describe("City name or IATA airport code, for example 'SFO'"),
  }),
  output: z.object({ city: z.string(), tempC: z.number(), conditions: z.string() }),
  discovery: {
    example: { city: "SFO" },
    outputExample: { city: "SFO", tempC: 14, conditions: "foggy" },
  },
  handler: (ctx) => ({ city: ctx.params["city"], tempC: 14, conditions: "foggy" }),
});

export const app = defineApp({ resources: [currentWeather] });
```

The `zod/v4` entry is required. Only the v4 schema shape carries the internals the JSON Schema converter reads. With a v3 schema Movo raises a warning and asks for an explicit `inputSchema` rather than guessing.

**3. Configure Stellar and the facilitator.** Set `MOVO_PAY_TO` to the seller address. A resource server needs no private key. The default facilitator is free and keyless.

**4. Run diagnostics.** `movo doctor` checks the account, the trustline, the asset, the facilitator, expiry, clock skew, the Node version and `@x402/*` pin drift. Each finding carries an executable remedy.

**5. Run locally.** `movo dev` prints every paid route with its method, path, price, network and `payTo`, plus the provenance of every resolved configuration value.

**6. Mount the app.**

```ts
import { mountExpress } from "@movoframework/server";

const mounted = await mountExpress(server, app, {
  config: { config, env: process.env },
  strictDiscovery: true,
  onFinding: (finding) => console.log(finding.level, finding.title, finding.fix),
});
```

**7. Test payment flows.** The testing package supplies a mock facilitator, an in-process facilitator that performs real verification, a paid-server harness and a failure matrix.

**8. Buy from the other side.**

```ts
import { createBudget, createMovoClient } from "@movoframework/client";
import { createEd25519Signer } from "@movoframework/core/client";

const budget = createBudget({
  maxAmountPerRequest: "500000",
  maxTotalSpend: "10000000",
  allowedNetworks: ["stellar:testnet"],
  allowedPayTo: [process.env["MOVO_PAY_TO"] as string],
});

const client = createMovoClient({ signer, network: "stellar:testnet", budget });
const result = await client.call(currentWeather, { city: "SFO" }, baseUrl);
```

`result.data.tempC` is typed as a number because the resource declaration said so. No cast and no duplicated interface.

**9. Expose discovery.** Point the seller at a facilitator that operates a catalog, or run one. Declaring metadata does not create a listing. A listing is created when a buyer pays.

**Deploy** is currently out of reach for published packages. See section 22.

## 14. CLI

| Command | Purpose | Inputs | Output | Network |
|---|---|---|---|---|
| `movo dev` | Run the app with provenance-annotated startup output | `--facilitator config,in-process,mock`, `--port`, `--no-watch` | Resolved configuration and every paid route | Only what the config names |
| `movo doctor` | Run every diagnostic and explain each failure | `--json`, `--check <id>`, `--fail-on warn,error` | Findings with remedies. Non-zero exit on failure. | Horizon, Soroban RPC and the configured facilitator |
| `movo test` | Run the project's tests | Any Vitest arguments | Vitest output | None |
| `movo bazaar validate` | Run the same strict escalation the build runs | `--json` | Findings with codes | None |
| `movo bazaar list` | List a facilitator's catalog | `--facilitator`, `--type`, `--pay-to`, `--json` | Listings | The named facilitator |
| `movo bazaar search` | Search a facilitator's catalog | `--query`, `--facilitator`, `--json` | Ranked listings | The named facilitator |
| `create-movo-app` | Scaffold a project | `<directory>`, `--template minimal,discoverable`, `--yes` | A project directory | None |

Limitations worth naming. `movo doctor` cannot check a pubnet account it has no RPC URL for. `movo dev` refuses to run the in-process facilitator against pubnet regardless of any override, because that facilitator signs and submits real transactions. There is no deploy or publish command.

The CLI collects nothing. No usage counts, no error reports, no version pings.

## 15. Testing architecture

Four Vitest projects plus two standalone harnesses.

| Layer | Files | Tests | Network | Runs in CI |
|---|---|---|---|---|
| unit | 45 | 589 | None. A guard fails the suite if `globalThis.fetch` is invoked. | Yes, on Node 22, 24 and 26 |
| integration | 11 | 147 | None. Mock and stub facilitators. | Yes, SQLite only |
| e2e | 3 | 29 | Real Stellar testnet | Weekly only, behind `MOVO_E2E=1` |
| conformance | 1 | 4 | Third-party services | Weekly only, behind `MOVO_E2E=1` |
| scaffold templates | 2 | included | None | Yes |
| search evaluation | 1 script | 2 configurations | Downloads a model on first run | **No** |

Latest observed results. Unit 589 passing. Integration 146 passing and 1 skipped with Postgres enabled, or 115 passing and 32 skipped without it. E2E 28 passing and 1 skipped. Conformance 4 passing. Core line coverage 92.18 percent against a 90 percent floor.

Two CI gaps are real and are documented rather than hidden.

The search evaluation floor is not wired into any workflow. The script exits non-zero below its floor. Nothing runs the script. The ranker can regress without failing a build.

The Postgres backend is not exercised in CI. No service container is configured, so 30 tests skip. The catalog suite passes against a real Postgres 16 when `MOVO_CATALOG_TEST_POSTGRES_URL` is set. That is a developer action rather than a pipeline guarantee.

Both are M8 follow-ups.

Test quality is worth one note. Adversarial tests assert on stored state rather than on error strings. This was learned expensively. An earlier concurrency gate grepped a rejection reason and reported green while 190 of 200 settlements failed, because upstream had collapsed the distinguishing reason into an opaque one. A reason string is evidence about what the code said. The store is evidence about what it did.

## 16. End-to-end testnet evidence

Live Stellar testnet payment flows have been executed. Transactions were confirmed by fetching them from Horizon directly, which is neither the server under test nor the facilitator that reported success. Asserting on the `PAYMENT-RESPONSE` header alone would let a fabricated settlement pass.

### Recorded in `docs/CONFORMANCE.md`

| Criterion | Transaction |
|---|---|
| Gate 1, first settled payment through the Movo stack | `e05853dac4902d8ceead5bc66fd314be0dc1e3e5a12cb04ed73e09693dd4a048` |
| AC6.1, unmodified stock client against the Movo facilitator | `5cf022788bb26d102b49f9f979a098f30207a0f4ee03ec8be85923a0b12ceb44` |
| AC6.12, self-facilitation inside a resource server | `2bf8cc6980a7195c5309c0b61b29a45469d390aa9da2a1c81a65d29861efd01e` |
| Exit gate, Docker image built and run from the README alone | `0cc0ea98a1d96350cfff778b06eaeb031394483a8f76b8e19f8adfc2e67c98c8` |

### Recorded in the M7 commit message, `129d707`

| Criterion | Transaction |
|---|---|
| AC7.1 and AC7.3, a paid request makes the endpoint findable | `afb403aa97eec22258b24bbea669e80c51f3ecab324f37e430133af5c7ce60b3` |
| AC7.8, an MCP agent discovers, selects and pays | `67171cdf40cae0d78e42d650abe959e66e1a19915242714b1b4ef082902c91ce` |

M7 evidence has not been added to `docs/CONFORMANCE.md`. That document covers Gate 1 and M6 only. Section 20 records this as an evidence gap. Each e2e run settles a new payment, so later runs produced different and equally valid hashes. Nothing about M7 is claimed here that a fresh `MOVO_E2E=1 pnpm test:e2e` run does not reproduce.

### The x402 compatibility suite

The x402 repository was cloned at `main`, its e2e workspace installed and its packages built. The Movo facilitator was registered as an external facilitator proxy, which is the mechanism upstream provides for exactly this. The proxy forwards `/verify`, `/settle` and `/supported` and interprets nothing.

Result. **7 of 7 passing, 100 percent.**

| Client | Server | Endpoint |
|---|---|---|
| axios | Express | `/exact/stellar` |
| fetch | Express | `/exact/stellar` |
| axios | Fastify | `/exact/stellar` |
| fetch | Fastify | `/exact/stellar` |
| axios | Hono | `/exact/stellar` |
| fetch | Hono | `/exact/stellar` |
| mcp | mcp | `exact_stellar` |

Every row settled a real testnet payment with a hash recorded in `docs/CONFORMANCE.md`. Everything in the run is upstream's. Upstream's clients, servers, payment requirements and assertions. The harness resolved `@x402/*` at 2.22.0 while Movo pins 2.21.0, so this is a stock client one minor version ahead of the pin paying through the service.

Scope stated plainly. This is a wire-level interoperability result on testnet rather than a protocol certification. Two of nine scenarios were not run because the `next` server's build hits a Windows path-length limit before any payment code executes. The pubnet half has not been run at all. Two harness accommodations are disclosed in `docs/CONFORMANCE.md`, neither touching an assertion or a payment path.

## 17. Current implementation status

| Area | Status | Evidence |
|---|---|---|
| x402 payment verification | Working on testnet | `apps/facilitator` `/verify`. Upstream suite 7 of 7. |
| x402 payment settlement | Working on testnet | Hashes in `docs/CONFORMANCE.md` |
| Facilitator, standalone service | Working on testnet | AC6.1 hash. Dockerfile builds and runs. |
| Facilitator, self-facilitation in a resource server | Working on testnet | AC6.12 hash |
| Signer pool under load | Working | 200 concurrent settlements with zero sequence failures |
| Non-custody | Asserted by test | `docs/CONFORMANCE.md` AC6.6, two-part invariant |
| Machine-readable rejection reasons | Working | Single registry, enumerated by test |
| Bazaar automatic cataloguing | Working on testnet | AC7.1. No registration endpoint exists in the service. |
| Bazaar discovery endpoints and filters | Working | Tested against both stores |
| Bazaar search and ranking | Working and measured | nDCG@10 0.9332, recall@20 1.0000 |
| Catalog integrity controls | Working | Six controls fail closed with distinct reasons, on both stores |
| Catalog on SQLite | Working | Default store |
| Catalog on Postgres | Working locally | Verified against real Postgres 16. Not run in CI. |
| MCP discovery | Working on testnet | Three tools over a real MCP transport |
| MCP paid invocation | Working on testnet | AC7.8 hash |
| MCP budget refusal without a signature | Working | Signer spy plus recorded refusal, offline and on testnet |
| Developer CLI | Working | Four commands with integration tests |
| Scaffolding | Working from a checkout | Templates compiled and tested in CI |
| Testing toolkit | Working | Mock and in-process facilitators, harness, matchers |
| Upstream e2e compatibility | Passing on testnet | 7 of 7 |
| Search evaluation enforced in CI | **Not wired in** | Absent from every workflow file |
| Postgres exercised in CI | **Not wired in** | No service container. 30 tests skip. |
| npm publication | **Not done** | All packages at `0.0.0`. Registry returns 404. |
| Documentation site | **Not built** | No `apps/docs`. M8 scope. |
| Release automation | **Not built** | No release workflow. 7 changesets pending. |
| Pubnet settlement | **Never run** | Config path exists and demands an explicit RPC URL |
| Mainnet operational posture | **Not established** | No funded sponsors, no KMS integration, no RPC agreement |
| External security review | **Not started** | Required before any mainnet tag |
| Smart accounts, `__check_auth` | **Unproven** | Upstream accepts contract credentials. No demonstration performed. |

## 18. M0 to M7 progress

Milestone definitions come from `docs/context/MOVO_ARCHITECTURE_SPEC_v2.md` section 10.

| Milestone | Purpose | Status | Key technical result |
|---|---|---|---|
| M0 | Foundation, compliance gates and a protocol spike | Complete | A real testnet settlement proven before any framework work began |
| M1 | Configuration, resource model and compiler | Complete | Five-layer configuration with provenance. 42-code error registry. 92.18 percent core coverage. |
| M2 | Server mount, Stellar preflight and real settlement | Complete | Invariants I1 through I6 tested. Gate 1 settlement confirmed from Horizon. |
| M3 | Facilitator composition and testing toolkit | Complete | Mock and in-process facilitators. Payload-mutation scenarios rejected by real verification. |
| M4 | Bazaar derivation, strict validation and buyer client | Complete | Upstream soft-drops escalated to build-time findings. Budget refuses before signing. |
| M5 | CLI, scaffolding and developer experience | Complete | Four commands. Two templates compiled in CI. |
| M6 | Facilitator service, gated | Complete on testnet | Stock client 7 of 7. Self-facilitation proven. 200 concurrent settlements. Pubnet not run. |
| M7 | Bazaar catalog, search and MCP discovery, gated | Complete | Automatic cataloguing, measured ranking, three MCP tools, agent pays on testnet. |

The M7 audit counted 70 acceptance criteria across M0 to M7. Fifty-nine complete. Six partial. Two missing. Three requiring verification. That is 84.3 percent fully complete.

## 19. Remaining M0 to M7 gaps

The distinction between kinds of gap matters. A missing implementation is a different problem from a missing piece of evidence.

| Gap | Kind | Detail |
|---|---|---|
| Pubnet settlement, AC6.2 | Environmental blocker | Requires funded sponsors, a key management story, an RPC provider agreement and the security review. No engineering work is known to be missing. |
| Pubnet half of the conformance suite, AC6.4 | Environmental blocker | Same prerequisites. The testnet half passed 7 of 7. |
| Smart accounts, AC6.11 | Missing evidence | Requires deploying a `__check_auth` contract. The Stellar CLI and a wasm32 toolchain were absent from the build environment. Upstream is confirmed to accept contract-address credentials so Movo needs no change. |
| Search evaluation in CI, AC7.4 | CI enforcement gap | The floor exists and the script fails below it. No workflow invokes it. |
| Postgres in CI, AC7.10 | CI enforcement gap | The suite passes against real Postgres locally. No service container is configured, so 30 tests skip. |
| Spike branch deletion, AC0.7 | Missing evidence | No spike commit appears in 28 commits of history. Branch deletion cannot be proven from a local clone. |
| Replay rejection, AC3.3 | Missing evidence | A replay scenario exists and the behaviour belongs to upstream verification. No test carries the criterion name. |
| Discovery concepts page, AC4.7 | Documentation path mismatch | The four-concept table and the non-promise statement exist at `docs/bazaar/overview.md` rather than at the path the specification names. Substance satisfied. |
| Scaffold install test, AC5.1 | Deliberate skip | The test needs a network install so it is skipped. Template tests in CI compensate. |
| Compatibility matrix freshness | Housekeeping | `docs/COMPATIBILITY.md` was generated before M6 and M7. One command regenerates it. |
| M7 conformance evidence | Missing evidence | `docs/CONFORMANCE.md` has no M7 section. Hashes live in the M7 commit message and in the specification. |

Two implementation defects were found during M7 and both are fixed. They are recorded because the pattern matters more than either instance.

The buyer cumulative spend cap was inert from M4 through M6. `SettleResponse.amount` is optional and the `exact` scheme never populates it, so the accountant never ran on a real settlement. Every unit test supplied an amount directly and therefore exercised the branch production never takes. Found by an e2e that asserted on the budget after a confirmed on-chain settlement.

The Postgres catalog filter could not parse. A placeholder rewrite consumed the JSON operator, producing a syntax error on every filtered query, in code that typechecked and had never been executed. Found by the first run against a real Postgres.

Both reinforce a single rule. Typechecking and passing are not running.

## 20. M8, planned work

**M8 has not started.** Everything in this section is planned.

Its purpose per the specification is to convert a working repository into a releasable open-source project. Scope includes a documentation site, a generated API reference, a threat model, a third-party security review, performance baselines, release automation with npm provenance, conformance evidence per network and a clean-machine reproducibility run. Explicit non-scope includes new features and API changes.

| M8 item | Why it matters |
|---|---|
| npm publication with OIDC trusted publishing | Nothing is installable today. A long-lived token is not acceptable because npm is restricting token-based publishing. |
| Documentation site | Error codes point at a documentation URL that currently resolves to nothing published. |
| Threat model and third-party security review | Required before any mainnet tag. External lead time. |
| Stock-client conformance suite owned by Movo | This is the RFP literal acceptance mechanism and needs a hash per network per scheme. |
| Performance baselines | No measured throughput or latency figures exist. |
| Wiring the search floor and Postgres into CI | Closes the two enforcement gaps in section 19. |
| Pubnet conformance | The other half of the facilitator deliverable. |

Production readiness requires at minimum a completed external review, a funded and key-managed pubnet deployment, a published release and conformance evidence on both networks. None of those exists today.

## 21. SCF RFP alignment

Benchmarked against `docs/context/RFP_COVERAGE_MAP.md`, the repository transcription of SCF request 45, x402 Facilitator with Bazaar discovery support.

### Already demonstrated

| RFP area | What exists |
|---|---|
| verify, settle and supported on testnet | Working service with a stock-client hash |
| Strict Soroban auth-entry validation | Provided by `@x402/stellar` and asserted through conformance |
| SEP-41 tokens with USDC default and 7 decimals | Decimals read from the contract rather than assumed |
| Fee sponsorship with `extra.areFeesSponsored` | Advertised on `/supported` and compared against the reference facilitator |
| Non-custody | Two-part invariant asserted by test |
| Caller auth, metering and rate limiting | Implemented with tests |
| Hosted, self-hosted and self-facilitation packaging | All three shapes present. Self-facilitation proven with a hash. |
| `GET /discovery/resources` with the specification filters | Working against both stores |
| `GET /discovery/search` with ranking, cursor and `partialResults` | Working and measured |
| Automatic cataloguing with no separate registration | Proven on testnet |
| HTTP and MCP resources, tuple-keyed | Proven by test |
| Catalog integrity including percent-decode before traversal | Six controls failing closed |
| `EXTENSION-RESPONSES` cataloguing outcomes | Emitted and observed live |
| MCP discovery server with search and paid call | Three tools. Paid call proven on testnet. |
| Structured errors with a non-null reason | Enforced by the type system |
| Permissive licence with no copyleft in the path | 373 packages inspected, zero prohibited |
| Wire-level conformance with an unmodified stock client | 7 of 7 on testnet |
| Off-chain index by default | Recorded with reasoning in ADR-0013 |
| Two end-to-end example integrations | Both settle real testnet payments |
| Role-based developer guide | Present in `docs/guide/` |

### Remaining work

| RFP area | Status |
|---|---|
| verify, settle and supported on pubnet | Not started. Blocked on funding, key management, RPC and the audit. |
| Conformance suite on pubnet with a hash per network per scheme | Not started. Same blockers. |
| Custom `__check_auth` smart accounts | Evidence gap. Cheapest of the remaining items to close. |
| The `upto` scheme and authoring its Stellar specification upstream | Not implemented. Deliberately deferred with written reasoning. |
| Third-party review through the Audit Bank | Not started. External lead time. |
| Guide contributed to Stellar Developer Docs | In-repo guide complete. Not submitted. Tracked with a done-state. |
| Timed clean-machine onboarding run | Not performed. Requires someone who did not build Movo. |
| Production service with monitoring and uptime | Endpoints and runbook exist. Nothing is deployed. |

### Why the current implementation is a foundation

The RFP names the Bazaar as its highest-value item and names wire-level conformance with a stock client as its acceptance mechanism. Both exist on testnet today. The licence position is clean, which matters because the production Stellar facilitator available at the time of writing is built on AGPL-3.0-or-later components that the RFP names as unusable as a base.

The gaps are concentrated in one place. They are procurement and process rather than architecture. Funded accounts, a key management story, an RPC agreement and an external review are the same list four times over.

## 22. How Movo differs

Three things are easy to confuse.

**The official `@x402/*` packages** implement the protocol. They are the correct dependency for anyone building x402 anything. They do not provide a project model, diagnostics, a catalog with ranked search or an MCP server. Movo depends on them and adds those layers.

**Vellar** publishes an x402 facilitator for Stellar at `github.com/Vellar-Wallet/vellar-facilitator`. Its own technical document describes a facilitator with a Bazaar catalog, a trust and provenance layer for listing ownership and a relationship to the Vellar wallet product. Any comparison beyond what that document states would be speculation and is not made here.

**Movo** is a framework and operations toolkit rather than a facilitator with a framework attached. The facilitator, the catalog and the MCP server are one of two tracks. The other track is the developer-facing framework and it ships independently, enforced by a CI gate. A developer can use the Movo resource model and CLI while settling through somebody else facilitator entirely.

The honest summary. Movo did not invent x402 and did not invent Bazaar. What it contributes is the project layer around them and a Stellar-native catalog with a measured ranker.

## 23. Security model

| Concern | Position |
|---|---|
| Payer private keys | Never accepted server-side. A resource server needs no key at all. |
| Key generation | No package generates, derives or stores a key. `check:key-generation` enforces it with a proof-of-failure fixture. |
| Payment signing | Performed by `@x402/stellar` using a signer the caller supplies. |
| Buyer protection | A 402 is a claim rather than a fact. A hostile server can name any recipient and amount. The budget is the only control and it refuses before a payment is created. |
| Sponsor keys | The highest-value secret in the system. Environment seeds work for testnet. Pubnet is warned against and directed to KMS or HSM injection. No KMS integration is implemented. |
| Facilitator trust | The facilitator can see payloads and chooses whether to submit. It cannot redirect a transfer. Non-custody is asserted in two parts. |
| Configuration secrets | Redacted at construction time and at every log level including debug. A literal API key in configuration is rejected. |
| Catalog trust boundary | Every ingested field is attacker-influenced. Six controls fail closed. Ownership binds to the address that settled. |
| Request limits | 128 KiB body cap, per-field ingest caps, 512-character query truncation, capped page sizes, per-IP and per-key rate limits. |
| Replay | Handled upstream. `maxTimeoutSeconds` bounds the window and is validated. |
| Telemetry | None. No usage counts, no error reports, no version pings. No analytics dependency in the tree. |
| Supply chain | Install scripts are allowlisted to two packages. Weekly audit, OSV scan and licence gate. A gitleaks scan runs as a sibling CI job so it is never gated behind a build. |

What Movo does not protect against. A seller lying about what an endpoint does, because the catalog verifies ownership and metadata shape rather than truthfulness. A seller paying themselves to inflate activity, where the dust threshold makes this cost real money rather than preventing it. Route-template squatting, where first settlement wins. A compromised facilitator declining to settle. Loss of a sponsor key.

**No external security audit has been performed.** The review required before any mainnet deployment has not been commissioned.

## 24. Licence and dependency model

Movo is Apache-2.0. That licence was chosen over MIT for the explicit patent grant and to match `@x402/*`.

No AGPL, SSPL or GPL is permitted anywhere in the dependency path. A facilitator is designed to run as a network service and the AGPL network clause would extend source obligations to third parties it serves. The gate denies AGPL, SSPL, GPL-2.0 and GPL-3.0 outright. LGPL is warned rather than failed because dynamic linking from a separate work does not impose source obligations.

Latest gate result. 373 packages inspected. Zero prohibited. Zero without a declared licence. Two warnings, both on transitive development dependencies that are not shipped. One is a Windows-only image binary carrying `Apache-2.0 AND LGPL-3.0-or-later`. The other is a Changesets dependency whose licence field reads `SEE LICENSE IN LICENSE` and therefore cannot be resolved automatically. Both warrant a reading by whoever reviews licensing before a submission.

The OpenZeppelin Relayer, its x402 Facilitator Plugin and the Relayer SDK are AGPL-3.0-or-later. They must never be vendored, forked or copied. Calling a hosted facilitator over HTTP is permitted.

Pinned versions.

| Dependency | Version |
|---|---|
| `@x402/core`, `@x402/stellar`, `@x402/extensions`, `@x402/express`, `@x402/fetch` | 2.21.0, exact-pinned |
| `@stellar/stellar-sdk` | 16.2.0, transitive |
| `@modelcontextprotocol/sdk` | 1.30.0 |
| `hono` | 4.13.2 |
| `express` | 5.2.1 |
| `zod` | 3.25.76, used through the `zod/v4` entry |
| `typescript` | 7.0.2 with `isolatedDeclarations` |
| `vitest` | 4.1.10 |
| `better-sqlite3` | 13.0.3 |
| `pg` | 8.23.0, optional peer |
| `@huggingface/transformers` | 4.2.0, optional peer |

`@x402/*` carries no caret or tilde range. A bump is a dedicated pull request that regenerates the compatibility matrix and re-runs conformance.

## 25. Operational model

### Local development

No infrastructure. SQLite for the catalog, an in-process or mock facilitator, no network. `movo dev` and `movo test` reach nothing.

### Testnet

A seller needs a funded Stellar account with a USDC trustline. A buyer needs the same plus a USDC balance from the Circle faucet. The default public facilitator is free and keyless, so running one is optional.

Running the facilitator on testnet needs funded sponsor accounts provisioned through Friendbot, an XLM floor per sponsor and a Soroban RPC endpoint. SQLite is enough for the catalog. Semantic search downloads a model of roughly 90 MB on first use.

### Production

Not established. The known requirements are funded pubnet sponsor accounts, a KMS-backed or HSM-backed signer rather than environment seeds, a Soroban RPC provider with an agreement because no public mainnet default exists, Postgres for a multi-instance catalog, monitoring on `/ready` and a completed external security review.

The operational cost worth naming is upkeep rather than deployment. Discovery conventions are still moving. The estimate in the operator guide is roughly a one-week turnaround per convention change, indefinitely. A facilitator that stops tracking the specification is worse than none.

## 26. Non-goals

- Reimplementing any x402 protocol primitive.
- Reimplementing Stellar settlement, XDR construction or signing.
- Wrapping an upstream package only to rename its exports.
- Taking custody of funds at any point.
- Accepting a payer private key server-side.
- Generating, deriving or storing a private key in any package.
- Collecting telemetry of any kind.
- Operating a neutral cross-facilitator registry.
- Selling ranking position in any form.
- Building a marketplace user interface, because the browse page is read-only and the operator controls no ordering.
- Cross-facilitator federation, because no convention exists yet.
- An on-chain Soroban discovery registry for version 1.

## 27. Technical decisions

| Decision | Reason | Consequence | ADR |
|---|---|---|---|
| Import `@x402/*` in one directory only | Upstream ships roughly weekly and a breaking change would otherwise surface everywhere | Upstream churn is contained. Some re-export maintenance. | 0004 |
| Compose upstream rather than abstract it | The SDK is more complete than its documentation suggests | Movo stays small. Movo cannot hide upstream behaviour. | 0001 |
| Two independent tracks | The framework must ship whether or not the facilitator work proceeds | Enforced one-way dependency. A CI gate rather than a convention. | 0002 |
| One resource declaration for route, discovery and fixture | Keeping three artefacts in step by hand fails silently | Discovery cannot advertise a route that does not exist. | 0005 |
| Five configuration layers with provenance | Silent overrides across environments are hard to debug | Every resolved value reports its source. | 0006 |
| Contract reads allowed in `stellar`, transactions forbidden | Diagnostics need chain data. Signing is a custody boundary. | Preflight can read decimals. It can never move value. | 0007 |
| Mount through the HTTP resource server rather than from config | The config helper hides the object the lifecycle hooks attach to | Diagnostics are reachable. | 0008 |
| Off-chain catalog index | Rent and TTL eviction make availability a funding problem. On-chain writes double the per-payment cost. | No censorship resistance and no cross-facilitator canonicality. Stated in the docs. | 0013 |
| Ranking is never for sale | Costs nothing to commit to now and is near-impossible to commit to later | Search quality must be measured or the promise is unfalsifiable. | 0013 |
| Integrity controls read the raw payload before extraction | Upstream soft-drops invalid fields, so a control reading only its output reports success on the attack | Controls compare raw against extracted. | 0013 |

## 28. Known risks

| Risk | Current position |
|---|---|
| Upstream x402 changes | Exact pins, a one-directory blast radius, a weekly conformance workflow and a pin-drift warning in `movo doctor`. |
| Pubnet deployment | Not attempted. Every prerequisite is external and has lead time. |
| Production signer security | The injection point exists. No KMS integration. Environment seeds are testnet-only in practice. |
| Facilitator availability | `/health`, `/ready` and `/metrics` exist. Nothing is deployed, so no uptime figure exists. |
| Stellar RPC reliability | Configurable per network. Pubnet requires an explicit provider. No fallback logic is implemented. |
| Concurrent settlement | A sponsor account is a mutex. The pool leases one at a time. Proven at 200 concurrent settlements. |
| CI coverage | Two gates pass locally and are not enforced in the pipeline. Documented rather than hidden. |
| Search regression | The floor exists and the script fails below it. Nothing runs the script yet. |
| Single maintainer | 28 commits from one author. The specification gate asks for capacity to sustain twelve months of conformance upkeep. |

## 29. Verification and reproducibility

An external developer can check every claim in this document.

```bash
git clone https://github.com/movoframework/movo.git
cd movo
pnpm install
pnpm build
```

Compliance gates and the offline suites. These run in CI on Node 22, 24 and 26.

```bash
pnpm check:licenses
pnpm check:track-isolation
pnpm check:protocol-purity
pnpm check:upstream-validators
pnpm check:project-references
pnpm typecheck
pnpm lint
pnpm check:errors
pnpm check:docs
pnpm test
pnpm test:templates
```

Coverage against the 90 percent floor.

```bash
pnpm vitest run --project unit --coverage
```

Search evaluation. This downloads an embedding model on first run.

```bash
pnpm test:search-eval
```

The catalog suite against both stores.

```bash
docker run -d --name movo-pg -e POSTGRES_PASSWORD=movo -e POSTGRES_USER=movo \
  -e POSTGRES_DB=movo_catalog -p 5434:5432 postgres:16

MOVO_CATALOG_TEST_POSTGRES_URL=postgres://movo:movo@127.0.0.1:5434/movo_catalog \
  pnpm test:integration
```

Real testnet settlement. Requires a funded buyer with a USDC trustline, a seller address and funded facilitator sponsor seeds.

```bash
cp .env.example .env
MOVO_E2E=1 pnpm test:e2e
MOVO_E2E=1 pnpm test:conformance
```

Two runnable examples that settle real payments and print a hash.

```bash
pnpm --filter @movoframework/example-catalog-quickstart start
pnpm --filter @movoframework/example-mcp-agent start
```

Regenerate the compatibility matrix from the live facilitator.

```bash
pnpm generate:compat
```

Note on installing Movo. Packages are not published. `npm create movo-app` and `npm install @movoframework/*` return 404 today. The scaffolder runs from a checkout with `node packages/create-movo-app/dist/bin.js <dir> --template minimal --yes` but the project it generates depends on unpublished packages, so `npm install` inside it cannot resolve yet. Publication is M8 scope.

## 30. Roadmap

### Completed

M0 through M7. Foundation and compliance gates. Configuration, resource model and compiler. Server mount, preflight and real settlement. Facilitator composition and the testing toolkit. Bazaar derivation, strict validation and the buyer client. CLI and scaffolding. The facilitator service. The Bazaar catalog, ranked search and MCP discovery.

### Current

M7 verification is closed. M8 has not started. The immediate work between the two is closing the two CI enforcement gaps, regenerating the compatibility matrix, adding an M7 section to the conformance document and opening the Audit Bank conversation because it has external lead time.

### Planned, M8

Documentation site. Generated API reference. Threat model. Third-party security review. Performance baselines. Release automation with npm provenance. A Movo-owned stock-client conformance suite. A timed clean-machine onboarding run. Version 0.1.0.

### Production

Funded pubnet sponsor accounts. A KMS-backed or HSM-backed signer. A Soroban RPC provider agreement. A completed external security review. Pubnet conformance with a settled hash per network per scheme. An operated service with monitoring. The `upto` scheme remains a committed later phase and its extension point is left open.

Nothing in the planned or production sections is implemented.

---

Last verified against commit `5cee85e` on `main`. Every command in section 29 was executed while preparing this document, with two exceptions. `pnpm test:templates` runs in CI on every push and was not re-run by hand. `pnpm generate:compat` was not run, which is why the compatibility matrix is recorded in section 19 as stale.
