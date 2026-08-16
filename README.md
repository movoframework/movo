# Movo

**The framework and operations toolkit for machine-payable Stellar APIs.**

Movo is an Apache-2.0 TypeScript monorepo for building [x402](https://github.com/x402-foundation/x402)-payable
HTTP APIs settled on [Stellar](https://stellar.org). It is composed **over** the official
`@x402/*` packages and reimplements no protocol primitive.

> **Status: Testnet-ready.** Milestones M0–M7 are complete. The full journey — define a paid
> resource, receive an x402 402, pay, verify, settle on Stellar, return the paid response, and be
> discoverable afterwards — is validated end to end against live Stellar testnet, with transactions
> confirmed from Horizon rather than from the facilitator that reported them.
>
> **Not production-ready.** Nothing is published to npm yet, pubnet/mainnet has never been run, and
> no external security review has taken place. See [Current limitations](#current-limitations).

---

## What works today

Every item below is implemented in this repository and covered by tests. Read
[docs/CONFORMANCE.md](docs/CONFORMANCE.md) for the transaction hashes.

- **Paid HTTP resources** — one typed `defineResource` declaration compiles to a route, a Bazaar
  discovery declaration and a test fixture.
- **x402 payment verification and settlement** on `stellar:testnet`, via `@x402/core` and
  `@x402/stellar`. Movo composes them; it does not reimplement them.
- **A self-hostable facilitator** exposing `/verify`, `/settle`, `/supported`, `/health`,
  `/ready` and `/metrics`, with a signer pool, channel accounts, metering and rate limiting.
  Runs standalone or **in-process inside a resource server** (self-facilitation).
- **Bazaar discovery** — resources are catalogued automatically when a payment settles. There is
  no registration endpoint and no second step.
- **Discovery endpoints** — `GET /discovery/resources` with the specification's filters,
  `GET /discovery/search` with cursor pagination and a `partialResults` flag, and a read-only
  `/browse` page.
- **Ranked search** — BM25 over service names, descriptions, tags and per-parameter descriptions,
  fused with embedding similarity by reciprocal-rank fusion, demoted by failure rate, with a dust
  threshold so activity signals cannot be bought at a rounding error.
- **MCP discovery and paid invocation** — three tools (`bazaar.search`, `bazaar.get`,
  `bazaar.paidCall`) that let an agent find and **pay for** a resource with no pre-baked
  integration.
- **Buyer budgets** — per-request and cumulative caps plus `payTo` and network allowlists,
  enforced before a payment is created, so a refused offer leaves no signature in existence.
- **Developer CLI** — `movo dev`, `movo doctor`, `movo test`, `movo bazaar`.
- **Scaffolding** — `create-movo-app` with `minimal` and `discoverable` templates, both compiled
  and tested in CI as workspace members.
- **Testing toolkit** — `MockFacilitator`, `InProcessFacilitator`, a paid-server harness, a
  payment failure matrix and custom matchers.

### Measured results

| Evidence | Result |
|---|---|
| x402's own e2e suite, run against the Movo facilitator | **7/7 passing** on `stellar:testnet` |
| Bazaar search, hybrid retrieval | **nDCG@10 0.9332**, **recall@20 1.0000** |
| Bazaar search, lexical-only baseline | nDCG@10 0.8524, recall@20 0.8711 |
| Evaluation set | 55 resources, 114 queries, **169 graded pairs** |
| Test suite | 589 unit · 146 integration · 28 testnet e2e · 4 conformance |
| `@movoframework/core` line coverage | 92.18% against a 90% CI floor |

The search numbers are reproduced by `pnpm test:search-eval`; methodology, floors and the refresh
process are in [docs/discovery/search-quality.md](docs/discovery/search-quality.md).

---

## What Movo is

Movo is a **framework** for people building paid APIs and a **toolkit** for people operating the
infrastructure those APIs settle through.

The official `@x402/*` SDK is more complete than its documentation suggests. It already ships route
configuration, the payment middleware, the verify→handler→settle lifecycle with hooks, Bazaar
declaration *and* validation, every Stellar constant and validator, signers, and client
fetch-wrapping. Movo does not wrap any of that.

What Movo adds is a **project model** around those primitives — configuration with provenance, a
typed resource declaration that keeps route/discovery/fixture in sync, diagnostics that explain a
failure before you hit it, a test harness for *your* API, and the catalog and MCP layers that make
a paid resource findable by an agent that has never heard of it.

Read [ADR-0004](docs/adr/0004-x402-narrow-waist.md) for how the boundary is drawn and
[ADR-0013](docs/adr/0013-discovery-architecture.md) for the discovery architecture.

---

## What Movo adds

| Movo provides | Why it is not upstream's job |
|---|---|
| A project model — config, environments, provenance, secret handling | x402 gives you a routes object literal, not a project |
| Resource modules — one typed declaration compiling to a route, a discovery declaration and a fixture | Upstream requires you to keep those three in sync by hand, and desynchronisation is silent |
| Preflight diagnostics (`movo doctor`) — trustlines, funding, asset resolution, clock skew, pin drift | The largest onboarding cliff in Stellar x402, unaddressed anywhere |
| An application test harness — in-process facilitator, payment failure matrix, matchers | Upstream has an e2e suite for *itself*, not for *your* API |
| Error translation — opaque facilitator rejections into coded, documented, actionable errors | — |
| A stateful buyer budget | Upstream's `PaymentPolicy` is stateless by design and cannot track cumulative spend |
| A Stellar-native catalog with ranked search | No existing x402 catalog carries Stellar; the reference catalogs list Base and Solana |
| Catalog integrity at the trust boundary | Clients echo the seller's resource block into the payment payload, so every ingested field is attacker-influenced |
| An MCP discovery server | — |
| Scaffolding and CLI | — |

### Who owns what

The separation matters and is enforced, not merely stated:

- **Upstream x402 owns** the protocol: payment requirement encoding, the 402 headers, payload
  creation, verification, settlement, the verify→handler→settle ordering, scheme rules, and the
  discovery-extension validators and sanitisers.
- **Upstream `@x402/stellar` owns** Soroban auth entries, XDR, signing, transaction submission and
  the Stellar constants and address validators.
- **Movo owns** the project model, the resource compiler, the error registry and redaction, the
  build-time escalation of upstream's silent soft-drops, the buyer's spend accountant, the signer
  pool and channel accounts, metering and rate limiting, the catalog and its integrity controls,
  the ranker, and the MCP tool surface.

Three CI gates keep this honest, each with a proof-of-failure fixture:
`check:protocol-purity` (no protocol primitive is reimplemented), `check:upstream-validators`
(every validation call resolves to an upstream export), and the narrow-waist lint rule.

---

## What Movo does not do

**Movo never:** reimplements x402 or Stellar settlement; wraps an upstream package merely to rename
its exports; takes custody of funds; accepts a payer private key server-side; generates, derives or
stores a private key in any package; or collects telemetry of any kind.

A Movo resource server needs **no** private key. It names an address to be paid and a price; the
buyer signs. `pnpm check:key-generation` fails the build if a keypair-generation path ever appears.

---

## Telemetry: none

**Movo collects nothing.** No usage counts, no error reports, no version pings, no opt-out beacon.
The CLI makes no network request that your configuration did not ask for: `movo doctor` reaches
Horizon, the Soroban RPC and the facilitator *you* configured, and nothing else; `movo dev` and
`movo test` reach nothing at all.

There is no analytics dependency in the tree, and the licence gate would flag one arriving. Stated
here rather than in a policy page because a framework that handles payment configuration and
Stellar addresses has a higher bar than a framework that does not.

---

## Getting started

> **Packages are not yet published to npm.** `npm create movo-app` and `npm install
> @movoframework/*` will fail with a 404 today — publication is part of M8. Until then, run Movo
> from a checkout.

### From a checkout (works today)

```bash
git clone https://github.com/movoframework/movo.git
cd movo
pnpm install
pnpm build
```

Run a paid API and pay it, against Stellar testnet:

```bash
cp .env.example .env    # set MOVO_PAY_TO, STELLAR_PRIVATE_KEY (buyer), and facilitator seeds

# a paid API that becomes discoverable by being paid once
pnpm --filter @movoframework/example-catalog-quickstart start

# an agent that discovers and pays for it over MCP, with no pre-baked integration
pnpm --filter @movoframework/example-mcp-agent start
```

Both settle real testnet payments and print a transaction hash you can look up on Horizon. The
other examples are `weather-api`, `discoverable-api` and `agent-buyer`.

### Once published (M8)

```bash
npm create movo-app my-api
cd my-api && npm install
cp .env.example .env      # set MOVO_PAY_TO to your Stellar address
npx movo doctor           # checks everything before you need it
npx movo dev
```

The scaffolder itself works today — `node packages/create-movo-app/dist/bin.js <dir> --template
minimal|discoverable --yes` — but the project it generates depends on unpublished packages, so
`npm install` inside it cannot resolve yet.

Full walkthrough to a settled testnet payment: [docs/quickstart.md](docs/quickstart.md). Role-based
guides for sellers, buyers/agents and operators: [docs/guide/](docs/guide/README.md).

---

## The payment flow, end to end

```
seller: defineResource -> defineApp -> mountExpress
                                          |
buyer/agent  --------- GET /resource ---> |
             <-- 402 + PAYMENT-REQUIRED --|   (carries the Bazaar declaration)
   budget filters the offer                   refuse here = no signature is ever created
   @x402/stellar signs an auth entry
             --- retry + PAYMENT-SIGNATURE -> |
                                              +--> facilitator /verify
                                              +--> handler runs, response buffered
                                              +--> facilitator /settle -> Stellar ledger
                                              |         fee sponsored by the facilitator
                                              |         settlement observer -> catalog
             <-- 200 + body + PAYMENT-RESPONSE +
                                                   the resource is now discoverable
```

Validated on `stellar:testnet` with transactions independently confirmed from Horizon by the tests
themselves — asserting on the facilitator's own report would let a fabricated settlement pass.
Hashes are recorded in [docs/CONFORMANCE.md](docs/CONFORMANCE.md). **No mainnet settlement has ever
been performed.**

---

## x402 compatibility

The x402 repository's own end-to-end suite was run against the Movo facilitator on
`stellar:testnet` and passed **7/7 (100%)**.

The suite covers two HTTP clients (`axios`, `fetch`) across three server frameworks (Express,
Fastify, Hono), plus the **MCP transport** — each completing a real settled payment with an on-chain
hash. Everything in the run is upstream's: upstream's clients, servers, payment requirements and
assertions. The harness resolved `@x402/*` at **2.22.0** while Movo pins **2.21.0**, so this is a
stock client one minor version *ahead* of the pin paying through the service.

Scope, stated plainly: this is a **wire-level interoperability result on testnet**, not a protocol
certification. Two of nine scenarios were not run (a Windows path-length limit in the `next`
server's build, before any payment code executes), the pubnet half has not been run at all, and two
harness accommodations are disclosed in [docs/CONFORMANCE.md](docs/CONFORMANCE.md).

---

## Bazaar

A Bazaar catalog is an index of resources that have been **paid for at least once** through your
facilitator. A seller declares discovery metadata on their resource, a buyer pays and echoes it,
and the facilitator that settled catalogues it — no registration endpoint, no API key, no approval
queue.

- **Discovery metadata** is derived from the same `defineResource` declaration that produces the
  route, including a JSON Schema derived from a Zod v4 input schema.
- **Cataloguing** keys HTTP resources on `routeTemplate` and MCP tools on the
  `(resource.url, toolName)` tuple, so the catalog grows with the number of endpoints rather than
  with traffic.
- **Search** is hybrid: BM25 plus embedding similarity from a permissively licensed local model,
  fused with reciprocal-rank fusion.
- **Ranking** demotes resources with a high recent failure rate and ignores settlements below a
  dust threshold. **Ranking is never for sale** — no sponsored placement, in any form.
- **Integrity** is treated as a trust boundary. Six adversarial controls fail closed with distinct,
  non-null reasons; ownership binds to the `payTo` that actually settled; the controls read the raw
  payload *before* upstream extraction, because upstream soft-drops invalid fields and a control
  reading only its output would report success on the attack.

Storage is a port with two implementations, SQLite (default) and Postgres, behind one suite.

Documentation: [running a catalog](docs/discovery/running-a-catalog.md) ·
[integrity](docs/discovery/integrity.md) · [search quality](docs/discovery/search-quality.md)

---

## MCP

`@movoframework/mcp` exposes a catalog to an agent runtime as exactly three tools, built on
`@modelcontextprotocol/sdk`:

| Tool | What it does |
|---|---|
| `bazaar.search` | Natural-language query over the catalog; returns listings with an id to act on |
| `bazaar.get` | One listing by id, or by the `(resource, toolName)` tuple, with its settlement and failure counts |
| `bazaar.paidCall` | **Pays for and calls** a discovered resource, within a spend cap the operator sets |

An agent can therefore discover *and* pay — this is verified end to end on testnet, with the agent
reading the resource URL out of the search result rather than from any configuration.

`bazaar.paidCall` **requires** a budget; the server constructs the buyer itself so that no caller
can produce a paid-call tool without a spend cap. An over-budget call is refused before a payment is
created, so no signature ever exists. Results are structured and deterministic, with machine-readable
`MOVO_E_*` codes and a non-null reason on every rejection.

The server reads a local catalog; pointing it at a remote facilitator is an open extension point.

Documentation: [discovery server](docs/mcp/discovery-server.md) ·
[agent integration](docs/mcp/agent-integration.md)

---

## The narrow waist

Only files under `packages/core/src/protocol/**` may import from `@x402/*`. The rule is enforced by
Biome (`biome.jsonc`) and proven to fire by `tests/unit/narrow-waist.test.ts`.

`@x402/*` ships roughly weekly. Without this boundary an upstream breaking change would surface
across every package at once; with it, the blast radius is one directory. See
[ADR-0004](docs/adr/0004-x402-narrow-waist.md).

---

## Repository layout

```
packages/core            project model, resource compilation, errors, the protocol waist
packages/server          mounting compiled resources onto a Node HTTP framework
packages/stellar         preflight diagnostics
packages/bazaar          discovery declaration derivation and severity escalation
packages/client          buyer budget accounting and typed clients
packages/testing         facilitator fixtures, failure matrix, matchers
packages/cli             the movo command line interface
packages/create-movo-app scaffolding (templates: minimal, discoverable)

packages/facilitator     [SCF track] signer pool, metering, rate limiting, config
packages/catalog         [SCF track] catalog store, settle-time ingest, integrity, search
packages/mcp             [SCF track] MCP discovery server

apps/facilitator         deployable Hono facilitator service (private, Dockerfile)
examples/                weather-api · discoverable-api · agent-buyer
                         catalog-quickstart · mcp-agent
scripts/                 compliance gates, compatibility and error-doc generators, search eval
tests/                   unit · integration · e2e · conformance · search eval fixtures
docs/adr/                architecture decision records (0001–0013)
docs/COMPATIBILITY.md    GENERATED — never hand-edited
docs/reference/errors.md GENERATED — never hand-edited
```

Movo ships as **two tracks**. The core track (`core`, `server`, `stellar`, `bazaar`, `client`,
`testing`, `cli`, `create-movo-app`) is independent of the SCF track (`facilitator`, `catalog`,
`mcp`): no core-track package may import an SCF-track package, by specifier, relative path or
declared dependency. This is enforced by `pnpm check:track-isolation`, not by convention.

---

## Requirements

Node.js **≥22** (CI matrix: 22, 24, 26) and **pnpm 10.x** (the workspace pins `pnpm@10.23.0`).
ESM-only — Movo packages cannot be `require()`d. npm and yarn are supported for *consuming*
published packages, but the workspace itself assumes pnpm.

Optional peer dependencies: `@huggingface/transformers` for semantic search (absent, the catalog
runs lexical-only and reports `partialResults`), and `pg` for the Postgres catalog store.

---

## Development

```bash
pnpm install
pnpm check:licenses            # no AGPL/SSPL/GPL anywhere in the dependency path
pnpm check:track-isolation     # the core track never imports the SCF track
pnpm check:protocol-purity     # no protocol primitive is reimplemented
pnpm check:upstream-validators # every validation resolves to an upstream export
pnpm check:project-references  # every workspace dependency is also a TS project reference
pnpm typecheck
pnpm lint
pnpm build
pnpm check:errors              # docs/reference/errors.md matches the registry
pnpm check:docs                # every TypeScript block in the docs compiles
pnpm test                      # unit + integration; no network
pnpm test:templates            # the scaffold templates compile and pass their generated tests
```

Everything above runs in CI on every push, across Node 22, 24 and 26
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). A gitleaks secret scan runs as a sibling
job so it is never gated behind a build.

Network-touching and long-running suites are **opt-in and do not run in the PR gate**:

```bash
MOVO_E2E=1 pnpm test:e2e           # real Stellar testnet settlement
MOVO_E2E=1 pnpm test:conformance   # third-party services
pnpm test:search-eval              # nDCG@10 / recall@20 with build-failing floors
pnpm generate:compat               # regenerates docs/COMPATIBILITY.md from the live facilitator

# the catalog suite against Postgres as well as SQLite
MOVO_CATALOG_TEST_POSTGRES_URL=postgres://user:pass@host:5432/db pnpm test:integration
```

`test:e2e` and `test:conformance` run weekly in
[`.github/workflows/conformance.yml`](.github/workflows/conformance.yml). `test:search-eval` and the
Postgres catalog run are **not currently wired into any workflow** — both are M8 follow-ups. Without
`MOVO_CATALOG_TEST_POSTGRES_URL` the Postgres rows skip visibly rather than reporting one backend as
two.

---

## Compatibility

[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) is **generated** by `pnpm generate:compat`. It
records the exact installed `@x402/*` versions and the live `/supported` payload from the configured
facilitator. Do not edit it by hand; where it disagrees with the architecture specification, the
generated file is the one describing reality.

Currently pinned: `@x402/core`, `@x402/stellar`, `@x402/extensions`, `@x402/express` and
`@x402/fetch` at **2.21.0**; `@stellar/stellar-sdk` **16.2.0**;
`@modelcontextprotocol/sdk` **1.30.0**.

`@x402/*` dependencies are exact-pinned, with no caret or tilde ranges. A bump is a dedicated PR
that regenerates the matrix and re-runs conformance.

---

## Licence

[Apache-2.0](LICENSE), chosen over MIT for the explicit patent grant and to match `@x402/*`.

No AGPL, SSPL or GPL is permitted anywhere in the dependency path — a Movo facilitator is designed
to be operated as a network service, and the AGPL's network clause would extend to third parties it
serves. `pnpm check:licenses` currently reports **0 prohibited licences across 373 resolved
packages**, with two LGPL/unresolved-SPDX warnings on transitive development dependencies that do
not ship.

The OpenZeppelin Relayer, the x402 Facilitator Plugin and the OpenZeppelin Relayer SDK are
AGPL-3.0-or-later and must never be vendored, forked or copied; calling a hosted facilitator over
HTTP is permitted. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Security

Movo never accepts payer private keys server-side, and no package generates or stores a key. Secrets
are redacted at construction time and at every log level, including `debug`. The catalog is treated
as a trust boundary with six adversarial controls that fail closed. Buyer budgets refuse before a
payment is created, so a refused offer leaves no signature in existence.

**No external security review has been performed.** The third-party review required before any
mainnet deployment has not been commissioned. Do not operate a Movo facilitator on `stellar:pubnet`
today.

Report vulnerabilities via [SECURITY.md](SECURITY.md).

---

## Current limitations

Movo is validated on Stellar **testnet**. The following are known, and are future work:

- **Nothing is published to npm.** All packages are at `0.0.0` and unpublished; release automation
  is part of M8. Movo runs from a checkout today.
- **Pubnet/mainnet has never been run.** The configuration path exists and requires an explicit
  Soroban RPC URL, but no pubnet settlement has been performed and no mainnet operational posture
  has been established.
- **Production signer infrastructure is incomplete.** Sponsor keys can be supplied via environment
  seeds for testnet; the KMS/HSM injection point exists but no KMS integration is implemented.
- **No external security review.** Required before any mainnet tag; not started.
- **Smart-account (`__check_auth`) support is unproven.** Upstream is confirmed to accept
  contract-address credentials and Movo requires no change, but no payment from a `__check_auth`
  account has been demonstrated. This is an evidence gap, not a known defect.
- **Some acceptance criteria are partial or unverified.** Of 70 criteria across M0–M7: 59 complete,
  6 partial, 2 missing (pubnet settlement; `__check_auth`), 3 requiring verification.
- **Two gates are not enforced in CI.** The search-quality floor and the Postgres catalog run pass
  locally but are not yet wired into a workflow.
- **The `upto` scheme is not implemented.** Deliberately deferred; the scheme-registration
  extension point is left open. An on-chain discovery registry is likewise out of scope for v1 —
  see [ADR-0013](docs/adr/0013-discovery-architecture.md).

M8 — hardening, conformance evidence, documentation site, security review and the v0.1.0 release —
has not started.
