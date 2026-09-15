# @movoframework/core

## 0.1.0

### Minor Changes

- acecc44: Ship the mount and the Stellar preflight diagnostics, and prove a real settled payment.

  **`@movoframework/server`.** `mountExpress` and `mountNodeHttp` compose upstream rather than
  wrapping it: compile, build a `FacilitatorClient`, construct an `x402ResourceServer` with
  `ExactStellarScheme` registered, wrap it in an `x402HTTPResourceServer`, and hand that to
  `paymentMiddlewareFromHTTPServer`. `MountResult.server` exposes the raw resource server so
  consumers can attach the upstream hooks that can abort and recover. The mount point is
  `FromHTTPServer` rather than `FromConfig` because `FromConfig` hides the object all seven
  lifecycle hooks hang off — and those hooks are where diagnostics live.

  **`@movoframework/stellar`.** Six preflight checks — account, trustline, asset, facilitator,
  expiry, clock — each returning a `Finding` and never throwing for a negative result. The
  trustline check verifies the asset's **issuer**, derived from the contract's own `name()`, not
  just the asset code: anyone can issue an asset called USDC, and a trustline to the wrong issuer
  looks correct in a wallet while still being unable to receive payment. The asset check reads
  decimals from the contract rather than assuming 7. No Stellar constant is defined anywhere in
  the package.

  **`@movoframework/core`.** The narrow waist gains the Stellar RPC and Horizon helpers preflight
  needs, plus a `./server` subpath carrying the resource server, facilitator client, Stellar scheme
  and Express middleware. The subpath exists so the main entry stays free of Express and the
  Stellar SDK — importing `@movoframework/core` must not load an HTTP framework. `PAYMENT_HEADERS`
  declares the three wire header names once, so no other package writes them as literals.

  **Evidence.** A real payment settled on Stellar testnet in Circle USDC, independently confirmed
  from Horizon by the test itself: transaction
  `e05853dac4902d8ceead5bc66fd314be0dc1e3e5a12cb04ed73e09693dd4a048`, ledger 4101310. The
  transaction's source account is the facilitator's, so fees were sponsored and the buyer paid none
  of them. Recorded in `docs/CONFORMANCE.md`.

  Invariants I1–I6 are asserted against the real Express middleware with a stub facilitator, each
  verified against the installed middleware source before being written. A new
  `pnpm check:protocol-purity` gate fails the build if either package starts constructing XDR,
  handling signatures, or writing `PAYMENT-*` header literals — and if `packages/core` ever imports
  `@stellar/stellar-sdk` directly.

- 5706a06: The CLI, the scaffolder, and the developer experience layer.

  **`create-movo-app`.** `npm create movo-app my-api` produces a real working project: two
  templates, `minimal` and `discoverable`, both of them **workspace members** compiled, linted and
  tested by CI. A template kept as an embedded string rots within weeks and rots invisibly, because
  nothing compiles it. Three things are rewritten at scaffold time and cannot survive the copy:
  `workspace:*` ranges, which no registry can resolve; `tsconfig.json`, which extends a monorepo
  base a generated project cannot see; and `gitignore` → `.gitignore`, because npm renames a
  published `.gitignore` to `.npmignore` and a user's `.env` would arrive unignored.

  **`@movoframework/cli`.** Four commands. `movo doctor` runs every check Movo has — Node version,
  `@x402/*` pin drift, configuration, compilation, six Stellar preflight checks, discovery
  validation — renders each with its fix and docs link, and exits on a `--fail-on` threshold you
  choose. **It composes library exports and implements no check of its own**, because a check that
  only a CLI can run cannot be run by a downstream project's CI. `movo dev` prints the resolved
  configuration with the provenance of every value and every paid route's method, path, price,
  network and `payTo`, then watches with Node's own `--watch`. `movo test` wraps Vitest and
  forwards arguments verbatim. `movo bazaar validate|list|search` exposes M4's escalation from a
  terminal.

  A configured facilitator API key appears in **zero bytes** of any output, asserted byte-for-byte
  rather than argued for. `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and TTY state are all honoured;
  colour is off unless positively known to be safe, because doctor output gets pasted into bug
  reports. No argument parser, no table library, no colour library — `util.parseArgs` and about
  thirty lines.

  **`@movoframework/core`.** Two new environment checks, `checkNodeVersion` and `checkPinDrift`,
  as pure functions over injected data — the CLI reads the environment, the library judges, so core
  stays free of I/O while the judgement stays reusable. Three new codes:
  `MOVO_W_NODE_VERSION_UNSUPPORTED`, `MOVO_W_X402_PIN_DRIFT`, and
  `MOVO_E_FACILITATOR_PUBNET_REFUSED` — the last one distinct from `MOVO_E_PUBNET_NOT_ENABLED`
  because that code's fix is "set `MOVO_ALLOW_PUBNET=1`" and this refusal fires _after_ that has
  been set. Handing a reader a remedy they have already applied is worse than handing them none.

  **`@movoframework/bazaar`.** `attachDiscovery` is now a public export: derive every declaration,
  attach it, then escalate. The ordering is the part that is easy to get wrong — upstream's
  validator reads `route.extensions`, which a freshly compiled app does not have, so validating
  first reports nothing and reads as a clean bill of health. It was previously private to the
  mount; `movo doctor` and `movo bazaar validate` need exactly the same sequence, and a second copy
  in the CLI would have been two orderings free to drift.

  **`@movoframework/testing`.** A `./setup` subpath registering the matchers, preloaded by `movo
