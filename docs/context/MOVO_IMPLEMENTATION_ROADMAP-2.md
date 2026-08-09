# Movo — Implementation Roadmap

**Principal architect review + 9-milestone plan with copy-paste Claude Code prompts**

Prepared: 2026-08-09
Research basis: official x402 Foundation docs/spec, x402 npm registry metadata (live), Stellar developer docs, SCF Handbook RFP Track (Q3 2026 / SCF #45), Node.js release schedule.

---

## 0. Read this first — five things the research changed

Before the milestones, five findings that materially alter the plan in your context pack. Two of them are blocking.

### 0.1 BLOCKING: "Movo does Bazaar but not a facilitator" is architecturally impossible

Your `01_PROJECT_BRIEF.md` and `03_TECHNICAL_ARCHITECTURE.md` both say Movo should integrate with Bazaar discovery but should **not** build a facilitator. The current Bazaar extension makes that combination unbuildable.

Per the official Bazaar extension docs, cataloging happens **at the facilitator, at settle time**:

> Cataloging happens when a facilitator processes a `PaymentPayload` that includes the echoed `bazaar` extension. A server-side declaration alone catalogs nothing if no paying client echoes it.

And discovery is served by the facilitator: `GET {facilitator_url}/discovery/resources`, `GET {facilitator_url}/discovery/search`. The docs are blunt that this is outside the protocol repo's control:

> Whether and how a resource appears in a facilitator's catalog is an implementation detail of the facilitator operator, an external 3rd party service provider.

So the seller-side Bazaar work Movo can do without a facilitator is exactly one function call — `declareDiscoveryExtension({ input, inputSchema, output })` from `@x402/extensions/bazaar`, already shipped, already documented, already Apache-2.0. **Wrapping that is not a product.** It is roughly 150 lines of ergonomics.

If Movo wants to own discovery in any meaningful sense, Movo must operate a facilitator. There is no third option.

This is not as expensive as it sounds — see 0.3.

### 0.2 BLOCKING: the SCF RFP asks for almost the opposite of the current brief

The open RFP "X402 Facilitator with Bazaar (discovery) support" (SCF #45, Q3 2026) states its own priorities explicitly:

> Settlement on Stellar is largely solved; the novel work is discovery, the agent facing interface, the `upto` scheme upstream, and conformance that holds as the spec moves.

> A working Bazaar for Stellar. **This is the highest value part of the RFP and should carry the largest share of the budget.**

Its hard deliverables include: facilitator on `stellar:testnet` **and** `stellar:pubnet`; `GET /discovery/resources` with the spec's `type`/`payTo`/`network`/`extensions`/`limit`/`offset` filters; `GET /discovery/search` with real natural-language ranking and a stated evaluation methodology; automatic cataloging; an MCP discovery server; the `upto` scheme authored and merged upstream as `scheme_upto_stellar.md`; a permissive OSI licence with **no AGPL anywhere in the dependency path**; and a third-party security review.

Your context pack's non-goals list forbids most of that. **You cannot submit the framework described in `01_PROJECT_BRIEF.md` against this RFP and expect it to score.** Reviewers are told to point stock SDK clients at the deliverable and run the x402 repo's e2e suite against both networks.

**Recommendation.** Keep Movo's framework thesis — it is genuinely good and genuinely differentiated — but treat the facilitator + catalog as *part of Movo*, not as a competitor's job. The framing that holds together:

> Movo is the framework for machine-payable applications on Stellar. It ships the seller SDK, the buyer SDK, the local dev loop — and a Stellar-native Bazaar so the things you build are findable.

That framing satisfies the RFP, keeps the framework as the product, and avoids "just another facilitator," because the facilitator is a thin, replaceable, standards-conformant component (0.3) while the framework and the catalog are the differentiated work.

The roadmap below is sequenced so this decision can be deferred to Milestone 6. Milestones 0–5 are identical either way.

### 0.3 A conformant Stellar facilitator is now a weekend of wiring, not a project

This is what makes 0.1/0.2 affordable. `@x402/core` ships a facilitator primitive and `@x402/stellar` ships the Stellar `exact` scheme for it. The published usage is:

```ts
const facilitator = new x402Facilitator().register(
  "stellar:testnet",
  new ExactStellarScheme([signer]),
);
```

Verify, settle, auth-entry validation, simulation, and expiration checks live inside `ExactStellarScheme`. What is left for Movo is: HTTP surface for `/verify` `/settle` `/supported`, signer/channel-account management, fee sponsorship config, rate limiting, metering, observability, and ops. Real work — but service engineering, not protocol engineering. **Movo must not reimplement verification or settlement.** The RFP says the same thing: "build on @x402/stellar... rather than reimplement verify and settle."

Corollary: the same primitive gives Movo a **local self-facilitator** for the dev loop, which is a genuine framework feature (`movo dev` with no external dependency, deterministic tests) and a strong differentiator on its own.

### 0.4 The OpenZeppelin Relayer facilitator is AGPL-3.0 and is disqualified as a code dependency

`03_TECHNICAL_ARCHITECTURE.md` describes "a production-ready Stellar facilitator built with the OpenZeppelin Relayer/x402 plugin" and says Movo should be able to consume it. Two corrections:

- **Runtime consumption over HTTP is fine.** `https://channels.openzeppelin.com/x402/testnet` (API key required) can be a configured facilitator URL. No licence contamination.
- **Code dependency is not fine.** The RFP is explicit: the OpenZeppelin Relayer, its x402 plugin, and the relayer SDK are AGPL-3.0-or-later, AGPL's network clause applies to a service serving third parties, and they are "out as a base." If Movo ever ships a facilitator under Apache-2.0, none of that code may be in the tree.

Also note the free default for dev: the public `https://www.x402.org/facilitator` supports `stellar:testnet` with **no API key** and correctly returns `extra: { areFeesSponsored: true }`. That is the right default for `movo dev` and for CI.

### 0.5 The proposed `paid()` API in the brief does not match x402 v2

`01_PROJECT_BRIEF.md` proposes:

```ts
export const GET = paid({ price: "$0.001", asset: "USDC" })(handler);
```

Three problems against the current spec and SDK:

1. **`asset: "USDC"` is not a thing.** `price` is either a dollar-string (`"$0.001"`, which the SDK converts and assumes USDC on Stellar) or an explicit object `{ asset: "<SEP-41 contract id>", amount: "<base units>" }`. Stellar USDC has **7 decimals**, not 6 — 1 USDC = 10,000,000 base units. A framework that lets a developer write `asset: "USDC"` and silently guesses the contract is exactly the "hiding important payment semantics" your constitution forbids.
2. **`network` and `payTo` are mandatory** and are CAIP-2 (`stellar:testnet`, `stellar:pubnet`). They cannot be inferred.
3. **The SDK is route-map shaped**, not decorator shaped: `paymentMiddleware({ "GET /weather": { accepts: [...] } }, server)`. A Next-style `export const GET = paid(...)` is a legitimate *adapter*, but it must not be the core model or every non-Next adapter fights it.

**Recommended primary API** — visible protocol semantics, defaults from config, no guessing:

```ts
// movo.config.ts
export default defineConfig({
  network: "stellar:testnet",
  payTo: env("MOVO_PAY_TO"),
  facilitator: { url: "https://www.x402.org/facilitator" },
});

// resources/weather.ts
export default resource({
  method: "GET",
  path: "/weather",
  price: "$0.001",                    // or { asset: "C...", amount: "10000" }
  description: "Current weather by city",
  discovery: {
    input: { city: "San Francisco" },
    inputSchema: { properties: { city: { type: "string", description: "City name" } }, required: ["city"] },
    output: { example: { city: "San Francisco", tempC: 14 } },
  },
  handler: async ({ query }) => ({ city: query.city, tempC: 14 }),
});
```

`network`, `payTo`, and `facilitator` resolve from config but are always overridable and always printed by `movo doctor`. A `paid()` wrapper ships in the Next adapter later.

### 0.6 Smaller corrections

| Context-pack statement | Correction |
|---|---|
| Repo is `coinbase/x402` | Now **`x402-foundation/x402`**. Packages are `@x402/*`, Apache-2.0. The old flat `x402` npm package is at 1.2.0 (Apr 2026) and is legacy — do not use it. |
| "current x402 protocol version" | **v2**, launched 2025-12-11. `x402Version: 2`. v1 still supported by SDKs. |
| `packages/x402/` as a Movo package | **Delete it.** `@x402/core` *is* the x402 layer. A `@movo/x402` wrapper buys nothing and doubles the version-coupling surface. Use a single internal narrow-waist module inside `@movo/core` instead (see 2.2). |
| Node.js LTS | **Node 24 is Active LTS**; 22 is Maintenance; 26 is Current. `@x402/stellar` declares `engines.node >= 22`. Target `>=22`, develop and CI on 24, test-matrix 22/24/26. |
| MPP "future" | MPP is real and now documented on Stellar (`/build/agentic-payments/mpp`). Still correctly out of scope; just don't describe it as hypothetical. |
| Bazaar catalog coverage | The reference CDP catalog currently lists only Base and Solana networks. **No existing catalog carries Stellar.** This is the gap — and it means Movo's catalog cannot be a proxy of someone else's. |

---

## 1. What Movo owns vs. delegates

| Responsibility | Movo owns | Delegated to | Notes |
|---|---|---|---|
| Framework runtime | **Yes** | — | Resource model, lifecycle, hooks, config, errors, adapters. The product. |
| Route/resource abstraction | **Yes** | — | Movo's core value: one declaration drives 402, discovery metadata, types, tests, and docs. |
| x402 protocol types & wire format | No | `@x402/core` | Never hand-roll `PaymentRequired`/`PaymentPayload`. Docs explicitly warn against it. |
| x402 HTTP middleware semantics | **Partly** | `@x402/express`, `@x402/core/server` | Movo owns adapter ergonomics + ordering guarantees; the SDK owns header encoding. |
| Facilitator *interface* | **Yes** | — | Thin `Facilitator` port; hosted / self-hosted / mock / in-process are all implementations. |
| Facilitator *implementation* | **Yes (thin)** | `@x402/core` facilitator + `@x402/stellar` scheme | Movo owns HTTP surface, signer/channel accounts, metering, ops. Never owns verification logic. |
| Stellar settlement | No | `@x402/stellar` → Soroban | Auth-entry construction, simulation, submission. |
| Stellar preflight (trustline, funding, clock) | **Yes** | `@stellar/stellar-sdk` | The single biggest onboarding cliff; nobody else does it. `movo doctor`. |
| Bazaar metadata declaration | **Partly** | `@x402/extensions/bazaar` | Movo derives it from the resource declaration; the SDK emits the wire shape. |
| Bazaar catalog + search | **Yes** | — | Only implementable by a facilitator. The differentiated, RFP-critical work. |
| Wallet / key custody | **No — never** | Client-injected signer | Server never sees a payer key. Non-negotiable. |
| Buyer paid-fetch | **Partly** | `@x402/fetch`, `@x402/core/client` | Movo adds retry policy, budget caps, typed resources, diagnostics. |
| Testing | **Yes** | — | Mock facilitator, in-process facilitator, failure matrix, testnet harness. Framework value. |
| CLI / scaffolding | **Yes** | — | `create-movo-app`, `movo dev|doctor|test|bazaar`. |
| MCP | **Partly, later** | `@x402/mcp` | Adapter + discovery server. Gated on the SCF decision. |
| `upto` scheme | **No (v1)** | — | Needs a new spec + probably a Soroban contract. Separate workstream. See §F risk 9. |

---

## 2. Revised architecture

### 2.1 Package graph

```
                    create-movo-app  (templates)
                            │
            ┌───────────────┼────────────────┬──────────────┐
            ▼               ▼                ▼              ▼
       @movo/cli      @movo/express    @movo/testing   @movo/client
            │               │                │              │
            └───────┬───────┴────────┬───────┘              │
                    ▼                ▼                      │
              @movo/core  ◄──── @movo/bazaar                │
                    │                                       │
                    ▼                                       ▼
              @movo/stellar ──────────────────────► @x402/core
                    │                                @x402/stellar
                    ▼                                @x402/extensions
            @stellar/stellar-sdk                     @x402/express
                                                     @x402/fetch

   SCF-gated service tier (Milestones 6–7):
       apps/facilitator-service  ──► @movo/facilitator ──► @movo/stellar
                                 └─► @movo/catalog     ──► @movo/bazaar
```

Changes from `03_TECHNICAL_ARCHITECTURE.md`:

- **`@movo/x402` deleted.** Its job is done by `@x402/core`. Instead, `@movo/core/src/protocol/` is the *only* directory in the whole monorepo permitted to `import` from `@x402/*` core types — enforced by an ESLint `no-restricted-imports` rule. That gives you one place to absorb SDK churn without paying for a published wrapper package.
- **`@movo/facilitator` and `@movo/catalog` added** (Milestones 6–7), both behind the same `Facilitator` port as the hosted one.
- **`@movo/express` split out** of core so `@movo/core` stays framework-agnostic and testable without HTTP.

### 2.2 The narrow waist

`@movo/core/src/protocol/index.ts` re-exports every x402 type and helper Movo uses, with Movo's own aliases. Every other file imports from there. Consequences: SDK drift shows up as compile errors in exactly one file; the compatibility matrix is generated from it; and the mock/in-process facilitators are typed against the same contract as the hosted one.

### 2.3 Request lifecycle — the ordering rule

The one semantic Movo must get right and must never blur:

```
1. request → resource is payable, no PAYMENT-SIGNATURE
2. → 402 + PAYMENT-REQUIRED header (payment requirements, incl. Bazaar extension)
3. client signs Soroban auth entry, retries with PAYMENT-SIGNATURE
4. Movo → facilitator /verify
5. verify fails → 402 again with a non-null machine-readable reason. Handler NEVER runs.
6. verify succeeds → handler runs
7. handler throws / returns 5xx → DO NOT settle. Return the error.
8. handler succeeds → facilitator /settle
9. settle fails → 402 with reason; the resource body is NOT returned
10. settle succeeds → 200 + body + PAYMENT-RESPONSE (+ EXTENSION-RESPONSES passthrough)
```

Steps 5, 7, and 9 are the acceptance-critical ones: no unpaid access, and no charging for a failed handler. Movo must have a test for each. Handlers must be treated as non-idempotent — settle-after-success means a handler that succeeds but whose settlement fails has done work for free. Document that trade-off explicitly rather than hiding it; offer a `settlementPolicy: "after-handler" | "before-handler"` option with `after-handler` as default and a doc page explaining the risk of each.

---

## 3. Milestone map

| # | Name | Ships | Gate |
|---|---|---|---|
| 0 | Foundation & protocol pin | Monorepo, CI, ADRs, compatibility matrix | — |
| 1 | Core runtime & facilitator port | `@movo/core` | — |
| 2 | **Stellar + first paid testnet request** | `@movo/stellar`, `@movo/express` | **critical path** |
| 3 | Client & testing toolkit | `@movo/client`, `@movo/testing` | — |
| 4 | Bazaar seller surface | `@movo/bazaar` | — |
| 5 | CLI & scaffolding | `@movo/cli`, `create-movo-app` | **v0.1.0-alpha** |
| 6 | Facilitator (self-host + in-process) | `@movo/facilitator` | SCF-gated |
| 7 | Bazaar catalog, search & MCP discovery | `@movo/catalog`, `apps/facilitator-service` | SCF-gated |
| 8 | Conformance, security, docs, release | docs site, e2e, changesets | **v0.1.0** |

Milestones 0–5 and 8 are the framework. 6–7 are the SCF deliverable. If the SCF submission is dropped, cut 6–7 and ship 8 directly after 5 — but keep the in-process facilitator from 6, because the dev loop depends on it (fold that one component into Milestone 3).

---
---

# Milestone 0 — Foundation & Protocol Pin

## 1. Objective

Stand up the monorepo, toolchain, CI, licensing, and — most importantly — a **generated, tested compatibility matrix** that pins the exact `@x402/*` versions Movo builds against and proves the pinned facilitator is reachable and conformant.

## 2. Why this milestone exists

`@x402/*` shipped 2.21.0 on 2026-08-04 and moves on a roughly weekly cadence, with internal cross-package pins at `~2.21.0`. Movo's single largest maintenance risk is silent drift against a moving SDK. The cheapest possible mitigation is a machine-checked pin plus a live `/supported` probe, established before any feature code exists. Doing this later means retrofitting it across seven packages.

## 3. Starting state

Empty repository.

## 4. End state

`pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` all pass on a clean clone. `docs/COMPATIBILITY.md` exists and is generated, not hand-written. CI is green on Node 22/24/26.

## 5. Scope

- pnpm workspace, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest, Biome, Changesets, GitHub Actions.
- Empty-but-buildable packages: `core`, `stellar`, `bazaar`, `client`, `testing`, `cli`, `express`, plus `create-movo-app`.
- `scripts/generate-compatibility.ts` → reads installed `@x402/*` versions, probes the configured facilitator's `/supported`, writes `docs/COMPATIBILITY.md`.
- A conformance smoke test (network-gated) asserting `/supported` advertises `stellar:testnet` and `extra.areFeesSponsored`.
- OSS files: `LICENSE` (Apache-2.0), `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, issue/PR templates.
- ADR directory with ADR-0001..0004 written in this milestone.
- `scripts/check-licenses.ts` — fails the build on any AGPL/SSPL/GPL in the dependency tree.

## 6. Explicit non-scope

No payment logic. No Stellar code. No HTTP servers. No CLI commands beyond a version stub. No docs site. Do not implement `Facilitator` yet — that is Milestone 1.

## 7. Files / packages

```
movo/
├── .github/workflows/ci.yml
├── .github/ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md
├── docs/adr/0001-framework-abstraction-model.md
│         ├── 0002-package-boundaries.md
│         ├── 0003-facilitator-abstraction.md
│         └── 0004-x402-narrow-waist.md
├── docs/COMPATIBILITY.md            (generated)
├── packages/{core,stellar,bazaar,client,testing,cli,express}/
│         ├── package.json, tsconfig.json, src/index.ts, src/index.test.ts
├── packages/create-movo-app/
├── scripts/generate-compatibility.ts
├── scripts/check-licenses.ts
├── tests/conformance/supported.test.ts
├── biome.json, vitest.config.ts, tsconfig.base.json
├── pnpm-workspace.yaml, package.json, .changeset/config.json
├── LICENSE CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md README.md
└── .env.example
```

## 8. Implementation tasks

1. `pnpm init`; set `packageManager`, `engines.node: ">=22"`; create `pnpm-workspace.yaml` covering `packages/*` and `apps/*`.
2. `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module: nodenext`, `target: es2023`, `isolatedDeclarations`.
3. Each package: ESM-only, `exports` map with subpaths, `types` first, `sideEffects: false`. Build with `tsc` project references — no bundler in the core packages (bundling a library that ships types is a net negative here).
4. Biome for lint+format. Add `no-restricted-imports` forbidding `@x402/*` outside `packages/core/src/protocol/**` (this rule matters more than any other lint rule in the repo — comment it as such).
5. Vitest workspace config; `pool: forks`; coverage thresholds start at 80% lines for `core`.
6. Install and **exact-pin** `@x402/core`, `@x402/extensions`, `@x402/stellar`, `@x402/express`, `@x402/fetch` at the resolved current version. No caret ranges anywhere in the repo for `@x402/*`.
7. Write `scripts/generate-compatibility.ts`: reads `node_modules/@x402/*/package.json` versions, reads `MOVO_FACILITATOR_URL` (default `https://www.x402.org/facilitator`), fetches `/supported`, emits a markdown table of x402 version, protocol version, networks, schemes, and `extra` flags. Include a "generated at" line and a warning that it must be regenerated on dependency bumps.
8. `tests/conformance/supported.test.ts`: skipped unless `MOVO_E2E=1`. Asserts HTTP 200, presence of `stellar:testnet`, scheme `exact`, and `areFeesSponsored`.
9. `scripts/check-licenses.ts`: walk the resolved lockfile, fail on `AGPL`, `SSPL`, `GPL-3.0`, `GPL-2.0` (allow `LGPL` with a printed warning). Wire into CI. Add a comment explaining the SCF licence constraint.
10. CI: matrix Node 22/24/26 × ubuntu; steps install → licence check → typecheck → lint → build → test. A separate manually-triggered `conformance.yml` workflow runs the `MOVO_E2E=1` suite.
11. Write the four ADRs. Each ≤ 1 page, with a Decision / Context / Consequences / Alternatives-rejected structure. ADR-0004 must state the narrow-waist rule and why `@movo/x402` was rejected.
12. `README.md`: what Movo is, what it is not, status badge, quickstart placeholder.

## 9. Architecture decisions to follow

- ESM-only. No CJS dual build. Node 22+ makes this safe and dual-publishing doubles the failure surface.
- No `@movo/x402` package (ADR-0004).
- Exact pins for `@x402/*`; caret ranges permitted elsewhere.
- Apache-2.0 (matches `@x402/*`, satisfies the SCF permissive-licence requirement, better patent posture than MIT for a payments framework).

## 10. Dependencies

None (first milestone). External: pnpm ≥10, Node ≥22.

## 11. Testing strategy

- Unit: each package exports a version constant; trivial smoke test so no package is untested from day one.
- Script test: `generate-compatibility` against a fixture `node_modules` layout and a mocked `/supported` response.
- Conformance (gated): live `/supported` probe.
- Failure case: `check-licenses` must be tested against a fixture with a planted AGPL package and must fail.

## 12. Documentation

`README.md`, `CONTRIBUTING.md` (incl. the narrow-waist rule and the PR checklist from `06_REPOSITORY_CONSTITUTION.md`), `SECURITY.md` (private disclosure address, 90-day policy), `docs/COMPATIBILITY.md` (generated), four ADRs.

## 13. Security considerations

- `.env.example` only; `.gitignore` must cover `.env`, `.env.*`, `*.key`, and `secrets/`.
- Add a secret-scanning CI step (gitleaks or equivalent) now, before any key-adjacent code exists.
- `SECURITY.md` states that Movo never accepts payer private keys server-side.

## 14. Acceptance criteria

1. `git clone && pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test` exits 0 on Node 22, 24, and 26.
2. `pnpm generate:compat` writes `docs/COMPATIBILITY.md` containing the exact installed `@x402/core` version string.
3. `MOVO_E2E=1 pnpm test:conformance` passes and the output contains `stellar:testnet`.
4. A file under `packages/stellar/src/` importing `@x402/core` fails `pnpm lint` with the narrow-waist error.
5. `pnpm check:licenses` exits 0 on the real tree and exits non-zero on the AGPL fixture.
6. `pnpm changeset` runs.
7. Four ADR files exist and are non-empty.

## 15. Definition of done

- [ ] Clean clone → all scripts green on 22/24/26
- [ ] Compatibility matrix generated, not hand-written
- [ ] Narrow-waist lint rule proven to fire
- [ ] Licence gate proven to fire
- [ ] Secret scanning in CI
- [ ] ADRs 0001–0004 written
- [ ] Zero `TODO` in shipped source

## 16. Risks

| Risk | Mitigation |
|---|---|
| `@x402/*` bumps mid-development and breaks types | Exact pins + generated matrix + a dedicated renovate/dependabot PR path that must regenerate the matrix |
| Public facilitator down → CI red | Conformance suite is a separate, non-blocking workflow, never in the PR gate |
| ESM-only alienates CJS consumers | Documented explicitly in the README; revisit only on real user reports |
| Over-engineered build (bundlers, dual output) | Explicit decision: `tsc` project refs only |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 0 of Movo, an open-source TypeScript framework for building
machine-payable APIs with x402, Bazaar discovery, and Stellar settlement.

FIRST, DO NOT WRITE CODE. Do these in order:
1. Run `ls -la` and `git status`. If the repo is non-empty, stop and summarise what exists
   before proceeding.
2. Read the Movo context documents in the repository or project (01_PROJECT_BRIEF.md,
   02_PRODUCT_REQUIREMENTS.md, 03_TECHNICAL_ARCHITECTURE.md, 04_MVP_SCOPE_AND_ACCEPTANCE.md,
   06_REPOSITORY_CONSTITUTION.md) and this roadmap document.
3. Verify current facts before pinning anything. Check the npm registry for the current
   versions of @x402/core, @x402/stellar, @x402/express, @x402/extensions, @x402/fetch
   (e.g. `npm view @x402/core version`). Check https://docs.x402.org and
   https://developers.stellar.org/docs/build/agentic-payments/x402 if any protocol detail
   is unclear. Do NOT rely on your training data for version numbers or package names.
   The x402 repo is github.com/x402-foundation/x402 (it moved from coinbase/x402).

MILESTONE 0 GOAL
Create the monorepo foundation and a generated, machine-checked compatibility matrix.
No payment logic, no Stellar code, no HTTP servers in this milestone.

WHAT TO BUILD

A pnpm workspace with these empty-but-buildable packages, all ESM-only, all built with
tsc project references (no bundler):
  packages/core, packages/stellar, packages/bazaar, packages/client,
  packages/testing, packages/cli, packages/express, packages/create-movo-app

Root config:
- package.json with engines.node ">=22" and packageManager pinned to the pnpm version you use
- pnpm-workspace.yaml covering packages/* and apps/*
- tsconfig.base.json with: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  verbatimModuleSyntax, isolatedDeclarations, module nodenext, target es2023
- biome.json for lint + format
- vitest.config.ts (workspace mode, pool: forks, 80% line coverage threshold on core)
- .changeset/config.json

CRITICAL ARCHITECTURE RULE — implement this as a lint rule, not a convention:
Only files under packages/core/src/protocol/** may import from @x402/*. Every other file
in the monorepo must import x402 types and helpers via @movo/core's protocol module.
Enforce with Biome's noRestrictedImports (or an equivalent). Add a comment in biome.json
explaining that this is the "narrow waist" that isolates x402 SDK churn to one directory.
Then PROVE it fires: temporarily add an importing file under packages/stellar/src,
show the lint failure, and delete the file.

Dependencies: install @x402/core, @x402/extensions, @x402/stellar, @x402/express, @x402/fetch
at EXACT versions (no ^ or ~) at the root or in core as appropriate. Every other dependency
may use caret ranges. Justify every dependency you add in the commit message.

scripts/generate-compatibility.ts:
- reads the installed versions of every @x402/* package from node_modules
- reads MOVO_FACILITATOR_URL from env, defaulting to https://www.x402.org/facilitator
- GETs {facilitatorUrl}/supported
- writes docs/COMPATIBILITY.md: a table of x402 package versions, the advertised x402
  protocol version, supported networks, supported schemes, and any `extra` flags such as
  areFeesSponsored; plus Node/TypeScript/pnpm versions and a generated-at timestamp
- exposed as `pnpm generate:compat`

scripts/check-licenses.ts:
- walks the resolved dependency tree and exits non-zero if any AGPL-*, SSPL-*, GPL-2.0 or
  GPL-3.0 package is present (LGPL: warn only)
- this exists because Movo must ship under a permissive OSI licence with no strong copyleft
  anywhere in the dependency path
- exposed as `pnpm check:licenses`, wired into CI
- write a test using a fixture tree containing a planted AGPL package; the test must assert
  the script fails

tests/conformance/supported.test.ts:
- skipped unless process.env.MOVO_E2E === "1"
- fetches {MOVO_FACILITATOR_URL}/supported and asserts 200, that stellar:testnet appears,
  that the exact scheme appears, and that areFeesSponsored is present
- run via `pnpm test:conformance`

CI (.github/workflows/ci.yml): matrix Node 22, 24, 26 on ubuntu-latest.
Steps: install -> check:licenses -> typecheck -> lint -> build -> test.
Add a secret-scanning step (gitleaks or equivalent).
Separate workflow conformance.yml, workflow_dispatch only, running MOVO_E2E=1 tests.
The conformance job must NEVER block the PR gate — the public facilitator is a third-party
service and its downtime must not turn the repo red.

OSS files: LICENSE (Apache-2.0), README.md, CONTRIBUTING.md (include the narrow-waist rule
and the PR checklist from 06_REPOSITORY_CONSTITUTION.md), CODE_OF_CONDUCT.md,
SECURITY.md (state that Movo never accepts payer private keys server-side),
.github/ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md, .env.example, .gitignore covering
.env, .env.*, *.key, secrets/.

ADRs in docs/adr/, each with Context / Decision / Consequences / Alternatives rejected:
- 0001 framework abstraction model (resource declaration drives 402 + discovery + types)
- 0002 package boundaries (why these seven packages; why @movo/x402 was NOT created)
- 0003 facilitator abstraction (a port with hosted / in-process / mock implementations)
- 0004 the x402 narrow waist (the lint rule above and its rationale)

CONSTRAINTS
- Do not invent protocol behaviour. If a protocol detail is unclear, look it up or leave it
  for a later milestone; never guess.
- Do not add dependencies beyond what is listed unless you justify each one in writing.
- No placeholder or TODO-driven code. Every file you create must do its job.
- Do not create files that are not listed above.
- Production-quality strict TypeScript. No `any`, no non-null assertions without a comment.

BEFORE YOU FINISH
1. Run: pnpm install && pnpm check:licenses && pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Run: pnpm generate:compat and show me the resulting docs/COMPATIBILITY.md
3. Run: MOVO_E2E=1 pnpm test:conformance and report the result honestly. If the public
   facilitator is unreachable, say so plainly — do not fake a pass.
4. Run `git diff --stat` and `git status`, then summarise every meaningful change.
5. If you found any conflict between this milestone's instructions and the current official
   x402 / Stellar documentation, STOP and explain it rather than silently redesigning.
````

---
---

# Milestone 1 — Core Runtime & Facilitator Port

## 1. Objective

Build `@movo/core`: the resource model, configuration system, error taxonomy, redaction layer, the x402 narrow waist, and the `Facilitator` port with HTTP and mock implementations. Transport-agnostic and network-agnostic — no Stellar, no Express.

## 2. Why this milestone exists

Everything downstream is an implementation of an interface defined here. Defining the resource model and facilitator port before touching Stellar is what keeps Movo from becoming Stellar-shaped in a way that blocks a second network later. It is also the only milestone that can be fully tested without a blockchain, which makes it the right place to build the error and redaction discipline that the rest of the codebase inherits.

## 3. Starting state

Milestone 0 complete.

## 4. End state

`@movo/core` can take a resource declaration, produce spec-shaped x402 payment requirements via `@x402/core`, run the verify → handler → settle lifecycle against an injected `Facilitator`, and return the correct outcome for every branch — all under unit test, with zero network access.

## 5. Scope

- `defineConfig` / `resource` / `defineApp` declarations with full type inference on handler input/output.
- Config resolution: defaults → `movo.config.ts` → environment → per-resource override, with the resolved value and its **source** recorded for `movo doctor`.
- Environment separation: `local` | `testnet` | `production`, with a hard guard that `production` requires explicit opt-in and never defaults.
- The `Facilitator` port; `HttpFacilitator` (delegating to `@x402/core`'s `HTTPFacilitatorClient`, including `createAuthHeaders` for API-keyed facilitators); `MockFacilitator`.
- `MovoError` taxonomy: stable `code`, human message, safe `context`, `cause`, and `toJSON()` that is redaction-safe by construction.
- Redaction: a `redact()` used by every log/serialise path, covering `PAYMENT-SIGNATURE`, `Authorization`, any `*KEY*`/`*SECRET*`/`*TOKEN*` env var, Stellar `S...` secrets, and full payment payloads.
- The payment lifecycle state machine (§2.3) as a pure function of `(requirements, payloadOrNull, facilitator, handler)`.
- Correlation/request IDs propagated through errors and hooks.
- Hooks: `onPaymentRequired`, `onVerify`, `onSettle`, `onError`.

## 6. Explicit non-scope

No Stellar. No Express/Node HTTP server. No Bazaar. No CLI. No real facilitator calls in tests. Do not implement `@movo/express` — Milestone 2. Do not add a plugin system.

## 7. Files / packages

```
packages/core/src/
├── protocol/index.ts        ← THE ONLY place importing @x402/*
├── protocol/requirements.ts  (resource decl → PaymentRequirements)
├── config/{defineConfig,resolve,env,schema}.ts
├── resource/{define,types,registry}.ts
├── facilitator/{port,http,mock,index}.ts
├── lifecycle/{handlePaidRequest,state}.ts
├── errors/{MovoError,codes,serialize}.ts
├── observability/{redact,logger,correlation}.ts
└── index.ts
```

## 8. Implementation tasks

1. Write `protocol/index.ts` first. Re-export `PaymentRequirements`, `PaymentPayload`, `SettleResponse`, `VerifyResponse`, network/scheme types, and the facilitator client from `@x402/core`, under Movo names. Nothing else in the repo may import `@x402/*`.
2. Define `MovoResource<TInput, TOutput>` with `method`, `path`, `price`, `network?`, `payTo?`, `description?`, `mimeType?`, `serviceName?`, `tags?`, `iconUrl?`, `discovery?` (opaque here; typed in Milestone 4), `settlementPolicy?`, `handler`.
3. `price` type: `` `$${string}` `` | `{ asset: string; amount: string }`. **Do not** accept `asset: "USDC"`. Add a `MOVO_E_PRICE_ASSET_ALIAS` error whose message explains dollar-string vs explicit `{asset, amount}` and mentions Stellar's 7 decimals.
4. Config resolution returning `{ value, source }` pairs. `source` ∈ `default | config | env | override`. This powers `movo doctor` and is worth the small extra plumbing.
5. Environment guard: `MOVO_ENV=production` must be set explicitly *and* the resolved network must not be a testnet, or throw `MOVO_E_ENV_NETWORK_MISMATCH`. A production config pointing at `stellar:testnet` is a bug, and so is the reverse.
6. `Facilitator` port — mirror the x402 facilitator contract exactly: `supported()`, `verify(payload, requirements)`, `settle(payload, requirements)`. Do not invent extra methods. Add `describe()` returning a redacted, loggable identity (url + whether auth is configured) — that is Movo's, not the protocol's, and must be marked as such.
7. `HttpFacilitator` wraps `HTTPFacilitatorClient`, supports `createAuthHeaders`, applies a configurable timeout and a bounded retry on network errors only (never on a protocol-level rejection — retrying a rejected payment is a correctness bug).
8. `MockFacilitator` with programmable outcomes: `ok`, `verifyRejected(reason)`, `settleFailed(reason)`, `timeout`, `malformedResponse`. Records all calls for assertion.
9. `MovoError`: `code` (screaming-snake, stable, documented in `errors/codes.ts` with a one-line meaning each), `message`, `context` (already redacted at construction), `cause`, `correlationId`. `toJSON()` must be the only serialisation path.
10. `redact()`: deny-list plus pattern matching on Stellar secret seeds (`^S[A-Z2-7]{55}$`) and base64 payment payloads. Write the tests against a fixture containing a real-shaped (but invalid) secret key and assert it never appears in output.
11. `handlePaidRequest()`: the pure lifecycle. Signature roughly `(ctx: { requirements, paymentPayload | null, facilitator, resource, hooks }) => Promise<PaidOutcome>` where `PaidOutcome` is a discriminated union: `{ kind: "payment-required", requirements }`, `{ kind: "rejected", reason, requirements }`, `{ kind: "handler-error", error }`, `{ kind: "settled", body, settleResponse }`. Adapters map this union to HTTP. This is what makes Movo adapter-agnostic.
12. Hooks are async, awaited, and **cannot** change the outcome — a hook that throws is logged and swallowed except in `onError`. Document this.

## 9. Architecture decisions

- The lifecycle returns a union, not an HTTP response. Adapters own HTTP.
- Settlement default is **after** a successful handler; `settlementPolicy: "before-handler"` is available and documented with its trade-off.
- Verification failure and settlement failure both produce 402 with a **non-null machine-readable reason** — the RFP requires a non-null reason on every rejection, and it is good practice regardless.
- Hooks are observers, never interceptors, in v1.

## 10. Dependencies

Milestone 0. External: `@x402/core` (exact pin), `zod` (already a transitive dep of `@x402/core`; use the same major to avoid two zod copies — check the installed version before choosing).

## 11. Testing strategy

Unit only, no network. Required cases:

- Requirements generation: dollar-string price; explicit `{asset, amount}`; missing `network`; missing `payTo`; `asset: "USDC"` alias → specific error.
- Config: each resolution source wins in the right order; `source` reported correctly; production/testnet mismatch throws.
- Lifecycle, one test each: no payload → `payment-required`; verify rejected → `rejected` **and handler was not invoked** (assert via spy); handler throws → `handler-error` **and settle was not called**; settle fails → `rejected` and body not returned; happy path → `settled`.
- Facilitator: HTTP retry happens on `ECONNRESET`, does **not** happen on a verify rejection; timeout produces `MOVO_E_FACILITATOR_TIMEOUT`; malformed response produces `MOVO_E_FACILITATOR_MALFORMED` and does not throw a raw parse error.
- Redaction: property-based test that no fixture secret ever appears in `MovoError.toJSON()`, logger output, or hook payloads.

## 12. Documentation

`docs/concepts/resources.md`, `docs/concepts/configuration.md`, `docs/concepts/lifecycle.md` (with the §2.3 ordering diagram and the settlement-policy trade-off), `docs/reference/errors.md` (generated from `errors/codes.ts`). ADR-0005 route lifecycle.

## 13. Security considerations

- Redaction is a construction-time invariant, not a logging-time filter — `MovoError.context` is redacted when the error is created, so an unredacted value cannot leak through an unexpected serialisation path.
- No payer key material may appear anywhere in `@movo/core`'s types. If a type would allow it, the type is wrong.
- Facilitator auth headers live only in the `createAuthHeaders` closure and must never be stored on the instance in plain form.

## 14. Acceptance criteria

1. `resource({ price: "$0.001", network: "stellar:testnet", payTo: "G..." })` produces `PaymentRequirements` that `@x402/core`'s own schema validates.
2. `resource({ price: { asset: "USDC" } as any })` throws `MOVO_E_PRICE_ASSET_ALIAS` with a message naming both accepted price formats.
3. A `MockFacilitator` set to `verifyRejected("insufficient_funds")` produces `{ kind: "rejected", reason: "insufficient_funds" }` and the handler spy has zero calls.
4. A handler that throws produces `{ kind: "handler-error" }` and the facilitator's `settle` spy has zero calls.
5. `MockFacilitator` set to `settleFailed` produces a `rejected` outcome whose payload does not contain the handler's return value.
6. `MOVO_ENV=production` with `network: "stellar:testnet"` throws `MOVO_E_ENV_NETWORK_MISMATCH`.
7. Every entry in `errors/codes.ts` has a docs line; a test asserts docs and code list are in sync.
8. Redaction test: a fixture secret seed appears in zero bytes of all serialised outputs.
9. `pnpm test --coverage` reports ≥ 90% lines for `packages/core`.

## 15. Definition of done

- [ ] All nine acceptance criteria pass
- [ ] Zero network calls in the unit suite (assert by failing the suite if `fetch` is invoked)
- [ ] `@x402/*` imported in exactly one directory
- [ ] Three concept docs + generated error reference
- [ ] ADR-0005 written
- [ ] Changeset added

## 16. Risks

| Risk | Mitigation |
|---|---|
| Over-abstracting before a real payment exists | Hard cap: no interface in this milestone may have fewer than two real implementations by Milestone 3 |
| The lifecycle union doesn't survive contact with Express | Milestone 2 is deliberately next; if the union is wrong it is cheap to change now |
| Duplicate `zod` majors | Check `@x402/core`'s installed zod major and match it; add a test asserting a single zod resolution |
| Redaction misses a path | Construction-time redaction + a property-based test, not a review checklist |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 1 of Movo, an open-source TypeScript framework for building
machine-payable APIs with x402, Bazaar discovery, and Stellar settlement.

FIRST, DO NOT WRITE CODE.
1. Inspect the repository: `ls -R packages`, read the root package.json, tsconfig.base.json,
   biome.json, and every file in docs/adr/. Milestone 0 is complete; preserve its decisions.
2. Read docs/COMPATIBILITY.md to see the exact pinned @x402/* versions.
3. Read the Movo context documents, especially 02_PRODUCT_REQUIREMENTS.md section 4
   (framework design requirements) and 06_REPOSITORY_CONSTITUTION.md.
4. Research the CURRENT @x402/core API before designing against it. Read
   https://docs.x402.org (core concepts, facilitator, and the TypeScript examples) and
   inspect the installed package: `ls node_modules/@x402/core` and read its .d.ts files
   for PaymentRequirements, PaymentPayload, VerifyResponse, SettleResponse, and
   HTTPFacilitatorClient. Do NOT design against remembered APIs — x402 v2 shipped in
   December 2025 and the SDK moves weekly. The repo is github.com/x402-foundation/x402.

MILESTONE 1 GOAL
Build @movo/core: resource model, configuration, error taxonomy, redaction, the x402
narrow waist, the Facilitator port, and the payment lifecycle state machine.

NO Stellar code. NO Express or HTTP server. NO Bazaar. NO CLI. NO network calls in tests.

BUILD THIS

packages/core/src/protocol/index.ts — the ONLY file in the monorepo that imports @x402/*.
Re-export the x402 types and the facilitator client under Movo-owned names. Every other
Movo file imports from here. The lint rule from Milestone 0 enforces this; do not weaken it.

Resource model (src/resource/):
  resource<TInput, TOutput>({ method, path, price, network?, payTo?, description?,
    mimeType?, serviceName?, tags?, iconUrl?, discovery?, settlementPolicy?, handler })
  price is `$${string}` | { asset: string; amount: string } — a dollar string, or an
  explicit SEP-41 contract address plus an amount in base units. It must NOT accept
  `asset: "USDC"`; that form appears in an early Movo draft and is wrong against x402 v2.
  If someone passes it, throw MOVO_E_PRICE_ASSET_ALIAS with a message explaining both
  correct formats and noting that Stellar USDC has 7 decimals (1 USDC = 10000000 base units).
  Handler input/output types must flow through to the caller — test the inference.

Configuration (src/config/): defineConfig + a resolver with precedence
  default < movo.config.ts < environment < per-resource override.
  The resolver returns { value, source } pairs where source is "default" | "config" | "env"
  | "override", because `movo doctor` will print where every setting came from.
  Environments: "local" | "testnet" | "production". MOVO_ENV=production must be explicit and
  must throw MOVO_E_ENV_NETWORK_MISMATCH if the resolved network is a testnet (and vice versa).

Facilitator port (src/facilitator/): mirror the x402 facilitator contract EXACTLY —
supported(), verify(), settle(). Do not invent protocol methods. You may add describe()
returning a redacted identity for diagnostics; mark it clearly as Movo's own, not protocol.
  - HttpFacilitator wraps @x402/core's HTTPFacilitatorClient, supports createAuthHeaders
    for API-keyed facilitators, applies a timeout, and retries ONLY on transport errors.
    Never retry a protocol-level rejection — retrying a rejected payment is a correctness bug.
  - MockFacilitator with programmable outcomes: ok, verifyRejected(reason),
    settleFailed(reason), timeout, malformedResponse. Records every call for assertions.

Errors (src/errors/): MovoError with a stable screaming-snake `code`, human message,
already-redacted `context`, `cause`, and `correlationId`. codes.ts lists every code with a
one-line meaning. toJSON() is the ONLY serialisation path.

Redaction (src/observability/redact.ts): used by every log and serialise path. Must catch
Authorization headers, PAYMENT-SIGNATURE, env vars matching KEY/SECRET/TOKEN, Stellar secret
seeds (/^S[A-Z2-7]{55}$/), and base64 payment payloads. Redaction happens at MovoError
CONSTRUCTION time, not at log time, so an unredacted value cannot escape through an
unexpected code path.

Lifecycle (src/lifecycle/handlePaidRequest.ts): a pure async function returning a
discriminated union, NOT an HTTP response — adapters map it to HTTP in Milestone 2:
  { kind: "payment-required", requirements }
  { kind: "rejected", reason, requirements }      // reason must never be null
  { kind: "handler-error", error }
  { kind: "settled", body, settleResponse }
Ordering rules that are non-negotiable and each need their own test:
  - no payment payload -> payment-required; handler NOT invoked
  - verify rejected -> rejected; handler NOT invoked
  - handler throws -> handler-error; settle NOT called (never charge for a failed handler)
  - settle fails -> rejected; handler's return value NOT returned to the caller
  - success -> settled
Default settlementPolicy is "after-handler". Also support "before-handler" and document the
trade-off honestly in docs/concepts/lifecycle.md (after-handler risks unpaid work if
settlement fails; before-handler risks charging for work that then fails).

Hooks: onPaymentRequired, onVerify, onSettle, onError. Awaited, observers only — a hook
cannot change the outcome, and a throwing hook is logged and swallowed. Document this.

TESTS (Vitest, unit only, zero network)
Write the tests alongside the code, not after. Required: requirements generation for both
price forms and each missing-field error; the price alias error; config precedence and
source reporting; the env/network mismatch; one test per lifecycle branch above using spies
to prove handler and settle were or were not called; facilitator retry-on-transport but
not-on-rejection; timeout and malformed-response errors; and a redaction test asserting a
fixture Stellar secret seed appears in zero bytes of every serialised output.
Make the suite FAIL if any test performs a real fetch — stub globalThis.fetch and assert it
was never called by the unit suite.
Coverage for packages/core must be >= 90% lines.

DOCUMENTATION
docs/concepts/resources.md, docs/concepts/configuration.md, docs/concepts/lifecycle.md
(include the ordering rules and the settlement-policy trade-off), and
docs/reference/errors.md generated from errors/codes.ts with a test asserting they stay in
sync. Write docs/adr/0005-route-lifecycle.md.

CONSTRAINTS
- Never invent protocol behaviour. If the x402 SDK already provides something, use it.
- No `any`. No non-null assertions without an explanatory comment.
- No new runtime dependencies beyond @x402/core and (if needed) the same zod major that
  @x402/core already resolves — check first and add a test asserting a single zod version.
- Do not touch packages other than core, plus the docs listed.
- No placeholder implementations, no TODOs in shipped code.
- Do not weaken or bypass the narrow-waist lint rule.

BEFORE YOU FINISH
1. Run pnpm typecheck, pnpm lint, pnpm build, pnpm test --coverage. Report real numbers.
2. Show the coverage figure for packages/core.
3. Run `git diff --stat`, then summarise every meaningful change file by file.
4. State honestly anything you could not complete or any test that is weaker than specified.
5. If the current @x402/core API conflicts with anything in this prompt (for example if the
   facilitator method signatures differ from supported/verify/settle), STOP and explain the
   conflict. Do not silently redesign the architecture around it.
````

---
---

# Milestone 2 — Stellar Integration & First Paid Testnet Request

## 1. Objective

Get a real Stellar testnet payment through Movo end to end: unpaid `GET` → 402 with valid requirements → client signs a Soroban auth entry → facilitator verifies and settles → resource returned → transaction hash confirmable on Stellar. Ship `@movo/stellar` and `@movo/express`.

## 2. Why this milestone exists

This is the critical path and it comes third for a reason: every abstraction built after it is validated against a working money path, and every abstraction built before it was deliberately kept minimal. Rule 17 of the milestone generator — first end-to-end testnet payment as early as practical — is satisfied here. If the design is wrong, this milestone is where it fails loudly and cheaply.

## 3. Starting state

Milestones 0–1 complete. `@movo/core` can drive the lifecycle against a mock facilitator.

## 4. End state

`pnpm --filter @movo/example-weather dev` serves a paid route; `pnpm e2e:testnet` performs a real payment and prints a Stellar transaction hash; both are in the repo and reproducible by a new developer with a funded testnet key.

## 5. Scope

- `@movo/stellar`: network registry (`stellar:testnet`, `stellar:pubnet` — CAIP-2, no legacy string forms), scheme registration via `ExactStellarScheme`, SEP-41 asset validation, base-unit/decimal handling (7 decimals for Stellar USDC), address validation (`G...` accounts and `C...` contracts), RPC config.
- **Preflight diagnostics** — the differentiated bit: `payTo` account exists; `payTo` has a trustline to the configured asset; asset contract resolves; facilitator reachable and advertises this network; local clock skew. Each returns a structured finding, not a thrown error, so `movo doctor` can render them.
- `@movo/express`: `movoMiddleware(app)` mapping the lifecycle union to HTTP status + `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` headers via `@x402/express`.
- Node `http` adapter (no framework) for the `movo dev` server later.
- `apps/examples/weather` — the reference paid API.
- `tests/e2e/testnet.test.ts` — gated real payment.
- The **fee-override workaround** for testnet, with a documented reason (see §16).

## 6. Explicit non-scope

No Bazaar. No CLI. No `@movo/client` package yet (the e2e test may use `@x402/fetch` directly — the ergonomic client is Milestone 3). No mainnet. No Hono/Fastify/Next adapters. No facilitator implementation.

## 7. Files / packages

```
packages/stellar/src/
├── networks.ts        (CAIP-2 ids, passphrases, default RPC + Horizon)
├── assets.ts          (SEP-41 validation, decimals, USDC defaults per network)
├── addresses.ts       (G.../C... validation)
├── scheme.ts          (registers ExactStellarScheme on a Movo app)
├── preflight/{account,trustline,asset,facilitator,clock}.ts
└── index.ts
packages/express/src/{middleware,mapOutcome,index}.ts
packages/core/src/adapters/node-http.ts
apps/examples/weather/{src/server.ts,src/resources/weather.ts,movo.config.ts,README.md,.env.example}
tests/e2e/testnet.test.ts
docs/guides/stellar-setup.md
docs/guides/facilitator-setup.md
```

## 8. Implementation tasks

1. `networks.ts`: `stellar:testnet` and `stellar:pubnet` only. Map each to its network passphrase (via `@stellar/stellar-sdk`'s `Networks`, do not hard-code strings), a default Soroban RPC URL, and an `isTestnet` flag. Reject any other network id with a message listing the valid ones.
2. `assets.ts`: default USDC contract per network — **resolve it, do not hard-code a guess**; read from config with a documented default and verify at preflight that the contract exists. Decimals must be read from the token contract, not assumed. Provide `toBaseUnits(human, decimals)` / `fromBaseUnits` with a `bigint` implementation (no floats — a float rounding bug here is a money bug).
3. `addresses.ts`: strkey validation for `G` (ed25519 account) and `C` (contract). Use `StrKey` from the SDK; do not regex it beyond a fast pre-check.
4. `scheme.ts`: register `ExactStellarScheme` from `@x402/stellar/exact/server` onto the `x402ResourceServer` held by `@movo/core`, and export the client-side registration path for later. Confirm the exact import subpaths against the installed package before writing them.
5. Preflight checks, each returning `{ id, level: "ok"|"warn"|"error", title, detail, fix? }` where `fix` is a copy-pasteable command or URL. The trustline check is the highest-value one: an account with no USDC trustline cannot receive USDC, and this is the single most common failure in the official quickstart flow.
6. `@movo/express`: map the lifecycle union — `payment-required` → 402 + `PAYMENT-REQUIRED`; `rejected` → 402 + `PAYMENT-REQUIRED` + a machine-readable reason; `handler-error` → the handler's status (default 500), **no settle, no charge**; `settled` → 200 + body + `PAYMENT-RESPONSE`, passing through `EXTENSION-RESPONSES` from the facilitator untouched. Use `@x402/express` for header encoding rather than writing headers by hand.
7. Node `http` adapter with the same mapping, sharing `mapOutcome`.
8. Example app: one paid route, one free route, `movo.config.ts`, `.env.example` with `MOVO_PAY_TO` and `MOVO_FACILITATOR_URL` (default `https://www.x402.org/facilitator` — free, no API key, supports `stellar:testnet`).
9. E2E test, `MOVO_E2E=1` gated: start the example on an ephemeral port, request unpaid → assert 402 and valid requirements; build and sign a payment with a funded testnet key from env; retry; assert 200, correct body, and a `PAYMENT-RESPONSE` containing a transaction hash; then fetch that hash from Horizon/RPC and assert it is `SUCCESS`. **Confirming on-chain is the point** — asserting on the header alone would let a fake settlement pass.
10. Implement the testnet **fee override**: the official Stellar quickstart currently clones the payment transaction with `fee: "1"` to avoid a testnet facilitator limit. Put this behind `stellar.testnetFeeWorkaround: boolean` (default `true` on testnet, `false` on pubnet), implement it in one place, and document exactly why it exists and when to remove it. Do not scatter it through the client.
11. Docs: `stellar-setup.md` (keypair, friendbot funding, USDC trustline, Circle faucet) and `facilitator-setup.md` (x402.org free testnet vs OpenZeppelin `channels.openzeppelin.com/x402` with an API key — including that the key goes in env and is never logged).

## 9. Architecture decisions

- **Movo never constructs or signs Soroban auth entries itself.** `@x402/stellar` owns that. Movo owns configuration, validation, preflight, and diagnostics.
- Network ids are CAIP-2 strings, everywhere, with no Movo-specific aliases. Aliases would be a second source of truth.
- Preflight returns findings; only the CLI decides whether a finding is fatal.
- The example app is a workspace package and is built and tested in CI (compile-checked even when the e2e suite is skipped).

## 10. Dependencies

Milestones 0–1. External: `@x402/stellar`, `@stellar/stellar-sdk` (≥16, matching `@x402/stellar`'s peer expectation), `@x402/express`, `express` 5. A funded Stellar testnet account with a USDC trustline for the e2e suite.

## 11. Testing strategy

- Unit: network id validation (valid, invalid, legacy-string rejection); base-unit conversion including 7-decimal boundaries and amounts that would lose precision as floats; strkey validation; each preflight check against a stubbed RPC (account missing, trustline missing, asset unresolvable, facilitator not advertising the network, clock skew > 30s).
- Integration (no network): example app driven by `MockFacilitator` through the real Express middleware — assert exact status codes and header names for all four lifecycle branches.
- E2E (gated): the real testnet payment, with on-chain confirmation.
- Failure E2E (gated): wrong network in requirements → rejection with a reason; amount tampering → verification failure. These prove Movo is not accepting forged payments.

## 12. Documentation

`docs/guides/stellar-setup.md`, `docs/guides/facilitator-setup.md`, `docs/quickstart.md` (zero → paid testnet request), `apps/examples/weather/README.md`, ADR-0006 Stellar integration boundary.

## 13. Security considerations

- The server must never require or accept a payer secret key. The e2e test's key belongs to the **test client**, lives only in `.env`, and is testnet-only. Add a guard that refuses to run the e2e suite if the configured network is `stellar:pubnet`.
- Never log `PAYMENT-SIGNATURE`, the raw payload, or the facilitator API key. Assert this with a test that captures logger output during a full paid request.
- Amount and network validation must be strict; a mismatch is a rejection, never a coercion.

## 14. Acceptance criteria

1. An unpaid `GET /weather` against the example returns **HTTP 402** with a `PAYMENT-REQUIRED` header that `@x402/core`'s schema validates and that contains `network: "stellar:testnet"`, `scheme: "exact"`, the configured `payTo`, and a non-zero base-unit amount.
2. `MOVO_E2E=1 pnpm e2e:testnet` completes a real payment, prints a Stellar transaction hash, and the test independently confirms that hash on-chain with status `SUCCESS`.
3. Tampering with the amount in the payment payload produces a 402 with a non-null reason and the handler is not invoked.
4. Configuring `network: "stellar:mainnet"` (an invalid id) fails at startup with a message listing `stellar:testnet` and `stellar:pubnet`.
5. `preflight()` against an account with no USDC trustline returns an `error`-level finding whose `fix` contains an actionable instruction.
6. A handler that throws returns a 5xx and the facilitator's `settle` was not called (asserted with a spy in the mock-facilitator integration test).
7. Converting `"$0.001"` at 7 decimals yields exactly `"10000"` base units, computed with `bigint`.
8. A log-capture test proves no secret key, payment payload, or auth header appears in any log line during a full paid request.

## 15. Definition of done

- [ ] All eight acceptance criteria pass
- [ ] Transaction hash from a real testnet settlement recorded in `docs/CONFORMANCE.md`
- [ ] Example app builds in CI even when e2e is skipped
- [ ] Quickstart doc followed successfully from a clean machine
- [ ] Fee workaround implemented once, documented, and flagged for removal
- [ ] ADR-0006 written

## 16. Risks

| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| Testnet facilitator fee-limit issue blocks settlement | High | High | The documented `fee: "1"` clone workaround, isolated behind one flag, with a test that fails loudly if the workaround is ever needed on pubnet |
| `@x402/stellar` import subpaths differ from docs | Medium | Medium | Read the installed `.d.ts` files before writing imports; never trust doc snippets alone |
| Missing trustline burns a day of developer time | High | Medium | Preflight is in this milestone, not deferred to the CLI milestone |
| Auth-entry expiration (~12 ledgers / 60s) causes flaky e2e | Medium | Medium | Retry the whole sign-and-send once on an expiration-class rejection; never retry on a validation rejection |
| Movo drifts into reimplementing verification | Low | High | ADR-0006 states the boundary; code review rule: no XDR construction in `@movo/*` |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 2 of Movo — the critical path milestone. Its goal is a REAL
Stellar testnet payment flowing end to end through the framework.

FIRST, DO NOT WRITE CODE.
1. Inspect the repo: `ls -R packages apps 2>/dev/null`, read docs/adr/*, docs/COMPATIBILITY.md,
   and all of packages/core/src. Milestones 0 and 1 are complete. Preserve their architecture:
   in particular, the lifecycle in @movo/core returns a discriminated union, NOT an HTTP
   response, and only packages/core/src/protocol/** may import @x402/*.
2. Read the Movo context documents, especially 03_TECHNICAL_ARCHITECTURE.md and
   04_MVP_SCOPE_AND_ACCEPTANCE.md.
3. RESEARCH THE CURRENT APIs before writing a line:
   - https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide
   - https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar
   - https://docs.x402.org (facilitator + server concepts)
   - the installed packages: read the .d.ts files under node_modules/@x402/stellar and
     node_modules/@x402/express to confirm the EXACT export subpaths, e.g. whether the
     server scheme is at "@x402/stellar/exact/server" and the client scheme at
     "@x402/stellar/exact/client", and what paymentMiddleware / paymentMiddlewareFromConfig
     actually take. Documentation snippets and your training data may both be stale.
   The x402 repo is github.com/x402-foundation/x402. x402 protocol version is 2.
   Stellar networks are CAIP-2: "stellar:testnet" and "stellar:pubnet".

MILESTONE 2 GOAL
Ship @movo/stellar and @movo/express, an example paid API, and a gated end-to-end test that
performs a real testnet payment and confirms the transaction ON-CHAIN.

NO Bazaar. NO CLI. NO @movo/client package. NO mainnet. NO facilitator implementation.
NO Hono/Fastify/Next adapters.

BUILD THIS

packages/stellar:
- networks.ts: only "stellar:testnet" and "stellar:pubnet". Map each to its network
  passphrase using @stellar/stellar-sdk's Networks export (do not hard-code passphrase
  strings), a default Soroban RPC URL, and an isTestnet flag. Any other network id fails at
  startup with a message listing the two valid ids.
- assets.ts: SEP-41 asset handling. Stellar USDC has 7 DECIMALS, not 6 — 1 USDC is
  10,000,000 base units. Read decimals from the token contract rather than assuming, and
  implement toBaseUnits/fromBaseUnits with bigint. Never use floating point for money.
- addresses.ts: validate G... (ed25519 account) and C... (contract) strkeys using StrKey
  from the SDK.
- scheme.ts: register ExactStellarScheme onto the resource server held by @movo/core.
  Movo must NEVER construct or sign Soroban authorization entries itself — @x402/stellar
  owns that entirely. If you find yourself writing XDR, stop; you are in the wrong layer.
- preflight/: five checks, each returning { id, level: "ok"|"warn"|"error", title, detail,
  fix? } where fix is a copy-pasteable command or URL. Check that the payTo account exists;
  that it has a trustline to the configured asset; that the asset contract resolves; that
  the facilitator is reachable and advertises this network via /supported; and local clock
  skew. Preflight RETURNS findings, it does not throw — the CLI decides severity later.
  The trustline check is the highest-value item here: an account without a USDC trustline
  silently cannot receive USDC and this is the most common onboarding failure.

packages/express: movoMiddleware mapping the @movo/core lifecycle union to HTTP.
  payment-required -> 402 + PAYMENT-REQUIRED header
  rejected         -> 402 + PAYMENT-REQUIRED + a NON-NULL machine-readable reason
  handler-error    -> the handler's status (default 500), settle NOT called, no charge
  settled          -> 200 + body + PAYMENT-RESPONSE, passing through any EXTENSION-RESPONSES
                      header from the facilitator untouched
Use @x402/express for header encoding rather than writing the headers by hand.
Also add a plain Node http adapter in packages/core/src/adapters/node-http.ts sharing the
same mapOutcome function, since `movo dev` will need it in a later milestone.

apps/examples/weather: one paid route and one free route, movo.config.ts, README.md, and
.env.example with MOVO_PAY_TO and MOVO_FACILITATOR_URL. Default the facilitator to
https://www.x402.org/facilitator — it supports stellar:testnet with NO API key, which makes
the quickstart free and frictionless.

TESTNET FEE WORKAROUND
The official Stellar x402 quickstart currently clones the payment transaction with fee "1"
to avoid a testnet facilitator limit. Implement this ONCE, behind a config flag
stellar.testnetFeeWorkaround (default true on testnet, false on pubnet), with a comment
explaining what it works around and under what condition it should be deleted. Do not
scatter this logic. Add a test that fails if the workaround is ever applied on pubnet.

tests/e2e/testnet.test.ts — skipped unless MOVO_E2E=1:
1. start the example app on an ephemeral port
2. GET the paid route with no payment -> assert 402 and that the requirements validate
   against @x402/core's schema
3. build and sign a payment using a funded testnet secret key from STELLAR_PRIVATE_KEY
4. retry -> assert 200, correct body, and a PAYMENT-RESPONSE containing a transaction hash
5. INDEPENDENTLY fetch that transaction from Stellar and assert it succeeded on-chain
Step 5 is mandatory. Asserting only on the response header would let a fake settlement pass,
and faking settlement success is explicitly forbidden.
Add a guard that REFUSES to run the e2e suite if the configured network is stellar:pubnet.
Also add gated failure tests: a tampered amount must be rejected with a non-null reason and
must not invoke the handler.

Integration tests (no network): drive the example app through the real Express middleware
with @movo/core's MockFacilitator and assert exact status codes and header names for all
four lifecycle branches, including that settle is never called when the handler throws.

Add a log-capture test proving that no secret key, no payment payload, and no facilitator
auth header appears in any log line during a complete paid request.

DOCUMENTATION
docs/quickstart.md (zero to a successful paid testnet request), docs/guides/stellar-setup.md
(keypair generation, friendbot funding, USDC trustline creation, Circle faucet),
docs/guides/facilitator-setup.md (the free x402.org testnet facilitator vs OpenZeppelin's
channels.openzeppelin.com/x402 which needs an API key — and that the key lives in env and is
never logged), apps/examples/weather/README.md, and docs/adr/0006-stellar-integration-boundary.md
stating that Movo owns configuration, validation, preflight and diagnostics while
@x402/stellar owns auth entries, simulation and settlement.
Create docs/CONFORMANCE.md and record the transaction hash from your successful testnet run.

CONSTRAINTS
- Never fake a blockchain transaction or a settlement success, in code or in tests.
- Never invent protocol behaviour. If x402 or Stellar docs answer a question, follow them.
- No secrets in source. The server must never accept a payer private key.
- Do not modify @movo/core's lifecycle union unless it genuinely cannot express HTTP
  mapping — and if so, STOP and explain before changing it.
- Only touch packages/stellar, packages/express, the node-http adapter, apps/examples/weather,
  tests/e2e, and the listed docs.

BEFORE YOU FINISH
1. pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Run the e2e suite against testnet and PASTE THE REAL TRANSACTION HASH. If you do not have
   a funded testnet account, say so plainly, leave the test in place, and report that the
   e2e criterion is unverified. Do not fabricate a hash or mark it passing.
3. git diff --stat, then summarise every meaningful change.
4. Report honestly on anything that did not work, especially any place where the installed
   @x402/stellar API differed from the documentation.
````

---
---

# Milestone 3 — Client & Testing Toolkit

## 1. Objective

Ship `@movo/client` (ergonomic paid fetch with an injected signer, retry and budget policy) and `@movo/testing` (mock facilitator, **in-process facilitator**, scenario helpers, full failure matrix). Make the money path testable without leaving the process.

## 2. Why this milestone exists

Milestone 2 proved the path works once, manually, against a third-party service. A framework is only credible if a developer can test the money path deterministically in CI. The in-process facilitator is the piece that makes this real: `@x402/core` ships an `x402Facilitator` primitive that, registered with `ExactStellarScheme([signer])`, verifies and settles locally. That gives Movo hermetic integration tests, an offline-ish dev loop, and — not incidentally — the foundation for Milestone 6.

## 3. Starting state

Milestones 0–2 complete; a real testnet payment has succeeded.

## 4. End state

`pnpm test` exercises the complete payment lifecycle, including every failure mode, without depending on any third-party facilitator, and a developer can write `expectPaid(app, "/weather")` in their own project.

## 5. Scope

- `@movo/client`: `createPaidClient({ signer, network, rpc?, policy })` returning a `fetch`-compatible function; 402 detection; requirement selection when multiple `accepts` are offered; sign-and-retry; `PAYMENT-RESPONSE` and `EXTENSION-RESPONSES` decoding; typed `paidFetch<T>()`; a **budget policy** (`maxAmountPerRequest`, `maxTotalSpend`, `allowedNetworks`, `allowedPayTo`) that refuses to sign outside its bounds.
- Signer abstraction: bring-your-own; `createEd25519Signer` from `@x402/stellar` for dev, plus a `Signer` port so a wallet, KMS, or a remote signer can be substituted. **The framework never generates or stores keys.**
- `@movo/testing`: `MockFacilitator` re-export; `createInProcessFacilitator()` built on `@x402/core`'s facilitator primitive; `withPaidServer()` harness; scenario builders for the failure matrix; `assertNoSecretsLogged()`.
- Failure matrix as first-class helpers: wrong network, wrong asset, wrong amount, expired authorization, replayed payload, facilitator 5xx, facilitator timeout, malformed facilitator response, handler failure after verify.

## 6. Explicit non-scope

No Bazaar. No CLI. No mainnet. No key generation or storage. No wallet UI or paywall. Do not build a hosted facilitator service — Milestone 6.

## 7. Files / packages

```
packages/client/src/{createPaidClient,select,retry,policy,signer,decode,index}.ts
packages/testing/src/{mockFacilitator,inProcessFacilitator,harness,scenarios,matchers,index}.ts
tests/integration/payment-matrix.test.ts
docs/guides/client.md, docs/guides/testing.md
```

## 8. Implementation tasks

1. `Signer` port: `{ address: string; signAuthEntry(...); }` — mirror the SEP-43-shaped interface `@x402/stellar`'s `createEd25519Signer` already implements rather than inventing a parallel shape. Confirm against the installed types.
2. `createPaidClient`: 402 → decode `PAYMENT-REQUIRED` → select an acceptable requirement → policy check → sign via `@x402/stellar`'s client scheme → retry with `PAYMENT-SIGNATURE` → decode `PAYMENT-RESPONSE`.
3. Requirement selection: choose the cheapest offer that satisfies the policy; expose the selection as a result field so it is auditable; error with `MOVO_E_NO_ACCEPTABLE_OFFER` listing why each offer was rejected.
4. Budget policy enforced **before** signing. A policy violation must never produce a signature. Test that the signer spy has zero calls.
5. Retry: exactly one retry after a fresh 402 caused by an expiration-class rejection; zero retries on validation rejections; configurable ceiling; never retry a settled request.
6. `createInProcessFacilitator({ signer, network })`: construct `@x402/core`'s facilitator with `ExactStellarScheme([signer])`, expose it both as a `Facilitator` object and as a mountable HTTP handler (so tests can exercise the real HTTP path). Verify the exact constructor shape against the installed package before writing it.
7. `withPaidServer()`: spins the example-style app with a chosen facilitator, returns `{ url, client, close }`, and auto-closes.
8. Scenario builders that produce genuinely invalid payloads — mutate amount, network, asset, payTo, and expiration on a *validly signed* payload so the rejection comes from real verification, not from a malformed shape. A test that only sends garbage proves nothing.
9. Vitest matchers: `toBePaymentRequired()`, `toBeSettled()`, `toBeRejectedWithReason(code)`.
10. `assertNoSecretsLogged(logs)` exported for use in downstream projects.

## 9. Architecture decisions

- Movo never generates, stores, or derives a private key — in any package, including testing. Test keys come from env or are generated by the *test author* and passed in.
- The in-process facilitator is real verification and real settlement against testnet, not a simulation. Name it `InProcessFacilitator`, never `FakeFacilitator`, and document that it still touches the network when it settles.
- `MockFacilitator` (no network, programmable outcomes) and `InProcessFacilitator` (real, local orchestration) are different things and must not be conflated in docs.

## 10. Dependencies

Milestones 0–2. External: `@x402/fetch`, `@x402/stellar` client subpath, `@x402/core` facilitator primitive.

## 11. Testing strategy

- Unit (client): offer selection ordering; policy rejection before signing; decode of both response headers including a base64 `EXTENSION-RESPONSES`; retry rules.
- Integration (in-process facilitator, testnet settlement, gated): the full happy path plus the nine failure scenarios. Each must produce a specific, non-null reason code.
- Integration (mock facilitator, no network): the same nine scenarios at the orchestration level, ungated, so CI covers the matrix without a funded account.
- Negative: a test asserting the client refuses to sign when `allowedPayTo` does not match — this is the anti-phishing control for agents.

## 12. Documentation

`docs/guides/client.md` (signer injection, policy, budgets, agent usage), `docs/guides/testing.md` (which facilitator to use when, with a decision table), ADR-0007 testing strategy.

## 13. Security considerations

- Budget policy is the client's only defence against a malicious 402 response. Document the threat: a hostile server can name any `payTo` and any amount, and the client is the party that must refuse.
- Never log the signed payload or the signer address alongside the secret source.
- The in-process facilitator must refuse to start if the configured network is `stellar:pubnet` unless an explicit `allowMainnet: true` is passed — no test should ever be one env var away from spending real money.

## 14. Acceptance criteria

1. `createPaidClient` with a policy of `maxAmountPerRequest: "1000"` refuses an offer of `"10000"` with `MOVO_E_POLICY_AMOUNT_EXCEEDED` and the signer spy has **zero** calls.
2. With `allowedPayTo: ["G_A"]` and an offer paying `G_B`, the client refuses and does not sign.
3. All nine failure scenarios return distinct, non-null reason codes under the mock facilitator, with no network access.
4. Under the in-process facilitator (gated), a valid payment settles on testnet and the tampered-amount scenario is rejected by real verification.
5. A replayed payment payload is rejected on its second use.
6. `withPaidServer()` closes its server even when the test body throws.
7. `InProcessFacilitator` throws at construction when given `stellar:pubnet` without `allowMainnet: true`.
8. No package in the repo contains a code path that generates a keypair.

## 15. Definition of done

- [ ] Eight acceptance criteria pass
- [ ] Failure matrix runs in CI without a funded account (mock path)
- [ ] Gated matrix runs against testnet (in-process path)
- [ ] Client and testing guides written
- [ ] ADR-0007 written

## 16. Risks

| Risk | Mitigation |
|---|---|
| `x402Facilitator` constructor shape differs from the README snippet | Read installed `.d.ts` first; if it differs, report before adapting |
| Tests become mock-only and prove nothing | Both paths are mandatory; the gated in-process path is what the release gate checks |
| A developer points the in-process facilitator at pubnet | Hard construction-time guard |
| Replay test is flaky due to expiration windows | Assert on the rejection *reason class*, not on a specific message string |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 3 of Movo: the client SDK and the testing toolkit.

FIRST, DO NOT WRITE CODE.
1. Inspect the repo. Read docs/adr/*, packages/core/src (especially the Facilitator port and
   the lifecycle union), packages/stellar/src, and tests/e2e/testnet.test.ts. Milestones 0-2
   are complete and a real testnet payment has already succeeded — preserve that architecture.
2. Read docs/quickstart.md and docs/CONFORMANCE.md.
3. RESEARCH before designing:
   - read the installed types for @x402/core's facilitator primitive (look for something like
     x402Facilitator with a .register(network, scheme) shape), @x402/stellar's client scheme
     and createEd25519Signer, and @x402/fetch's client helpers
   - https://docs.x402.org core concepts on the facilitator and self-facilitation
   - the x402 repo's self-facilitation example under examples/typescript/servers
   Confirm exact constructor and method signatures from node_modules, not from memory.

MILESTONE 3 GOAL
Make the money path testable in CI without a third-party facilitator, and give buyers an
ergonomic, SAFE paid client.

NO Bazaar. NO CLI. NO mainnet. NO hosted facilitator service. NO key generation anywhere.

BUILD THIS

packages/client — createPaidClient({ signer, network, rpc?, policy }) returning a
fetch-compatible function that:
- detects 402 and decodes the PAYMENT-REQUIRED header
- selects among multiple `accepts` offers (cheapest that satisfies policy), and exposes which
  offer it selected and why the others were rejected
- ENFORCES A BUDGET POLICY BEFORE SIGNING: maxAmountPerRequest, maxTotalSpend,
  allowedNetworks, allowedPayTo. A policy violation must never produce a signature — test
  this with a signer spy asserting zero calls. This is the client's only defence against a
  hostile 402 response, which can name any payTo and any amount.
- signs via @x402/stellar's client scheme and retries with PAYMENT-SIGNATURE
- decodes PAYMENT-RESPONSE and the base64 EXTENSION-RESPONSES header
- retries at most once, only on an expiration-class rejection, never on a validation
  rejection, and never after a successful settlement

Signer port: bring-your-own. Mirror the interface that @x402/stellar's createEd25519Signer
already implements rather than inventing a parallel shape. MOVO MUST NEVER GENERATE, DERIVE,
OR STORE A PRIVATE KEY, in any package, including testing utilities.

packages/testing:
- re-export MockFacilitator (no network, programmable outcomes)
- createInProcessFacilitator({ signer, network, allowMainnet? }) built on @x402/core's
  facilitator primitive registered with @x402/stellar's ExactStellarScheme. Expose it both as
  a Facilitator object and as a mountable HTTP handler so tests can exercise the real HTTP
  path. It MUST throw at construction if network is stellar:pubnet without allowMainnet: true.
  Name it InProcessFacilitator, never FakeFacilitator: it performs REAL verification and REAL
  settlement, and the docs must say so.
- withPaidServer() harness returning { url, client, close }, closing reliably even when the
  test body throws
- scenario builders for the failure matrix: wrong network, wrong asset, wrong amount,
  expired authorization, replayed payload, facilitator 5xx, facilitator timeout, malformed
  facilitator response, handler failure after successful verify.
  IMPORTANT: build invalid scenarios by mutating a VALIDLY SIGNED payload, so the rejection
  comes from real verification. Sending structurally broken garbage proves nothing.
- Vitest matchers: toBePaymentRequired, toBeSettled, toBeRejectedWithReason
- assertNoSecretsLogged(logs)

TESTS
- Run the entire nine-scenario failure matrix twice: once against MockFacilitator with no
  network (runs in CI unconditionally) and once against InProcessFacilitator on testnet
  (gated behind MOVO_E2E=1). Each scenario must produce a distinct, NON-NULL reason code.
- Assert a replayed payload is rejected on its second use.
- Assert the client refuses to sign when allowedPayTo does not match.
- Assert no package in the repo contains a keypair-generation code path.

DOCUMENTATION
docs/guides/client.md — signer injection, budget policy, agent usage, and an explicit threat
model paragraph explaining that a hostile server can request any amount to any address and
the client is the party responsible for refusing.
docs/guides/testing.md — a decision table for MockFacilitator vs InProcessFacilitator vs a
hosted facilitator, and how to write payment tests in a downstream project.
docs/adr/0007-testing-strategy.md.

CONSTRAINTS
- Never fake settlement success. InProcessFacilitator settles for real.
- Never generate or store keys.
- No new dependencies beyond the @x402/* packages already pinned.
- Do not modify packages/core or packages/stellar unless strictly necessary; if you must,
  explain why before doing it.

BEFORE YOU FINISH
1. pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Run the gated matrix against testnet and report REAL results per scenario, including any
   that failed. Do not mark unverified scenarios as passing.
3. git diff --stat and a file-by-file summary.
4. If the installed @x402/core facilitator API does not match what this prompt assumes,
   STOP and explain rather than working around it silently.
````

---
---

# Milestone 4 — Bazaar Seller Surface

## 1. Objective

Ship `@movo/bazaar`: derive spec-conformant Bazaar discovery metadata from a Movo resource declaration, validate it against the extension's rules *before* it goes on the wire, surface cataloging outcomes from `EXTENSION-RESPONSES`, and provide a buyer-side catalog query helper.

## 2. Why this milestone exists

Discovery metadata is generated at 402 time and echoed by the client into the payment payload; a facilitator then validates and catalogs it. Getting it wrong is silent — settlement succeeds and the listing simply never appears. That failure mode is the single most-reported Bazaar problem in the x402 issue tracker. Movo's value here is turning a silent failure into a build-time and test-time error. This milestone must land before the catalog service (Milestone 7) so the catalog can be tested against correct seller output.

## 3. Starting state

Milestones 0–3 complete.

## 4. End state

A Movo resource with a `discovery` block automatically emits a conformant `bazaar` extension in its 402; `movo bazaar validate` (library form here, CLI form in Milestone 5) catches every documented conformance mistake; and a paid request surfaces the facilitator's cataloging verdict.

## 5. Scope

- `toDiscoveryExtension(resource)` → delegates to `declareDiscoveryExtension` from `@x402/extensions/bazaar` for HTTP resources and the MCP variant for MCP tools. **Do not hand-roll the wire shape.**
- Service metadata on the `resource` object: `serviceName` (≤32 printable ASCII), `tags` (≤5, each ≤32 printable ASCII), `iconUrl` (absolute http/https, ≤2048, no IP literals or loopback hosts — SSRF defence).
- Dynamic routes: path params → `pathParams` + `routeTemplate` in `:param` form; wildcards → `:var1`, `:var2`. `routeTemplate` is the facilitator's catalog key, so consolidation correctness matters.
- A validator implementing the documented soft-drop rules and the known rejection causes: missing `info.input.type` / `info.output.type`; relative `resource.url`; malformed `accepts` (asset as object, missing atomic-units amount); `$ref`/`$id` values that are not same-document JSON Pointer fragments starting with `#` (external refs are rejected to prevent SSRF/LFI).
- `EXTENSION-RESPONSES` decoding → `{ status: "success" | "processing" | "rejected", rejectedReason? }`, with the crucial semantic that **absence of the header carries no signal** and `processing` is not failure.
- Buyer-side: `listResources(filters)` / `search(query)` via `withBazaar` from `@x402/extensions`.

## 6. Explicit non-scope

No catalog service, no search index, no MCP server, no ranking — Milestone 7. No CLI wiring — Milestone 5. Do not invent Movo-specific discovery fields; do not create a `.well-known/x402.json` manifest (that is an obsolete pattern from early write-ups and is not the current extension).

## 7. Files / packages

```
packages/bazaar/src/
├── declare.ts        (resource -> extension, via @x402/extensions)
├── serviceMeta.ts    (serviceName/tags/iconUrl validation)
├── routeTemplate.ts  (path params, wildcards, percent-decode-then-check)
├── validate.ts       (conformance validator + diagnostics)
├── responses.ts      (EXTENSION-RESPONSES decoding)
├── query.ts          (listResources / search via withBazaar)
└── index.ts
docs/guides/bazaar.md, docs/concepts/discovery.md
```

## 8. Implementation tasks

1. Extend the `resource()` type so `discovery` is fully typed: `{ input, inputSchema, output?: { example?, schema? } }` for HTTP; `{ toolName, description?, transport?, inputSchema, example? }` for MCP. Infer `method` from the resource, do not ask for it twice.
2. `toDiscoveryExtension` calls `declareDiscoveryExtension` / `declareMcpDiscoveryExtension` from `@x402/extensions/bazaar`. Confirm the exact export names and argument shapes against the installed package.
3. `serviceMeta` validation: printable ASCII U+0020–U+007E only; enforce lengths; `iconUrl` must be absolute `http(s)`, must not be an IP literal, must not be a loopback host. Follow the extension's soft-drop semantics: an invalid field is dropped individually, the rest survives, and Movo **emits a warning** rather than failing the request — but `movo bazaar validate` treats the same finding as an error, so it is caught at build time instead of silently at runtime.
4. `routeTemplate`: derive from the resource path; percent-decode **before** traversal checks (a `%2e%2e%2f` that is only checked pre-decode is a bypass); reject templates containing `..` segments after decoding; convert `*` to `:varN`.
5. `validate(resource | extension)` returning findings with `{ level, code, path, detail, fix }`. Implement one check per documented rejection cause listed in §5, each with its own test and a fixture that triggers it.
6. `decodeExtensionResponses(headerValue)`: base64 → JSON → keyed by extension name; return `undefined` when the header is absent and document loudly that absence ≠ failure.
7. `query.ts`: thin wrappers over `withBazaar(facilitatorClient).extensions.bazaar.listResources(...)` and `.search(...)`, normalising the fact that pagination is facilitator-defined (`pagination` may be absent).
8. Wire the extension into the 402 path in `@movo/core` — one line, guarded by whether the resource declares `discovery`.

## 9. Architecture decisions

- Movo generates discovery metadata **from the resource declaration**, never from a separate hand-maintained file. One source of truth is the whole point.
- Validation runs at three points: type level (compile), `movo bazaar validate` (build/CI), and a dev-mode runtime warning. Never a silent drop.
- Movo does not define a competing discovery format, does not publish a manifest file, and does not add fields the extension has not specified.

## 10. Dependencies

Milestones 0–3. External: `@x402/extensions`, `ajv` (already transitive via `@x402/extensions`; reuse rather than adding a second JSON Schema validator).

## 11. Testing strategy

- Unit: one test per rejection cause; ASCII/length boundary tests for `serviceName` and `tags`; `iconUrl` SSRF cases (IP literal, `localhost`, `127.0.0.1`, `[::1]`, relative URL); `$ref` cases (`#/definitions/x` accepted, `https://…`, `file://`, `./rel.json` rejected).
- `routeTemplate`: `/users/123` and `/users/456` both produce `/users/:userId`; `%2e%2e%2f` is rejected after decoding; wildcards map to `:var1`.
- Integration: a Movo app with a `discovery` block produces a 402 whose extension round-trips through `@x402/extensions`' own validation.
- Integration: `EXTENSION-RESPONSES` with each of `success`, `processing`, `rejected`, and absent → correct interpretation; a test explicitly asserts absence is not treated as failure.

## 12. Documentation

`docs/concepts/discovery.md` (what Bazaar is, who catalogs, why declaration alone catalogs nothing), `docs/guides/bazaar.md` (declaring, validating, troubleshooting invisibility, querying catalogs), ADR-0008 Bazaar integration.

## 13. Security considerations

- `iconUrl` SSRF defence is a real control, not a formality — the facilitator will fetch it.
- `routeTemplate` traversal: decode then check, never check then decode.
- Schema `$ref` restriction to same-document fragments prevents SSRF/LFI (CWE-918) — implement it, do not assume the SDK does.
- Discovery metadata is public. Add a docs warning and a validator check that flags internal hostnames in `resource.url`.

## 14. Acceptance criteria

1. A resource with a `discovery` block produces a 402 whose `extensions.bazaar` passes `@x402/extensions`' own validation.
2. `serviceName` of 33 characters produces a validation error naming the 32-character limit.
3. `iconUrl: "http://127.0.0.1/i.png"` is rejected with an SSRF-specific code.
4. `inputSchema` containing `"$ref": "https://example.com/s.json"` is rejected; `"#/definitions/city"` is accepted.
5. `/users/123` and `/users/456` both yield `routeTemplate: "/users/:userId"`.
6. A path segment `%2e%2e%2f` is rejected after percent-decoding.
7. An absent `EXTENSION-RESPONSES` header yields `undefined` and no error; `processing` is not classified as a failure.
8. `listResources({ type: "http" })` against a configured facilitator returns typed items (gated test).

## 15. Definition of done

- [ ] Eight acceptance criteria pass
- [ ] Every documented rejection cause has a test and a fixture
- [ ] No hand-rolled wire shapes anywhere in `@movo/bazaar`
- [ ] Discovery + Bazaar docs written
- [ ] ADR-0008 written

## 16. Risks

| Risk | Mitigation |
|---|---|
| Bazaar conventions change under the x402 Foundation | Validator is data-driven; a `docs/COMPATIBILITY.md` row tracks the extension version; conformance suite re-run on every `@x402/extensions` bump |
| A facilitator never emits `EXTENSION-RESPONSES` (known to happen) | Treat absence as no signal, exactly as the spec says; do not build logic that depends on the header |
| Seller declares metadata but no client echoes it → no catalog entry | Documented prominently in troubleshooting; `movo bazaar validate` explains the echo requirement |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 4 of Movo: the Bazaar seller surface.

FIRST, DO NOT WRITE CODE.
1. Inspect the repo and read docs/adr/*, packages/core/src/resource, packages/core/src/protocol,
   and packages/client/src. Milestones 0-3 are complete; preserve their architecture.
2. RESEARCH the CURRENT Bazaar extension before writing anything:
   - https://docs.x402.org/extensions/bazaar — read it in full, including the
     "Troubleshooting catalog visibility" and validation-rules sections
   - the spec at github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md
   - the reference server at examples/typescript/servers/bazaar in that repo
   - the installed node_modules/@x402/extensions types, to confirm the exact names and
     signatures of declareDiscoveryExtension, the MCP variant, and withBazaar
   Do NOT hand-roll any Bazaar wire shape. The docs explicitly advise using the official SDK
   to declare, echo and validate bazaar data instead of hand-rolling.

MILESTONE 4 GOAL
Derive conformant Bazaar metadata from a Movo resource declaration, validate it before it
reaches the wire, and interpret the facilitator's cataloging verdict.

NO catalog service. NO search index. NO ranking. NO MCP server. NO CLI wiring.
Do NOT invent Movo-specific discovery fields. Do NOT create a .well-known/x402.json manifest
— that is an obsolete pattern, not the current extension.

BUILD packages/bazaar:

declare.ts — toDiscoveryExtension(resource) delegating to @x402/extensions/bazaar's
declareDiscoveryExtension (HTTP) or the MCP variant. Type the resource's `discovery` block:
HTTP is { input, inputSchema, output?: { example?, schema? } }; MCP is
{ toolName, description?, transport?, inputSchema, example? }. Infer the method from the
resource — never ask the developer for it twice.

serviceMeta.ts — validate serviceName (<=32 printable ASCII, U+0020 to U+007E), tags (max 5,
each <=32 printable ASCII), iconUrl (absolute http/https, <=2048 chars, NO IP literals, NO
loopback hostnames — this is an SSRF defence because the facilitator will fetch it).
Follow the extension's soft-drop semantics at runtime (drop the invalid field, keep the rest,
warn) but treat the same finding as an ERROR in the validator, so it is caught at build time.

routeTemplate.ts — derive routeTemplate from the resource path: path params become :param,
wildcards become :var1/:var2. This is the facilitator's catalog key, so /users/123 and
/users/456 must both produce /users/:userId. CRITICAL: percent-decode BEFORE running traversal
checks. Checking before decoding is a bypass — %2e%2e%2f must be rejected.

validate.ts — one check per documented rejection cause, each with its own test and fixture:
missing info.input.type; missing info.output.type when output is present; a relative
resource.url; malformed accepts entries (asset as an object instead of a string, or a missing
atomic-units amount); and $ref or $id values that are not same-document JSON Pointer fragments
starting with "#" — external references such as https://, file://, or relative URIs must be
rejected to prevent SSRF/LFI. Return findings as { level, code, path, detail, fix }.

responses.ts — decodeExtensionResponses(headerValue): base64 -> JSON keyed by extension name;
the bazaar key gives { status: "success" | "processing" | "rejected", rejectedReason? }.
TWO SEMANTICS THAT MUST BE RIGHT AND MUST BE TESTED: an ABSENT header carries NO signal and
must not be treated as failure (some facilitators never emit it), and "processing" means
accepted-and-indexing-later, not failure.

query.ts — thin wrappers over withBazaar(facilitatorClient).extensions.bazaar.listResources()
and .search(), normalising the fact that pagination is facilitator-defined and may be absent.

Then wire the extension into the 402 path in @movo/core — one guarded line, active only when
the resource declares a `discovery` block.

TESTS
Every rejection cause above; ASCII and length boundaries; iconUrl SSRF cases (IP literal,
localhost, 127.0.0.1, [::1], relative); $ref accepted vs rejected cases; routeTemplate
consolidation and the percent-decoding bypass; all four EXTENSION-RESPONSES states including
absent; and an integration test asserting the generated extension round-trips through
@x402/extensions' own validation.

DOCUMENTATION
docs/concepts/discovery.md must explain plainly that cataloging happens at the FACILITATOR at
settle time, that a server-side declaration alone catalogs nothing if no paying client echoes
it, and that catalog inclusion is the facilitator operator's implementation detail.
docs/guides/bazaar.md covers declaring, validating, troubleshooting invisibility, and querying.
docs/adr/0008-bazaar-integration.md.
Also warn that discovery metadata is PUBLIC and add a validator check flagging internal
hostnames in resource.url.

CONSTRAINTS
- Do not invent protocol behaviour or fields.
- Reuse the ajv already resolved via @x402/extensions rather than adding a second JSON Schema
  validator.
- Only touch packages/bazaar, the one wiring line in packages/core, and the listed docs.

BEFORE YOU FINISH
1. pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Show a real 402 response body/header produced by the example app with discovery enabled.
3. git diff --stat and a file-by-file summary.
4. If the current Bazaar extension differs from anything above, STOP and explain — the
   discovery conventions are explicitly still moving and correctness beats assumption.
````

---
---

# Milestone 5 — CLI, Scaffolding & Developer Experience

## 1. Objective

Ship `create-movo-app` and `@movo/cli` (`movo dev`, `movo doctor`, `movo test`, `movo bazaar validate`). Make the path from empty directory to a paid testnet request take minutes, not an afternoon.

## 2. Why this milestone exists

Everything the framework claims to be — "feels like a modern web framework" — is delivered or lost here. It comes after Milestones 1–4 because a scaffold can only be as good as the API it scaffolds, and `movo doctor` can only be useful once the preflight checks and validators it reports on exist. It is the gate for `v0.1.0-alpha`.

## 3. Starting state

Milestones 0–4 complete.

## 4. End state

`npm create movo-app my-api && cd my-api && npm install && npm run dev`, then `movo doctor` explains exactly what is missing, and following its instructions leads to a successful paid request.

## 5. Scope

- `create-movo-app`: interactive and flag-driven; templates `minimal` (Express + one paid route) and `discoverable` (adds Bazaar metadata + a client script). Generates `.env.example`, `movo.config.ts`, a test file, and a README with the exact next commands.
- `movo dev`: runs the app with hot reload (Node's built-in watch, not a new dependency), prints the resolved config **with each value's source**, prints the 402 requirements for every registered resource at boot, and can run against `--facilitator=in-process` for a hermetic loop.
- `movo doctor`: runs every preflight check plus config, env, Node version, `@x402/*` pin drift vs `docs/COMPATIBILITY.md`, facilitator reachability, `/supported` network match, `payTo` existence, trustline, asset resolution, clock skew, and Bazaar metadata validity. Output is a findings table with `fix` hints; exit code non-zero on any `error` finding; `--json` for CI.
- `movo test`: thin Vitest wrapper preconfigured with `@movo/testing` matchers and the failure matrix.
- `movo bazaar validate` and `movo bazaar list --facilitator=…`.
- Error rendering: every `MovoError` gets a CLI presenter with code, cause, and a docs link.

## 6. Explicit non-scope

No `movo build` (the app is TypeScript; `tsc` is fine — do not add a bundler without a demonstrated need). No `movo deploy`. No telemetry of any kind. No plugin system. No paywall UI. No project-type auto-detection beyond the two templates.

## 7. Files / packages

```
packages/cli/src/{index,commands/{dev,doctor,test,bazaar},render/{findings,errors},config/load}.ts
packages/create-movo-app/src/{index,prompts,templates}.ts
packages/create-movo-app/templates/{minimal,discoverable}/…
docs/guides/cli.md, docs/quickstart.md (rewritten around the CLI)
```

## 8. Implementation tasks

1. `create-movo-app`: no interactive prompt when all flags are supplied (CI-friendly); write files, then print the exact next three commands. Templates are real, working projects — they must be part of the workspace test matrix so they can never rot.
2. Template contents: `movo.config.ts`, `src/resources/weather.ts`, `src/server.ts`, `src/weather.test.ts` (using `@movo/testing`), `.env.example`, `README.md`, `package.json` with `dev`/`test`/`doctor` scripts.
3. `movo dev`: load config, print a resolved-config table with `source` per row, register resources, print each route's price/network/payTo, start the adapter, watch with `node --watch`. `--facilitator in-process` wires `@movo/testing`'s in-process facilitator (requires a signer from env, refuses pubnet).
4. `movo doctor`: compose the checks; group by category; render `ok`/`warn`/`error` with the `fix` field; `--json`; non-zero exit on error. Include a pin-drift check comparing installed `@x402/*` versions against `docs/COMPATIBILITY.md` and warn on mismatch.
5. `movo test`: spawn Vitest with the Movo setup file. Do not reimplement a test runner.
6. Error presenter: `MOVO_E_*` → a short title, the safe context, the cause chain, and a `https://movo.dev/errors/<code>` link. Redaction applies.
7. Colour and symbols degrade gracefully in non-TTY and honour `NO_COLOR`.

## 9. Architecture decisions

- The CLI is a thin composition layer over library functions. Every check `movo doctor` runs must be callable programmatically from `@movo/stellar` or `@movo/bazaar` — no logic lives only in the CLI.
- No telemetry, ever. State it in the README; it is a trust feature for a payments framework.
- Templates are workspace members and are compiled and tested in CI.

## 10. Dependencies

Milestones 0–4. External: a small arg parser (prefer Node's `util.parseArgs` — zero dependency), `prompts` or equivalent only if interactive mode genuinely needs it.

## 11. Testing strategy

- Unit: doctor finding rendering (all three levels, `--json` shape); arg parsing; error presenter redaction.
- Integration: scaffold into a temp dir, `pnpm install --offline` against the workspace, `tsc --noEmit`, run the generated test file. This is the "fresh clone works" guarantee, automated.
- Integration: `movo doctor` against a deliberately broken config (bad network, unfunded `payTo`, unreachable facilitator) produces the expected error codes and a non-zero exit.
- Snapshot: `movo dev` boot output, so accidental verbosity regressions are visible.

## 12. Documentation

`docs/guides/cli.md`, rewritten `docs/quickstart.md` starting from `npm create movo-app`, `docs/reference/errors.md` updated with docs links, ADR-0009 CLI scope (why no `build`/`deploy`).

## 13. Security considerations

- `movo doctor` prints configuration — it must run every value through `redact()`. A facilitator API key must render as `configured (hidden)`, never as a prefix.
- Templates must never contain a key, and `.env` must be gitignored in the generated project.
- `--facilitator in-process` must refuse `stellar:pubnet`.

## 14. Acceptance criteria

1. `npm create movo-app tmp-api -- --template minimal --yes` produces a project that installs, typechecks, and whose generated test passes — all asserted by an automated test.
2. `movo doctor` in a project with an unfunded `payTo` exits non-zero and prints a finding whose `fix` names friendbot or the Circle faucet.
3. `movo doctor --json` emits schema-valid JSON with one object per finding.
4. `movo doctor` with a facilitator API key configured prints `configured (hidden)` and the key appears in zero bytes of output.
5. `movo dev` prints, for each resource, its method, path, price, network, and `payTo`, plus the source of each resolved config value.
6. `movo dev --facilitator in-process --network stellar:pubnet` refuses to start.
7. `movo bazaar validate` fails with a specific code on a resource whose `iconUrl` is a loopback address.
8. Running the quickstart end to end on a clean machine reaches a successful paid testnet request.

## 15. Definition of done

- [ ] Eight acceptance criteria pass
- [ ] Templates are workspace members, compiled and tested in CI
- [ ] Zero telemetry; stated in README
- [ ] CLI guide + rewritten quickstart
- [ ] ADR-0009 written
- [ ] **Tag `v0.1.0-alpha`**

## 16. Risks

| Risk | Mitigation |
|---|---|
| Templates rot | Templates are workspace packages in the CI matrix |
| Doctor becomes the only place logic lives | Architectural rule: every check is a library export; enforce in review |
| Scaffold ergonomics diverge from the framework API | The `minimal` template is generated from the same example used in the docs |
| Dependency creep in the CLI | Prefer `util.parseArgs` and `node --watch`; each dependency needs written justification |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 5 of Movo: the CLI, the scaffolder, and the developer
experience layer. This milestone is the gate for the v0.1.0-alpha tag.

FIRST, DO NOT WRITE CODE.
1. Inspect the repo thoroughly. Read docs/adr/*, docs/quickstart.md, packages/core/src/config
   (the resolver returns { value, source } pairs — the CLI depends on that),
   packages/stellar/src/preflight (all five checks), packages/bazaar/src/validate.ts, and
   packages/testing/src. Milestones 0-4 are complete; preserve their architecture.
2. Read 02_PRODUCT_REQUIREMENTS.md section 2 (primary user journey) and
   04_MVP_SCOPE_AND_ACCEPTANCE.md section 8 (CLI minimum).

MILESTONE 5 GOAL
npm create movo-app -> npm install -> npm run dev -> movo doctor -> a paid testnet request,
with every failure along the way explained by an actionable message.

DO NOT BUILD: movo build, movo deploy, telemetry of any kind, a plugin system, a paywall UI,
or a bundler. The MVP scope explicitly says to ship build/deploy only if there is a real
implementation need, and there is not: the app is TypeScript and tsc is sufficient.

BUILD packages/create-movo-app:
Two templates, `minimal` (Express + one paid route) and `discoverable` (adds Bazaar discovery
metadata and a buyer client script). Each template is a REAL, WORKING project containing
movo.config.ts, src/resources/weather.ts, src/server.ts, a test file using @movo/testing,
.env.example, README.md with the exact next commands, and a package.json with dev/test/doctor
scripts. Make the templates workspace members so CI compiles and tests them — templates that
are not in the CI matrix rot within weeks.
Support fully non-interactive use (--template, --yes) for CI.

BUILD packages/cli with four commands:

movo dev — load config; print a resolved-configuration table showing each value AND ITS
SOURCE (default | config | env | override); print every registered resource with its method,
path, price, network and payTo; start the server; watch with Node's built-in --watch (do not
add a watcher dependency). Support --facilitator in-process, which wires @movo/testing's
InProcessFacilitator and MUST refuse to start on stellar:pubnet.

movo doctor — the flagship command. Run every existing check: Node version; @x402/* installed
versions vs docs/COMPATIBILITY.md (warn on drift); config validity; env/network consistency;
facilitator reachability and whether /supported advertises the configured network; payTo
account existence; trustline to the configured asset; asset contract resolution; clock skew;
and Bazaar metadata validity for every resource. Render a grouped findings table with ok/warn/
error levels and the `fix` hint for each. Support --json for CI. Exit non-zero if any finding
is level error.
ARCHITECTURAL RULE: movo doctor must COMPOSE library functions. Every check it runs must
already be callable programmatically from @movo/stellar or @movo/bazaar. No check logic may
live only in the CLI.

movo test — a thin wrapper spawning Vitest with the @movo/testing setup file preloaded.
Do not reimplement a test runner.

movo bazaar validate | list — validate the project's discovery metadata; list a facilitator's
catalog via @movo/bazaar's query helpers.

Error rendering: every MovoError renders as code + short title + safe context + cause chain +
a docs link of the form https://movo.dev/errors/<CODE>. Everything passes through redact().
Honour NO_COLOR and degrade gracefully outside a TTY.

SECURITY
movo doctor prints configuration, so run EVERY value through redact(). A facilitator API key
must render as "configured (hidden)" — never a prefix, never a suffix, never a length.
Templates must contain no keys and must gitignore .env in the generated project.

TESTS
- Automated scaffold test: create a project into a temp directory, install against the
  workspace, run tsc --noEmit, and run the generated test file. This is the automated version
  of "a fresh clone works" and it is the most valuable test in this milestone.
- movo doctor against a deliberately broken config (invalid network, unfunded payTo,
  unreachable facilitator) produces the expected codes and a non-zero exit.
- movo doctor --json emits schema-valid JSON.
- A test asserting a configured API key appears in zero bytes of doctor output.
- Snapshot the movo dev boot output so verbosity regressions are visible in review.

DOCUMENTATION
docs/guides/cli.md; rewrite docs/quickstart.md to start from `npm create movo-app` and end at
a confirmed paid testnet request; update docs/reference/errors.md with docs links; write
docs/adr/0009-cli-scope.md explaining why build and deploy are deliberately absent.
State in the README that Movo collects no telemetry.

CONSTRAINTS
- Prefer Node's util.parseArgs and node --watch over new dependencies. Justify in writing any
  dependency you do add.
- Do not put business logic in the CLI.
- Do not modify earlier packages except to EXPORT existing internal functions the CLI needs;
  if you need to change behaviour, explain why first.

BEFORE YOU FINISH
1. pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Actually scaffold a project in a temp dir, run movo doctor against it, and PASTE THE REAL
   OUTPUT of both the broken-config and healthy-config runs.
3. git diff --stat and a file-by-file summary.
4. Report honestly on any acceptance criterion you could not verify.
````

---
---

# Milestone 6 — Facilitator (self-hosted + in-process)

> **SCF-gated.** Build this if Movo is being submitted against the SCF x402-Facilitator-with-Bazaar RFP, or if you want Movo to own discovery. If neither applies, skip to Milestone 8 and keep only the in-process facilitator from Milestone 3.

## 1. Objective

Ship `@movo/facilitator`: a standards-conformant, Apache-2.0, self-hostable Stellar x402 facilitator exposing `/verify`, `/settle`, `/supported`, built entirely on `@x402/core`'s facilitator primitive and `@x402/stellar`'s `exact` scheme — plus `apps/facilitator-service`, a deployable instance.

## 2. Why this milestone exists

Two reasons, and the second is the real one. First, the RFP requires a facilitator on testnet and pubnet under a permissive licence with no AGPL in the dependency path — which rules out the existing OpenZeppelin-Relayer-based one as a codebase. Second, and decisively: **cataloging happens at the facilitator**. Milestone 7 is unbuildable without this. It comes after Milestones 1–5 because the framework must exist before the service that serves it, and because Milestone 3's in-process facilitator has already de-risked the core wiring.

## 3. Starting state

Milestones 0–5 complete; `v0.1.0-alpha` tagged; `InProcessFacilitator` working against testnet.

## 4. End state

An unmodified stock x402 client completes a payment against a locally-run `apps/facilitator-service` on `stellar:testnet`; `/supported` advertises the correct Stellar `extra` including `areFeesSponsored`; the same service runs against `stellar:pubnet` behind explicit configuration.

## 5. Scope

- `@movo/facilitator`: transport-agnostic handlers for `verify`, `settle`, `supported`, constructed from `@x402/core`'s facilitator + `ExactStellarScheme([signer])`. **Zero verification logic of Movo's own.**
- Signer/relayer management: one or more sponsoring accounts; **channel accounts** to avoid sequence-number contention under bursty agent traffic; health and balance monitoring; graceful degradation when a sponsor is low on XLM.
- Fee sponsorship, correctly advertised via `extra.areFeesSponsored` on `/supported`.
- Non-custodial invariant: the facilitator is never the source of funds and never appears as transaction source, operation source, transfer-from address, or in authorization entries. Assert this in tests.
- Caller authentication (API key), metering, and rate limiting — all configurable, all optional, free and keyless on testnet.
- `apps/facilitator-service`: Hono HTTP service, structured logging, `/health`, `/metrics`, Docker image, runbook.
- Conformance harness: run the x402 repo's e2e suite against the service for both networks.

## 6. Explicit non-scope

No discovery endpoints (Milestone 7). No `upto` scheme. No `batch-settlement`. No `auth-capture`. No on-chain registry. No custody. No Movo-hosted production deployment in this milestone — deployability, not deployment. **No AGPL dependency, directly or transitively** — the licence gate from Milestone 0 enforces it.

## 7. Files / packages

```
packages/facilitator/src/{handlers/{verify,settle,supported},signers/{pool,channelAccounts,health},config,errors,index}.ts
apps/facilitator-service/src/{server,routes,auth,ratelimit,metrics,logging}.ts
apps/facilitator-service/{Dockerfile,README.md,docs/RUNBOOK.md}
tests/conformance/facilitator/*.test.ts
docs/guides/self-hosting-facilitator.md
```

## 8. Implementation tasks

1. Build the facilitator instance from `@x402/core` registered with `@x402/stellar`'s server-side `exact` scheme — verify the exact constructor and registration signature from the installed types before writing.
2. Handlers accept and return **exactly** the spec's request/response shapes. Do not add Movo fields to protocol responses. Every rejection must carry a non-null, machine-readable `reason` — this is both an RFP acceptance criterion and correct behaviour for agent callers.
3. `/supported`: enumerate configured networks and schemes, emit the Stellar `extra` contract including `areFeesSponsored: true`. A stock client reads this; getting the shape wrong makes the service unusable regardless of settlement correctness.
4. Signer pool: N sponsoring accounts, round-robin with in-flight tracking; channel accounts for sequence isolation; a health check that fails the readiness probe when sponsors fall below a configured XLM floor.
5. Non-custody assertions as *tests*, not comments: for a settled payment, assert the facilitator address does not appear as transaction source, operation source, transfer `from`, or in any auth entry.
6. Auth: optional bearer key with per-key metering; testnet defaults to open and unauthenticated. Rate limiting per key and per IP, configurable, documented.
7. Fees: mainnet fee configuration must be a config value, never hard-coded, so a self-hoster can change or remove it.
8. Observability: structured JSON logs with correlation IDs, never containing payloads or keys; Prometheus-style counters for verify/settle outcomes and latency histograms; `/health` and `/ready`.
9. Conformance: script that runs the x402 repo's `e2e` suite against the local service for `stellar:testnet` and `stellar:pubnet`, and a script that drives an **unmodified** stock `@x402/fetch` client through a full payment. Record hashes in `docs/CONFORMANCE.md`.
10. Runbook: deployment, key rotation, sponsor top-up, incident response, degraded-mode behaviour.

## 9. Architecture decisions

- Movo owns the service, never the cryptography. If a PR to `@movo/facilitator` contains XDR construction or signature verification, it is in the wrong repo — it belongs upstream in `@x402/stellar`.
- The facilitator implements the same `Facilitator` port as the hosted and mock ones, so a Movo app can point at it with a one-line config change.
- Apache-2.0 throughout; the licence gate is a hard CI failure.

## 10. Dependencies

Milestones 0–5. External: `@x402/core`, `@x402/stellar`, `@stellar/stellar-sdk`, Hono. A funded testnet sponsor account; a funded pubnet sponsor for the mainnet criterion.

## 11. Testing strategy

- Unit: handler request/response shape validation; `/supported` shape; error mapping with non-null reasons; signer pool selection and exhaustion; sponsor-floor health failure.
- Integration (testnet): full verify+settle via HTTP; tampered amount, wrong network, wrong asset, expired auth entry, replayed payload — each rejected with a distinct reason.
- Non-custody: the assertions in task 5.
- Load: a burst of concurrent settlements proving channel accounts prevent sequence collisions.
- Conformance: the stock-client run and the x402 e2e suite, both networks.
- Security: rate limiter under burst; auth bypass attempts; oversized payload rejection.

## 12. Documentation

`docs/guides/self-hosting-facilitator.md`, `apps/facilitator-service/README.md`, `docs/RUNBOOK.md`, `docs/CONFORMANCE.md` updated with hashes per network, ADR-0010 facilitator architecture (including why the OpenZeppelin plugin is not a dependency).

## 13. Security considerations

- The sponsor key is the crown jewel. Support KMS/HSM/external signer injection; never require the raw seed in an env var for production; never log it; document rotation.
- Replay and front-running: rely on the scheme's protections and **test** them rather than assuming them.
- Rate limiting is a spend-protection control, not just an abuse control — an unmetered facilitator sponsoring fees is a drain vector.
- Input size caps and strict JSON parsing on every endpoint.

## 14. Acceptance criteria

1. An **unmodified** stock `@x402/fetch` client completes a full payment against the local service on `stellar:testnet`, with an on-chain-confirmed transaction hash.
2. The same on `stellar:pubnet` with a real (small) settled transaction hash.
3. `GET /supported` returns the Stellar entry including `extra.areFeesSponsored`.
4. The x402 repo's e2e suite passes against the service for both networks; results recorded in `docs/CONFORMANCE.md`.
5. Every rejection response has a non-null `reason`; a test enumerates all rejection paths and asserts this.
6. Non-custody test passes: the facilitator address appears in none of the four forbidden positions.
7. `pnpm check:licenses` passes — zero AGPL/SSPL/GPL in the tree.
8. 200 concurrent settlement requests produce zero sequence-number failures.
9. Health endpoint reports not-ready when a sponsor drops below the configured XLM floor.

## 15. Definition of done

- [ ] Nine acceptance criteria pass
- [ ] Conformance results and hashes recorded for both networks
- [ ] Runbook written and reviewed
- [ ] Docker image builds and runs from the README alone
- [ ] ADR-0010 written

## 16. Risks

| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| Sequence-number contention under agent bursts | High | High | Channel accounts, designed in from the start, load-tested |
| Sponsor account drained by abuse | Medium | High | Rate limiting + metering + balance floor + alerting from day one |
| Wire-format drift makes the service non-conformant | Medium | High | Conformance run in CI against a pinned x402 version, plus stock-client test |
| Accidentally reimplementing verification | Medium | High | ADR-0010 + a review rule + the narrow-waist lint |
| Mainnet key handling mistakes | Low | Critical | External signer support, no raw seeds in prod config, documented rotation, third-party review in Milestone 8 |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 6 of Movo: a standards-conformant, Apache-2.0, self-hostable
Stellar x402 facilitator.

FIRST, DO NOT WRITE CODE.
1. Inspect the repo. Read docs/adr/*, packages/core/src/facilitator (the Facilitator port),
   packages/testing/src/inProcessFacilitator.ts (this milestone productionises that idea),
   and packages/stellar/src. Milestones 0-5 are complete; preserve their architecture.
2. RESEARCH before designing:
   - https://docs.x402.org/core-concepts/facilitator
   - the exact scheme spec for Stellar:
     github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md
   - the x402 repo's e2e suite (e2e/) and its self-facilitation example
     (examples/typescript/servers/self-facilitation)
   - the installed node_modules/@x402/core and @x402/stellar types for the facilitator
     constructor and the server-side scheme registration signature
   - the reference /supported response from https://www.x402.org/facilitator/supported

CRITICAL LICENCE CONSTRAINT
Movo ships under Apache-2.0 and must have NO strong copyleft anywhere in its dependency path,
because it will be operated as a network service. The OpenZeppelin Relayer, its x402
facilitator plugin, and the OpenZeppelin relayer SDK are AGPL-3.0-or-later and MUST NOT be
used as a dependency, a base, or a vendored source. You may read the public Stellar docs about
that facilitator's behaviour, but do not copy its code. pnpm check:licenses must stay green.

MILESTONE 6 GOAL
A facilitator that a stock, unmodified x402 client can pay through, on stellar:testnet and
stellar:pubnet.

DO NOT BUILD: discovery endpoints (next milestone), the upto scheme, batch-settlement,
auth-capture, any on-chain registry, or any custody feature.

BUILD packages/facilitator:
Transport-agnostic handlers for verify, settle and supported, constructed from @x402/core's
facilitator primitive registered with @x402/stellar's server-side exact scheme.
MOVO WRITES ZERO VERIFICATION OR SETTLEMENT LOGIC. All auth-entry validation, simulation,
expiration checking and submission belong to @x402/stellar. If you find yourself writing XDR
parsing or signature checks, you are in the wrong layer — stop and report it.

Handlers must accept and return EXACTLY the spec's shapes. Do not add Movo-specific fields to
protocol responses. EVERY rejection must carry a non-null, machine-readable reason — an agent
must be able to reason about failure without parsing prose.

/supported must enumerate the configured networks and schemes and emit the Stellar `extra`
contract INCLUDING areFeesSponsored. Stock clients read this; a wrong shape makes the service
unusable no matter how correct settlement is. Compare your output field-by-field against the
public x402.org facilitator's /supported response for stellar:testnet.

Signer management: a pool of sponsoring accounts with round-robin selection and in-flight
tracking, plus CHANNEL ACCOUNTS to avoid sequence-number contention — agent traffic is bursty
and this is the known Stellar throughput bottleneck. Add a health check that fails readiness
when a sponsor falls below a configured XLM floor. Support injecting an external signer
(KMS/HSM) so production never needs a raw seed in an env var.

NON-CUSTODY IS AN INVARIANT, AND YOU MUST TEST IT, NOT COMMENT IT:
for a settled payment, assert the facilitator address appears as NONE of: transaction source,
operation source, transfer `from` address, or an address in any authorization entry.

BUILD apps/facilitator-service: a Hono HTTP service exposing the handlers plus /health and
/ready and /metrics. Optional bearer-key auth with per-key metering; rate limiting per key and
per IP; testnet open and keyless by default. Any mainnet fee must be a CONFIG VALUE, never
hard-coded, so self-hosters can change or remove it. Structured JSON logs with correlation IDs
that NEVER contain payloads, keys, or auth headers. Dockerfile + README + docs/RUNBOOK.md
covering deployment, key rotation, sponsor top-up, incident response and degraded mode.

TESTS
- unit: handler shapes, /supported shape, error mapping with non-null reasons, signer pool
  selection and exhaustion, sponsor-floor readiness failure
- integration on testnet: full verify+settle over HTTP; tampered amount; wrong network; wrong
  asset; expired auth entry; replayed payload — each with a distinct reason code
- the non-custody assertions above
- load: 200 concurrent settlements with zero sequence-number failures
- conformance: a script that drives an UNMODIFIED stock @x402/fetch client through a full
  payment, and a script that runs the x402 repo's e2e suite against your service for both
  networks. Record every settled transaction hash in docs/CONFORMANCE.md.
- security: rate limiter under burst, auth bypass attempts, oversized payload rejection

DOCUMENTATION
docs/guides/self-hosting-facilitator.md, apps/facilitator-service/README.md,
apps/facilitator-service/docs/RUNBOOK.md, updated docs/CONFORMANCE.md, and
docs/adr/0010-facilitator-architecture.md which must state explicitly that Movo owns the
service and never the cryptography, and why the AGPL OpenZeppelin plugin is not a dependency.

CONSTRAINTS
- Never fake a settlement. Never mark a conformance run as passing that you did not run.
- Never log a key, a payload, or an auth header.
- pubnet tests need a real funded account; if you do not have one, implement everything, run
  testnet, and report the pubnet criterion as UNVERIFIED. Do not fabricate a hash.
- Only touch packages/facilitator, apps/facilitator-service, tests/conformance, and the
  listed docs.

BEFORE YOU FINISH
1. pnpm check:licenses && pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Start the service, drive a stock client through a real testnet payment, and paste the
   transaction hash and the full /supported response.
3. Run the x402 e2e suite against it and paste the real result.
4. git diff --stat and a file-by-file summary.
5. If any part of the current x402 facilitator contract differs from this prompt, STOP and
   explain. Wire-level conformance is the hard acceptance criterion here — a subtly wrong
   response shape is worse than an unimplemented endpoint.
````

---
---

# Milestone 7 — Bazaar Catalog, Search & MCP Discovery

> **SCF-gated.** This is the highest-value deliverable in the RFP and the part existing catalogs most often leave unimplemented. It is also the part that makes Movo more than a nicer SDK.

## 1. Objective

Ship `@movo/catalog` and mount it on the facilitator: automatic cataloging at settle time, `GET /discovery/resources` with the spec's filters, `GET /discovery/search` with real natural-language ranking and a published evaluation methodology, `EXTENSION-RESPONSES` emission, catalog integrity controls, and an MCP discovery server.

## 2. Why this milestone exists

No existing catalog carries Stellar — the reference catalog lists Base and Solana only. A Stellar-denominated service today is only as discoverable as whichever multi-chain facilitator happens to carry it. This milestone closes that gap, and it can only be built here because cataloging is a facilitator-side operation (Milestone 6) driven by seller metadata (Milestone 4).

## 3. Starting state

Milestones 0–6 complete; the facilitator settles on both networks.

## 4. End state

A developer runs the quickstart, gets paid once, and their endpoint appears in the Movo Bazaar and is returned by a natural-language search — in under an hour from first reading the docs.

## 5. Scope

- **Automatic cataloging**: on settle, if the `PaymentPayload` carries the `bazaar` extension, validate `info` against the supplied `schema` and catalog with no separate registration step. Manual registration exists only as a secondary path.
- **Catalog integrity — the trust boundary.** Clients echo the `resource` block into the payload, so a hostile client can attempt to poison the catalog with forged metadata or a crafted `routeTemplate`. Implement soft-drop validation; percent-decode `routeTemplate` before traversal checks; bind listings to the settled `payTo` so one seller cannot overwrite another's entry or pricing.
- `GET /discovery/resources`: pagination plus the spec's `type`, `payTo`, `network`, `extensions`, `limit`, `offset` filters. Wire shape consistent with how other facilitators represent listings — Stellar must not be a walled garden.
- `GET /discovery/search`: natural-language `query`, cursor pagination, `partialResults` flag. **Real ranking** — lexical (BM25/FTS) over `serviceName`, `description`, `tags`, and parameter descriptions, combined with embedding similarity, plus health signals (demote resources with a high recent failure rate) and a dust threshold so micro-settles cannot inflate activity counters.
- **Search evaluation harness**: a labelled query set, nDCG@10 and recall@20 reported in CI, and a documented methodology for keeping quality honest over time. Search quality is a deliverable, not a detail.
- `EXTENSION-RESPONSES` emission on settle with `success` / `processing` / `rejected` + `rejectedReason`.
- MCP resources: catalog them keyed on the `(resource.url, input.toolName)` tuple.
- **MCP discovery server**: tools for searching the Stellar Bazaar and for making a paid call from inside an agent runtime, wrapping discover → pay → retry. Structured deterministic I/O; machine-readable error codes; every rejection carries a non-null reason.

## 6. Explicit non-scope

No on-chain Soroban registry (rent, eviction, and a doubled per-payment cost — keep the index off-chain by default; if ever added, it must stay off the per-payment hot path). No `upto` scheme. No paid ranking or sponsored placement, now or later — say so in the docs. No web UI beyond a minimal read-only browse page. No cross-facilitator federation in v1.

## 7. Files / packages

```
packages/catalog/src/{ingest,validate,store/{port,sqlite,postgres},search/{lexical,embedding,rank,eval},filters,integrity,index}.ts
packages/mcp/src/{server,tools/{search,paidCall},index}.ts
apps/facilitator-service/src/routes/discovery.ts
tests/catalog/*.test.ts, tests/search/eval/*.json
docs/guides/discovery-operator.md, docs/guides/agents.md
```

## 8. Implementation tasks

1. `Store` port with a SQLite implementation (self-hosters, tests) and Postgres + pgvector (hosted). Same test suite runs against both.
2. Ingest hook on settle: extract the echoed extension, validate, upsert keyed by `routeTemplate` for HTTP and `(url, toolName)` for MCP, stamp `lastUpdated`, return a cataloging outcome for the header.
3. Integrity: bind every listing to the `payTo` that actually settled; reject an update whose settled `payTo` differs from the stored one; percent-decode-then-check `routeTemplate`; soft-drop invalid service-metadata fields individually; reject non-fragment `$ref`; cap sizes on every field.
4. `/discovery/resources`: implement every spec filter; stable ordering; `limit`/`offset` with sane caps.
5. `/discovery/search`: hybrid retrieval — lexical index over name/description/tags/param descriptions, plus embeddings — fused with reciprocal-rank fusion; demote resources whose recent failure rate exceeds a threshold; apply a minimum-settlement threshold before counting activity so dust cannot pump apparent traffic; support `partialResults` when one retriever is degraded.
6. Eval harness: ≥100 labelled query/resource pairs in `tests/search/eval/`, nDCG@10 and recall@20 computed in CI, with a documented refresh process. Publish the numbers in the docs — an unevaluated ranker is a claim, not a feature.
7. `EXTENSION-RESPONSES`: emit on every settle carrying the extension; `processing` for async indexing; always populate `rejectedReason` on rejection.
8. MCP server: `bazaar.search`, `bazaar.get`, and `bazaar.paidCall` tools. `paidCall` uses `@movo/client` with a **mandatory budget policy** — an agent-facing paid-call tool without a spend cap is a foot-gun with a bank account attached.
9. Read-only browse page (server-rendered, no build step) for humans; explicitly not a marketplace.

## 9. Architecture decisions

- Off-chain index by default; on-chain registry explicitly rejected for v1 with reasons recorded in the ADR.
- Cataloging is automatic and payment-driven; manual registration is secondary because anything requiring seller action after payment gets skipped.
- Wire shapes mirror the spec exactly so Stellar listings are representable consistently with other facilitators' listings.
- Ranking is never for sale.

## 10. Dependencies

Milestones 0–6. External: SQLite (`node:sqlite` if adequate — check before adding `better-sqlite3`), Postgres + pgvector for hosted, and an embedding model (prefer a local/self-hostable model so self-hosters are not forced into a paid API; document the trade-off).

## 11. Testing strategy

- Ingest: valid extension catalogs; invalid `info` vs `schema` rejects with a reason; MCP tuple keying; `routeTemplate` consolidation across many concrete paths.
- **Integrity/adversarial (mandatory):** a hostile client attempting to (a) overwrite another seller's listing, (b) forge a `payTo`, (c) inject `..` via percent-encoding, (d) point `iconUrl` at a loopback address, (e) supply an external `$ref`, (f) submit oversized fields. Each must fail closed with a reason.
- Filters: one test per spec filter, plus combinations, plus pagination stability under concurrent inserts.
- Search: the eval harness with a CI floor on nDCG@10; degraded-retriever `partialResults` behaviour.
- MCP: deterministic structured outputs; every error path returns a non-null machine-readable code; `paidCall` refuses when over budget.
- Cross-store: the same suite green on SQLite and Postgres.

## 12. Documentation

`docs/guides/discovery-operator.md` (running the catalog, tuning search, the eval process), `docs/guides/agents.md` (buyer + agent path, MCP setup), a role-based developer hub structured around seller / buyer-and-agent / operator paths with live testnet examples, ADR-0011 discovery architecture (including the on-chain-registry rejection), and published search-quality numbers.

## 13. Security considerations

- The catalog is a trust boundary. Treat every field of an echoed payload as attacker-controlled.
- Listing-to-`payTo` binding is the anti-spoofing control; it is not optional.
- SSRF on `iconUrl` fetching; LFI/SSRF on schema `$ref`; ReDoS on any regex applied to attacker-controlled strings.
- Search must not become an amplification vector: cap query length, cap result sizes, rate-limit.
- Publish an abuse-report path and a takedown policy for fraudulent listings.

## 14. Acceptance criteria

1. A paid request from the Milestone 5 quickstart, carrying discovery metadata, results in the endpoint appearing in `GET /discovery/resources` with no separate registration step.
2. `GET /discovery/resources?type=http&payTo=G…&network=stellar:testnet&limit=10&offset=0` returns correctly filtered, stably ordered results.
3. `GET /discovery/search?query=weather+api` returns the seeded weather endpoint in the top 3.
4. nDCG@10 on the labelled eval set meets or exceeds the documented CI floor, and the number is published in the docs.
5. All six adversarial integrity tests fail closed with distinct, non-null reasons.
6. A settle carrying an invalid `info` returns `EXTENSION-RESPONSES` with `status: "rejected"` and a populated `rejectedReason`.
7. An MCP tool paid through Movo is cataloged and retrievable by its `(url, toolName)` tuple.
8. An agent using the MCP discovery server searches, selects, pays, and receives a resource with **no pre-baked integration** — demonstrated end to end on testnet.
9. `bazaar.paidCall` refuses a call exceeding its configured budget without producing a signature.
10. The full suite passes against both SQLite and Postgres.

## 15. Definition of done

- [ ] Ten acceptance criteria pass
- [ ] Adversarial suite green
- [ ] Search eval numbers published with methodology
- [ ] Role-based developer hub (seller / buyer / operator) written with live testnet examples
- [ ] Two end-to-end example integrations working
- [ ] ADR-0011 written

## 16. Risks

| Risk | Prob. | Impact | Mitigation |
|---|---|---|---|
| Discovery conventions change under the Foundation | High | High | Spec-shaped store, versioned wire mappers, a conformance suite, and a stated upkeep commitment; monitor the x402 repo's spec directory |
| Search quality is asserted rather than measured | High | High | The eval harness with a CI floor is mandatory, not optional |
| Catalog poisoning | Medium | High | `payTo` binding + the six adversarial tests + fail-closed defaults |
| Embedding dependency forces self-hosters onto a paid API | Medium | Medium | Local model by default; remote as opt-in; document both |
| Scope explosion into a marketplace | Medium | Medium | Read-only browse page only; no ranking for sale; ADR records the boundary |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 7 of Movo: the Stellar-native Bazaar — catalog, search, and an
MCP discovery server. This is the highest-value component in the project.

FIRST, DO NOT WRITE CODE.
1. Inspect the repo. Read docs/adr/*, packages/bazaar/src (seller-side declaration and
   validation), packages/facilitator/src, apps/facilitator-service/src, and packages/client/src.
   Milestones 0-6 are complete; preserve their architecture.
2. RESEARCH before designing — the discovery conventions are explicitly still moving:
   - https://docs.x402.org/extensions/bazaar in full, including validation rules,
     EXTENSION-RESPONSES semantics, service metadata (serviceName/tags/iconUrl), dynamic routes
     and routeTemplate, and the MCP resource type
   - github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md
   - the reference bazaar server example in that repo
   - inspect a live catalog's response shape so your wire format matches how other
     facilitators represent listings — Stellar must not be a walled garden

MILESTONE 7 GOAL
A developer completes the quickstart, gets paid once, and their endpoint is findable by a
natural-language search — with no registration step.

DO NOT BUILD: an on-chain Soroban registry (rent, TTL eviction and a doubled per-payment cost;
keep the index off-chain), the upto scheme, sponsored or paid ranking in any form, a
marketplace UI, or cross-facilitator federation.

BUILD packages/catalog:

Store port with TWO implementations — SQLite (self-hosters and tests) and Postgres+pgvector
(hosted). The same test suite must pass against both.

Automatic cataloging: hook the facilitator's settle path. When a PaymentPayload carries the
bazaar extension, validate `info` against the supplied `schema` and upsert the resource with
NO separate registration step. Key HTTP resources on routeTemplate and MCP resources on the
tuple (resource.url, input.toolName). Manual registration may exist only as a secondary path —
anything requiring the seller to act after payment gets skipped.

INTEGRITY — THIS IS A TRUST BOUNDARY, TREAT EVERY ECHOED FIELD AS ATTACKER-CONTROLLED.
Clients echo the resource block into the payment payload, so a hostile client will try to
poison the catalog. You must:
- bind every listing to the payTo that ACTUALLY SETTLED, and reject an update whose settled
  payTo differs from the stored one (this is the anti-spoofing control; it is not optional)
- percent-decode routeTemplate BEFORE traversal checks
- soft-drop individual invalid service-metadata fields while preserving the rest
- reject $ref/$id values that are not same-document JSON Pointer fragments
- cap the size of every field
Write an adversarial test for each of these six attacks: overwriting another seller's listing,
forging payTo, percent-encoded traversal, loopback iconUrl, external $ref, oversized fields.
Every one must FAIL CLOSED with a distinct, non-null reason.

GET /discovery/resources — implement every filter in the spec: type, payTo, network,
extensions, limit, offset. Stable ordering, capped page sizes.

GET /discovery/search — natural-language query, cursor pagination, partialResults flag.
SEARCH QUALITY IS A DELIVERABLE, NOT A DETAIL. Implement hybrid retrieval: a lexical index
(BM25/FTS) over serviceName, description, tags and per-parameter descriptions, plus embedding
similarity, fused with reciprocal-rank fusion. Demote resources with a high recent failure
rate. Apply a minimum-settlement threshold before counting activity so dust settlements cannot
pump apparent traffic. Return partialResults when one retriever is degraded.
Prefer a local/self-hostable embedding model so self-hosters are not forced onto a paid API;
make a remote model opt-in and document the trade-off.

BUILD THE EVAL HARNESS. At least 100 labelled query/resource pairs in tests/search/eval/,
nDCG@10 and recall@20 computed in CI with a floor that fails the build, and a documented
process for refreshing the set. An unevaluated ranker is a claim, not a feature — do not skip
this, and do not label the pairs so loosely that the metric is meaningless.

EXTENSION-RESPONSES: emit on every settle carrying the extension, with status success /
processing / rejected, and ALWAYS populate rejectedReason on rejection.

BUILD packages/mcp — an MCP discovery server with bazaar.search, bazaar.get, and
bazaar.paidCall tools, so an agent can discover and pay from inside its runtime with no
pre-baked integration. Structured, deterministic inputs and outputs. Machine-readable error
codes, with a non-null reason on every rejection so an agent can reason about failure instead
of parsing prose. bazaar.paidCall uses @movo/client and MUST require a budget policy — an
agent-facing paid-call tool without a spend cap is a foot-gun attached to a wallet.

Add a minimal server-rendered read-only browse page for humans. It is NOT a marketplace.

TESTS
Ingest and consolidation; every spec filter plus combinations plus pagination stability under
concurrent inserts; the six adversarial integrity tests; the search eval with a CI floor;
degraded-retriever partialResults; MCP determinism and error codes; paidCall budget refusal;
and the entire suite green against BOTH SQLite and Postgres.
End-to-end on testnet: an agent using the MCP server searches, selects, pays, and receives a
resource with no pre-baked integration.

DOCUMENTATION
docs/guides/discovery-operator.md (running the catalog, tuning search, the eval process),
docs/guides/agents.md (buyer and agent path, MCP setup), and a ROLE-BASED developer hub
organised around three paths — seller, buyer/agent, operator — each linking live testnet
examples a developer can actually run. Publish the search-quality numbers.
docs/adr/0011-discovery-architecture.md, recording why an on-chain registry was rejected for
v1 and stating that ranking is never for sale.

CONSTRAINTS
- Do not invent discovery fields or endpoints beyond the spec.
- Do not treat an absent EXTENSION-RESPONSES header as a failure signal anywhere.
- Fail closed on every validation path.
- Only touch packages/catalog, packages/mcp, apps/facilitator-service/src/routes/discovery.ts,
  tests/, and the listed docs.

BEFORE YOU FINISH
1. pnpm check:licenses && pnpm typecheck && pnpm lint && pnpm build && pnpm test
2. Run the quickstart end to end: pay once, then show the REAL /discovery/resources entry and
   the REAL /discovery/search result that returns it.
3. Paste the actual nDCG@10 and recall@20 numbers from the eval run.
4. Demonstrate the MCP agent flow on testnet and paste the transaction hash.
5. git diff --stat and a file-by-file summary.
6. Report honestly on anything unverified. Do not claim search quality you have not measured.
````

---
---

# Milestone 8 — Conformance, Security, Documentation & Release

## 1. Objective

Turn a working repository into a release-ready open-source project: full wire-level conformance evidence, third-party security review with resolved findings, a documentation site, reproducible examples, release automation, and `v0.1.0`.

## 2. Why this milestone exists

The constitution says a release is not ready because the code compiles. Everything in this milestone is a gate, not a feature. It exists as its own milestone because conformance evidence, a security review, and a reproducibility check cannot be done credibly in parallel with feature work.

## 3. Starting state

Milestones 0–5 complete (framework track) and, if pursued, 6–7 (service track).

## 4. End state

A developer who has never seen Movo clones the repo or runs `npm create movo-app`, follows the docs, and reaches a paid testnet request and a Bazaar listing without assistance. Every claim in the README is backed by a test or a recorded artefact.

## 5. Scope

- Documentation site (Docusaurus or VitePress — pick one, justify, keep it boring) covering: introduction, installation, quickstart, concepts, x402 architecture, Bazaar architecture, Stellar setup, facilitator setup, client usage, testing, troubleshooting, deployment, security, API reference, examples.
- Generated API reference from TypeScript declarations.
- Two complete example integrations: a paid API that becomes discoverable and is paid by an agent; an MCP-driven agent that discovers and pays with no pre-baked integration.
- Conformance report: e2e results per network, settled transaction hashes per network per scheme, and an unmodified-stock-client demonstration.
- Security: threat model document, dependency audit in CI, secret-scanning, a third-party review of the settlement path, auth-entry validation, and the discovery trust boundary, with findings resolved and published.
- Release: Changesets, provenance-enabled npm publishing, `CHANGELOG.md`, a documented support/compatibility policy, and a `COMPATIBILITY.md` regeneration gate.
- Performance baselines: p50/p95 for verify, settle, and discovery queries, published.
- Reproducibility check: a clean-machine run of the quickstart by someone who did not write it.

## 6. Explicit non-scope

No new features. No API changes except to fix defects found by review — and any such change requires a changeset and an explicit note. No hosted Movo Cloud. No mainnet marketing launch.

## 7. Files / packages

```
apps/docs/**
docs/{THREAT_MODEL.md,CONFORMANCE.md,SECURITY_REVIEW.md,PERFORMANCE.md,COMPATIBILITY.md}
apps/examples/{discoverable-api,agent-buyer}/**
.github/workflows/{release.yml,audit.yml,conformance.yml}
CHANGELOG.md, SUPPORT.md
```

## 8. Implementation tasks

1. Stand up the docs site; every code block in it must be extracted and compiled in CI. Documentation that does not compile is a defect, and this catches it automatically.
2. Generate the API reference from `.d.ts`; fail the build if a public export lacks a doc comment.
3. Build the two example integrations as workspace packages with their own tests.
4. Run and record the conformance suite: x402 e2e per network, stock-client payment, transaction hashes, `/supported` output.
5. Write the threat model: assets (sponsor keys, catalog integrity, seller funds), actors (hostile buyer, hostile seller, hostile facilitator, network observer), controls, and residual risks.
6. Wire `pnpm audit` / OSV scanning and the licence gate into a scheduled CI job, not only PR CI.
7. Commission and complete the third-party review; publish findings and resolutions in `SECURITY_REVIEW.md`.
8. Measure and publish performance baselines under a stated load profile.
9. Release automation: Changesets → version PR → publish with npm provenance; a pre-publish check that `docs/COMPATIBILITY.md` is current.
10. Write `SUPPORT.md`: supported Node versions, the `@x402/*` compatibility policy, the deprecation policy, and how quickly Movo tracks x402 spec changes.
11. Reproducibility: have a person who did not build Movo follow the quickstart on a clean machine and record friction; fix every blocker before tagging.

## 9. Architecture decisions

- Public API is frozen at `v0.1.0` under the documented compatibility policy; breaking changes require a major-version changeset and a migration note.
- Docs code blocks are compiled artefacts, not prose.
- Conformance evidence lives in the repository, not in a slide deck.

## 10. Dependencies

All previous milestones. External: a security reviewer; a clean-machine tester; funded testnet (and pubnet, if the facilitator track is included) accounts.

## 11. Testing strategy

- Docs: extract-and-compile every code block; link checker; quickstart executed end to end in CI weekly.
- Examples: each has a test; each runs against testnet in the gated suite.
- Conformance: full suite per network, results committed.
- Security: dependency audit, secret scan, licence gate, plus the adversarial suites from Milestones 6–7 re-run as a release gate.
- Performance: baseline script producing the published numbers.

## 12. Documentation

The complete site listed in §5, plus `THREAT_MODEL.md`, `CONFORMANCE.md`, `SECURITY_REVIEW.md`, `PERFORMANCE.md`, `SUPPORT.md`, `CHANGELOG.md`, and ADR-0012 release and versioning strategy.

## 13. Security considerations

- Publish with npm provenance so consumers can verify build origin.
- The review must specifically cover: settlement path, auth-entry validation, the discovery trust boundary, sponsor key handling, and redaction completeness.
- Confirm no test, example, or default configuration can touch production funds; add a CI check that no committed config names `stellar:pubnet` outside the facilitator service's own configuration.

## 14. Acceptance criteria

1. Every code block in the docs compiles in CI.
2. The quickstart, executed on a clean machine by someone who did not write it, reaches a successful paid testnet request with no undocumented step.
3. `docs/CONFORMANCE.md` contains e2e results and a settled transaction hash per network per scheme, plus the stock-client demonstration.
4. `docs/SECURITY_REVIEW.md` exists with all high and critical findings resolved.
5. `pnpm audit` and the licence gate pass in scheduled CI.
6. Every public export has a doc comment; the build fails otherwise.
7. Both example integrations run against testnet in the gated suite.
8. `docs/PERFORMANCE.md` publishes p50/p95 for verify, settle, and discovery under a stated load.
9. Changesets publishes all packages with provenance from a clean tag.
10. `docs/COMPATIBILITY.md` matches the installed versions at tag time; the pre-publish check enforces it.

## 15. Definition of done

- [ ] Ten acceptance criteria pass
- [ ] Reproducibility run completed and friction fixed
- [ ] Security review published with resolutions
- [ ] **Tag and publish `v0.1.0`**

## 16. Risks

| Risk | Mitigation |
|---|---|
| Security review finds a settlement-path defect late | Book the reviewer at Milestone 6, not Milestone 8; give them the threat model early |
| Docs drift from code | Compile every code block in CI; treat drift as a build failure |
| `@x402/*` releases a breaking change during the release window | Freeze the pin at RC; regenerate the matrix; re-run conformance before tagging |
| "Works on my machine" quickstart | The clean-machine reproducibility run is a hard gate |

## 17. Claude Code implementation prompt

````text
You are implementing Milestone 8 of Movo: conformance, security, documentation and the
v0.1.0 release. This milestone adds NO new features.

FIRST, DO NOT WRITE CODE.
1. Inspect the entire repository. Read every ADR, every doc under docs/, and every package's
   public exports. Read docs/CONFORMANCE.md and docs/COMPATIBILITY.md.
2. Read 04_MVP_SCOPE_AND_ACCEPTANCE.md (definition of done and quality bar) and
   06_REPOSITORY_CONSTITUTION.md (release philosophy).
3. Produce a gap report BEFORE changing anything: for each item in the MVP definition of done,
   state whether it is satisfied, partially satisfied, or not satisfied, with evidence. Show me
   this report first.

MILESTONE 8 GOAL
Make Movo releasable: a developer who has never seen it reaches a paid testnet request and a
Bazaar listing by following the docs alone, and every claim in the README is backed by a test
or a recorded artefact.

DO NOT ADD FEATURES. Do not change public APIs except to fix defects found by review, and if
you do, add a changeset and an explicit migration note.

BUILD

Documentation site under apps/docs (Docusaurus or VitePress — pick one, justify it briefly,
and keep it boring). Cover: introduction, installation, quickstart, concepts, x402
architecture, Bazaar architecture, Stellar setup, facilitator setup, client usage, testing,
troubleshooting, deployment, security, API reference, examples.
CRITICAL: every code block in the docs must be EXTRACTED AND COMPILED IN CI. Documentation
that does not compile is a defect and this is the only reliable way to catch it.
Generate the API reference from the TypeScript declarations, and fail the build if any public
export lacks a doc comment.

Two complete example integrations as workspace packages with their own tests:
(a) a paid API that becomes discoverable and is paid by an agent
(b) an MCP-driven agent that discovers and pays with no pre-baked integration

docs/CONFORMANCE.md — run and record: the x402 repo's e2e suite per network, a settled
transaction hash per network per scheme, the full /supported response, and a demonstration of
an UNMODIFIED stock client completing a payment.

docs/THREAT_MODEL.md — assets (sponsor keys, catalog integrity, seller funds, buyer budgets),
actors (hostile buyer, hostile seller, hostile facilitator, network observer), controls, and
residual risks. Write this before the security review, not after.

docs/SECURITY_REVIEW.md — findings and resolutions from a third-party review covering the
settlement path, auth-entry validation, the discovery trust boundary, sponsor key handling and
redaction completeness. If no review has been commissioned, say so plainly and record the
milestone as blocked on it rather than writing a self-assessment and calling it a review.

docs/PERFORMANCE.md — p50/p95 for verify, settle and discovery queries under a stated load
profile, with the measurement script committed.

SUPPORT.md — supported Node versions, the @x402/* compatibility policy, the deprecation
policy, and how quickly Movo tracks x402 spec changes.

CI and release: scheduled dependency audit and licence gate (not only on PRs); Changesets
release workflow publishing with npm provenance; a pre-publish check that docs/COMPATIBILITY.md
matches the installed versions; a check that no committed configuration outside the facilitator
service names stellar:pubnet, so no example or test is one env var from real funds.
docs/adr/0012-release-and-versioning.md.

REPRODUCIBILITY
Execute the quickstart yourself from a clean state, as literally as possible, and record every
point of friction. Fix every blocker. Then state explicitly which steps you could not verify
without a human on a genuinely clean machine.

CONSTRAINTS
- No new features. No scope expansion.
- Never fabricate conformance results, transaction hashes, performance numbers, or a security
  review. If something was not run, say it was not run.
- Do not mark the release gate satisfied on the basis of code that compiles.

BEFORE YOU FINISH
1. Show the gap report from step 3 above, updated with what you fixed.
2. pnpm check:licenses && pnpm audit && pnpm typecheck && pnpm lint && pnpm build && pnpm test
3. Paste the real conformance results and transaction hashes.
4. git diff --stat and a file-by-file summary.
5. State clearly which release-gate conditions are MET and which are NOT MET. Do not tag
   v0.1.0 if any are unmet — list what remains instead.
````

---
---

# A. Dependency graph

```
                          M0 Foundation
                               │
                               ▼
                        M1 Core runtime
                               │
                               ▼
              M2 Stellar + first paid testnet request   ◄── CRITICAL PATH ENDS HERE
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                │
     M3 Client + testing   M4 Bazaar seller     │   (M3 and M4 are parallelizable)
              │                │                │
              └────────┬───────┘                │
                       ▼                        │
              M5 CLI + scaffolding  ────────────┘
                       │
                       │  ── v0.1.0-alpha ──
                       │
              ┌────────┴────────┐
              ▼                 │
     M6 Facilitator             │   (skip M6–M7 if not pursuing SCF;
              │                 │    keep the in-process facilitator from M3)
              ▼                 │
     M7 Catalog + search + MCP  │
              │                 │
              └────────┬────────┘
                       ▼
        M8 Conformance + security + docs + release
                       │
                    v0.1.0
```

**Parallelizable:** M3 and M4 after M2. Within M7, the catalog/search work and the MCP server are separable. Docs work in M8 can begin during M5.

**Hard serial:** M0 → M1 → M2 (each depends on the prior's contracts), and M6 → M7 (cataloging is a facilitator operation).

# B. Critical path to the first successful Stellar testnet-paid Movo API

**M0 → M1 → M2.** Three milestones. Minimum viable slice within them:

1. pnpm workspace + strict TS + Vitest + exact `@x402/*` pins (M0, partial — skip the licence gate and ADRs on the spike).
2. `resource()` + config resolution + `Facilitator` port + `HttpFacilitator` + the lifecycle union (M1, partial — skip hooks and the full error taxonomy).
3. `@movo/stellar` network + asset + scheme registration; `@movo/express` outcome mapping; the weather example; the gated testnet e2e with on-chain confirmation (M2).

Prerequisites outside the code: a Stellar testnet keypair funded via friendbot, a USDC trustline (Circle faucet for the balance), and the free `https://www.x402.org/facilitator` — no API key needed for `stellar:testnet`.

Do this spike **first, on a branch, before M0 is polished.** If the payment does not flow, everything downstream is speculation.

# C. MVP boundary

### IN v0.1.0

- Monorepo, strict TS, ESM, CI on Node 22/24/26, Apache-2.0, licence gate
- `resource()` declaration model with typed handlers; config with environment separation and source tracking
- Full payment lifecycle with correct verify/handler/settle ordering and no-unpaid-access guarantees
- `Facilitator` port: hosted HTTP, in-process, mock
- Stellar `exact` on `stellar:testnet` and `stellar:pubnet` via `@x402/stellar`; SEP-41 assets; 7-decimal base units in `bigint`
- Preflight diagnostics (account, trustline, asset, facilitator, clock)
- Express + Node HTTP adapters
- `@movo/client` with an enforced budget policy and injected signer
- `@movo/testing` with the nine-scenario failure matrix, runnable with and without network
- Bazaar seller metadata generation, validation, and `EXTENSION-RESPONSES` interpretation
- `create-movo-app` + `movo dev|doctor|test|bazaar`
- Docs site, two examples, conformance evidence, threat model, security review, performance baselines
- **If SCF track:** self-hostable facilitator (both networks), automatic cataloging, `/discovery/resources`, `/discovery/search` with measured ranking, MCP discovery server

### NOT IN v0.1.0

- `upto` scheme (and therefore metered/usage billing) — separate workstream, needs a new upstream spec and probably a Soroban contract
- `batch-settlement`, `auth-capture`
- On-chain Soroban registry
- Multi-chain settlement (EVM/SVM) — the abstractions permit it; nothing implements it
- MPP
- Movo Cloud, hosted marketplace, consumer UI, wallet, custody, payment routing, analytics SaaS
- Next.js / Hono / Fastify adapters (extension points exist; adapters do not)
- `movo build`, `movo deploy`
- Paywall / human-payment UI
- Cross-facilitator federation, sponsored ranking
- Telemetry of any kind

# D. Architecture summary

```
  Developer                                                    Agent / Buyer
      │                                                              │
      │  resource({ price, network, payTo, discovery, handler })     │  @movo/client
      ▼                                                              │  (budget policy,
┌──────────────────────────────────────────┐                         │   injected signer)
│              @movo/core                   │                        │
│  ┌────────────┐  ┌──────────┐  ┌────────┐ │                        │
│  │  resource  │  │  config  │  │ errors │ │                        │
│  │  registry  │  │ + source │  │+redact │ │                        │
│  └─────┬──────┘  └────┬─────┘  └────────┘ │                        │
│        ▼              ▼                   │                        │
│   ┌───────────────────────────────┐       │      HTTP 402          │
│   │  lifecycle (union outcome)    │◄──────┼────────────────────────┘
│   │  402 → verify → handler →     │       │
│   │  settle, with ordering rules  │       │
│   └──────────┬────────────────────┘       │
│              │      ┌──────────────────┐  │
│              │      │ protocol/        │  │  ← the ONLY @x402/* import site
│              │      │ (narrow waist)   │  │
│              │      └──────────────────┘  │
└──────────────┼───────────────────────────-┘
               │
     ┌─────────┴──────────┬──────────────────┬─────────────────┐
     ▼                    ▼                  ▼                 ▼
@movo/express      @movo/stellar       @movo/bazaar     Facilitator port
 (+ node http)   networks, assets,   discovery decl.,  ┌──────┬─────────┬────────┐
                 preflight, scheme   validation, query │hosted│in-proc. │  mock  │
                        │                    │         └───┬──┴────┬────┴────────┘
                        ▼                    │             │       │
                 @x402/stellar               │             │       ▼
                        │                    │             │  @movo/facilitator  (M6)
                        ▼                    │             │       │
                Soroban auth entries         │             │       ▼
                  SEP-41 transfer            │             │  @movo/catalog      (M7)
                        │                    └─────────────┼──► /discovery/resources
                        ▼                                  │    /discovery/search
                  Stellar network  ◄─────────────────────-─┘    MCP discovery server
```

# E. Package dependency graph

```
@x402/core ──────┬──► @movo/core ──┬──► @movo/stellar ──► @stellar/stellar-sdk
                 │        ▲        │           ▲
@x402/extensions ┼────────┼────────┼──► @movo/bazaar
                 │        │        │           ▲
@x402/express ───┼──► @movo/express│           │
                 │                 ├──► @movo/testing ──► @movo/stellar
@x402/fetch ─────┼──► @movo/client │
@x402/stellar ───┘        ▲        └──► @movo/cli ──► core, stellar, bazaar, testing
                          │                    ▲
                          │              create-movo-app (templates depend on the above)
                          │
@movo/facilitator ──► @movo/stellar, @movo/core        (M6)
@movo/catalog    ──► @movo/bazaar, @movo/facilitator   (M7)
@movo/mcp        ──► @movo/client, @movo/catalog       (M7)
```

Rules: no cycles; `@movo/core` depends on no other `@movo/*` package; only `@movo/core/src/protocol/**` imports `@x402/*`; `@movo/testing` may depend on anything but nothing may depend on it outside `devDependencies`.

# F. Top 10 technical risks

| # | Risk | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **`@x402/*` API drift.** 2.21.0 shipped 2026-08-04; releases are roughly weekly; internal pins are `~`-tight. | High | High | Exact pins; the narrow-waist module confining all x402 imports to one directory; generated `COMPATIBILITY.md`; conformance suite re-run on every bump; a stated upkeep policy in `SUPPORT.md` |
| 2 | **Bazaar discovery conventions change.** The Foundation is actively evolving endpoint shapes, filters and metadata fields. | High | High | Spec-shaped storage with versioned wire mappers; conformance graded as heavily as the build; monitor the spec directory; never freeze on the award date |
| 3 | **Search quality is asserted, not measured.** The most common failure of existing catalogs. | High | High | The labelled eval set with nDCG@10/recall@20 in CI and a build-failing floor, from the first commit of the ranker |
| 4 | **Sequence-number contention under bursty agent traffic.** | High | High | Channel accounts designed in at M6, load-tested at 200 concurrent settlements |
| 5 | **Catalog poisoning via echoed metadata.** Clients control the `resource` block. | Medium | High | Bind listings to the settled `payTo`; percent-decode before traversal checks; soft-drop; six adversarial tests that must fail closed |
| 6 | **Sponsor key compromise or drain.** | Low | Critical | External signer/KMS support; no raw seeds in production config; balance floors with readiness failure; rate limiting and metering as spend controls; third-party review |
| 7 | **Movo drifts into reimplementing verification or settlement.** | Medium | High | ADR-0006/0010 boundaries; narrow-waist lint; review rule that any XDR construction in `@movo/*` is rejected |
| 8 | **Testnet friction (missing trustline, expiring auth entries, facilitator fee limits) makes the quickstart fail for new users.** | High | Medium | Preflight in M2 rather than deferred; `movo doctor` with `fix` hints; the fee workaround isolated and documented; clean-machine reproducibility gate |
| 9 | **`upto` scheme scope creep.** The RFP wants it; it needs a new upstream spec and probably a Soroban contract with its own audit. | Medium | High | Explicitly out of v0.1.0; tracked as a separate workstream with its own budget and audit line; do not let it enter the framework milestones |
| 10 | **Licence contamination.** AGPL exists in the adjacent ecosystem and is disqualifying for a network service. | Low | Critical | Automated licence gate from M0, in PR CI and scheduled CI; explicit ADR; never vendor the OpenZeppelin relayer plugin |

# G. Protocol compatibility matrix

Regenerate `docs/COMPATIBILITY.md` on every dependency bump; the values below are the starting point as of 2026-08-09.

| Component | Version / API | Source | Movo dependency |
|---|---|---|---|
| x402 protocol | v2 (`x402Version: 2`), launched 2025-12-11 | x402.org, `x402-foundation/x402` | Delegated entirely; never reimplemented |
| `@x402/core` | 2.21.0 (2026-08-04), Apache-2.0 | npm registry | Exact pin; imported only in `@movo/core/src/protocol` |
| `@x402/stellar` | 2.21.0, Apache-2.0, `engines.node >=22`, depends `@stellar/stellar-sdk ^16.0.1` | npm registry | Exact pin; owns auth entries, simulation, settlement |
| `@x402/extensions` | 2.21.0, Apache-2.0 | npm registry | Bazaar declaration + `withBazaar` |
| `@x402/express` | 2.21.0, peer `express ^4 \|\| ^5` | npm registry | Header encoding in `@movo/express` |
| `@x402/fetch`, `@x402/mcp` | 2.21.0 | npm registry | Client and MCP paths |
| Bazaar extension | v2 extension; `/discovery/resources`, `/discovery/search`, `EXTENSION-RESPONSES`, `routeTemplate`, service metadata | docs.x402.org/extensions/bazaar | Seller declaration (M4); catalog implementation (M7) |
| Scheme | `exact` on Stellar via Soroban auth entries; SEP-41 assets | `specs/schemes/exact/scheme_exact_stellar.md` | Delegated to `@x402/stellar` |
| Networks | CAIP-2: `stellar:testnet`, `stellar:pubnet` | Stellar docs | Only these two accepted |
| Assets | Any SEP-41 token, USDC default, **7 decimals** | Stellar docs, SEP-0041 | `bigint` base-unit conversion |
| Facilitator (dev default) | `https://www.x402.org/facilitator` — `stellar:testnet`, no API key, `areFeesSponsored: true` | Stellar docs / RFP conformance baseline | Default in templates and CI |
| Facilitator (alt) | `https://channels.openzeppelin.com/x402[/testnet]`, API key required, **AGPL-3.0 codebase** | Stellar docs | Runtime-configurable only; **never a code dependency** |
| `@stellar/stellar-sdk` | 16.2.0, `engines.node >=22` | npm registry | Preflight, address/asset validation |
| Node.js | 24 Active LTS; 22 Maintenance; 26 Current | nodejs.org | `engines: >=22`; CI matrix 22/24/26 |
| TypeScript | 7.0.2 current | npm registry | Strict; validate the toolchain against TS 7 before adopting, and pin |
| Vitest / pnpm | Vitest 4.x; pnpm 10.x | npm registry | Test runner and workspace manager |
| Licence | Apache-2.0 throughout; zero AGPL/SSPL/GPL | SCF RFP §3.6 | Enforced by `pnpm check:licenses` |

# H. Release gates

### `v0.1.0-alpha` — end of Milestone 5

- [ ] Milestones 0–5 complete with all acceptance criteria met
- [ ] `npm create movo-app` → install → `movo dev` → paid testnet request, verified end to end
- [ ] At least one real Stellar testnet transaction hash recorded in `docs/CONFORMANCE.md`
- [ ] Full failure matrix green (mock path in CI, in-process path gated)
- [ ] `movo doctor` produces actionable findings for every preflight failure
- [ ] Zero secrets in logs, proven by test
- [ ] Licence gate green
- [ ] Published under `alpha` dist-tag with a clearly stated "APIs will change" notice

### `v0.1.0-beta` — end of Milestone 7 (or end of Milestone 5 + docs if the SCF track is dropped)

- [ ] Everything in alpha, plus:
- [ ] Facilitator conformant on `stellar:testnet` **and** `stellar:pubnet`; unmodified stock client completes a payment on both
- [ ] `/supported` emits the Stellar `extra` including `areFeesSponsored`
- [ ] x402 repo e2e suite passes against the facilitator for both networks
- [ ] Automatic cataloging works with no separate registration step
- [ ] `/discovery/resources` implements every spec filter; `/discovery/search` returns ranked results
- [ ] Search eval published with nDCG@10 above the stated floor
- [ ] All six catalog-integrity adversarial tests fail closed with non-null reasons
- [ ] MCP agent flow completes discover → pay → receive with no pre-baked integration
- [ ] Threat model published
- [ ] Public API frozen except for defect fixes

### `v0.1.0` — end of Milestone 8

- [ ] Everything in beta, plus:
- [ ] Third-party security review complete; all high and critical findings resolved and published
- [ ] Every documentation code block compiles in CI
- [ ] Quickstart verified on a clean machine by someone who did not build Movo, with no undocumented steps
- [ ] Both example integrations run against testnet
- [ ] Settled transaction hash recorded per network per scheme
- [ ] Performance baselines published (p50/p95 verify, settle, discovery)
- [ ] Dependency audit, secret scan and licence gate green in scheduled CI
- [ ] `SUPPORT.md` states supported Node versions, the `@x402/*` compatibility policy and the spec-tracking commitment
- [ ] `docs/COMPATIBILITY.md` regenerated and matching at tag time
- [ ] All packages published with npm provenance from a clean tag
- [ ] `CHANGELOG.md` complete

---

## Sources

- x402 protocol and specs — https://github.com/x402-foundation/x402 · https://docs.x402.org
- x402 v2 launch — https://x402.org/x402-v2-launch/
- Bazaar extension — https://docs.x402.org/extensions/bazaar
- x402 on Stellar — https://developers.stellar.org/docs/build/agentic-payments/x402 (overview, Built-on-Stellar facilitator, quickstart guide)
- SEP-0041 — https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md
- SCF RFP Track — https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track
- Package versions — npm registry, queried 2026-08-09
- Node.js release schedule — https://nodejs.org/en/about/previous-releases