test`. `withPaidServer` accepts `config` layers, so a generated test passes on a fresh clone
  rather than only on a machine that already has `MOVO_PAY_TO` set.

  **`@movoframework/server`.** The mount now calls `attachDiscovery` and keeps only the
  `strictDiscovery` policy locally — whether a misdeclared listing should stop a server booting is
  a deployment decision, not a fact about the metadata.

- 6c5a708: M6 — the SCF facilitator track.

  Adds `@movoframework/facilitator`, the service tier of a self-hostable Stellar x402
  facilitator, and `apps/facilitator`, a deployable Hono service over it. Both compose
  `x402Facilitator` + `ExactStellarScheme` from `@x402/*` and contain no verification or
  settlement logic of their own — a CI grep (`check:protocol-purity`) now scans both for XDR
  construction and signature handling and fails the build on either.

  New in `@movoframework/facilitator`: `createFacilitator` returning transport-agnostic
  `verify` / `settle` / `supported` handlers plus readiness and metering; `SignerPool` with
  channel accounts, per-account exclusivity and XLM balance floors; external signer/KMS
  injection through a structural `FacilitatorStellarSigner`, so production never needs a raw
  seed in an environment variable; caller authentication, per-key and per-IP rate limiting,
  and a single-sourced registry of service-tier rejection reasons.

  New in `@movoframework/core`: a fourth narrow-waist module on the `./facilitator` subpath,
  re-exporting `x402Facilitator`, the facilitator-subpath `ExactStellarScheme`, upstream's
  payload and requirements schemas, and `createEd25519Signer`. It is separate from
  `./server` so a facilitator deployment does not carry Express. Two error codes added:
  `MOVO_E_FACILITATOR_CONFIG_INVALID` and `MOVO_E_FACILITATOR_SIGNER_UNAVAILABLE`.

  Evidence, on Stellar testnet: an unmodified stock `@x402/fetch` client completes a payment
  through the service with an on-chain-confirmed hash; the same through an in-process
  self-facilitating resource server; `/supported` matches the public reference facilitator's
  `stellar:testnet` entry field for field including `extra.areFeesSponsored`; five distinct
  non-null rejection reasons; the non-custody invariant asserted on both the buyer-signed and
  the settled transaction; and 200 concurrent settlements with 25 sponsors producing 200
  settlements and zero failures. Recorded in `docs/CONFORMANCE.md`. Pubnet is UNVERIFIED.

  No AGPL, SSPL or GPL enters the dependency path. The two dependencies added, `hono` and
  `@hono/node-server`, are MIT.

- 129d707: Ship the Stellar Bazaar: automatic cataloguing at settle time, measured hybrid search, and an MCP
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

  **Integrity is a trust boundary and the controls read the raw payload.** Upstream _soft-drops_ an
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

- M8 — the testnet-complete v0.1.0 release. No new features.

  Adds the dedicated stock-client conformance suite (§1.16 layer 4, the RFP's literal acceptance
  test): an unmodified `@x402/fetch` + `@x402/stellar` client drives a full payment through the Movo
  stack, with the scheme matrix read from the deployment's own `/supported` and the network matrix
  carrying both networks from the start. Settlement is confirmed from Horizon, not from the
  `PAYMENT-RESPONSE` header, and every rejection is asserted to carry a distinct non-null reason.

  Pubnet is a configuration flip rather than a code change, behind an explicit opt-in that is
  separate from its credentials — holding pubnet keys is not sufficient to spend them. v0.1.0 is
  **testnet-complete**: pubnet settlement, the mainnet production tag and the third-party security
  review are the committed production follow-on, not part of this release.

  Release engineering: npm OIDC trusted publishing with automatic provenance and no long-lived
  token, `LICENSE` and repository metadata in every package, `CODEOWNERS`, and the key-management
  threat model the future third-party review reads.

- 40b0424: Bazaar discovery derivation with severity escalation, and the buyer client with budget
  enforcement.

  **`@movoframework/bazaar`.** `deriveDiscovery` builds the upstream declaration from the Movo
  resource, so the route definition and the discovery metadata cannot drift apart. Input schemas
  are converted to JSON Schema where the vendor allows it — Zod v4, reached by optional dynamic
  import so Zod is never a dependency — with an explicit `inputSchema` override for everything
  else and a warning rather than silence when neither applies. `validateDiscoveryStrict` runs
  upstream's validators and turns each silent soft-drop into an error-level `Finding` with a fix.
  `queryCatalog` composes `withBazaar` over a real facilitator client. `readCatalogOutcome`
  interprets `EXTENSION-RESPONSES` as four states, where `unknown` means no signal and is not a
  failure.

  **This package implements no validator.** Upstream ships all of them, including the icon-URL SSRF
  check and route-template traversal detection. `pnpm check:upstream-validators` enforces AC4.8
  mechanically: it fails on a declared validator, a regex literal or a restated length constant,
  and also fails if the package stops calling upstream altogether.

  **`@movoframework/client`.** `createBudget` builds on upstream's `PaymentPolicy` and adds the
  stateful spend accountant a stateless policy cannot provide. Refusal happens before payment
  creation, so a refused offer leaves no signature in existence — asserted with a signer spy.
  `createMovoClient` composes `x402Client`, the Stellar client scheme and `wrapFetchWithPayment`;
  its `call()` reuses the server's own resource declaration so the handler's return type is the
  call site's result type with no cast.

  **`@movoframework/core`.** The narrow waist gains two modules: `@movoframework/core/bazaar` for
  the discovery surface and `@movoframework/core/client` for the buyer surface. Subpaths, so the
  main entry never loads `ajv`, a signing stack or an HTTP framework. `DiscoveryDeclaration` gains
  optional `inputSchema`, `outputSchema`, `bodyType`, `toolName` and `transport`.

  **`@movoframework/server`.** The mount derives each declaration, attaches it to the compiled
  route, then registers `bazaarResourceServerExtension` behind `checkIfBazaarNeeded` — in that
  order, because the question is only answerable after derivation has run. `strictDiscovery` fails
  the mount when escalation finds an error, for deploy gates.

  Two upstream findings recorded: `declareMcpDiscoveryExtension` does not exist (one function
  dispatches on `toolName`), and no public `EXTENSION-RESPONSES` decoder exists upstream — a
  genuine gap and a candidate contribution. Both are asserted by conformance tests that fail if
  upstream changes.

- 0aa9857: Implement the Movo core: configuration with provenance, the resource model, the compiler, the
  error registry, redaction, and the x402 protocol narrow waist. Everything is pure — no network,
  no filesystem, no clock.

  **Configuration.** `defineConfig` validates structurally and performs no I/O. `resolveConfig`
  merges five layers — defaults, `movo.config.ts`, `MOVO_*` environment variables, a per-resource
  override, an explicit argument — and returns every leaf as `{ value, source }` so `movo doctor`
  can print where each setting came from. Validation is eager: an invalid `payTo` fails at startup
  rather than when a buyer tries to pay. `env: "pubnet"` requires `MOVO_ALLOW_PUBNET=1`, and the
  interlock is checked before anything else.

  **Resources.** `defineResource` returns plain, serialisable data plus one handler. Input and
  output types flow from a Standard Schema validator into the handler's context and out to the
  buyer's call site. Prices are a money string (`"$0.001"`) or a SEP-41 asset amount; naming an
  asset by ticker throws `MOVO_E_PRICE_ASSET_ALIAS` pointing at `getUsdcAddress`. Movo performs no
  decimal conversion of its own. Wildcard paths are rejected.

  **Compilation.** `compileApp` produces an `@x402/core` `RoutesConfig`, a handler map, declared
  discovery route keys, the resolved configuration and static findings. `routes` is deliberately
  the raw upstream type — a compile-time test asserts it is accepted by `@x402/express`'s
  `paymentMiddleware` without a cast, so the escape hatch is a checked promise rather than a claim.

  **Errors and redaction.** `MovoError` carries a stable code, a fix template and a docs URL built
  from a single `DOCS_BASE_URL` constant. Context and message are redacted at construction, not at
  log time, so an unredacted value cannot escape through an unanticipated serialisation path.
  `docs/reference/errors.md` is generated from the registry and a test asserts they cannot diverge.

  **Hooks** are observers only. Control flow stays with the upstream hooks on
  `x402ResourceServer`, so there is exactly one implementation of payment ordering in the system.

  Also in this change: the unit suite now fails if any test invokes `globalThis.fetch`; the npm
  scope and the error-docs base URL are single-sourced with tests that fail if a literal reappears;
  and a new gate compiles every TypeScript block in the documentation.

### Patch Changes

- 23c37aa: Add in-process and mock facilitator composition for payment-path testing.
