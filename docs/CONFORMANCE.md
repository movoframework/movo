# Conformance evidence

Evidence, not intent. Every claim on this page has an artefact behind it that can be checked by
someone who did not run it.

## GATE 1 — a real settled payment on Stellar testnet

Produced by `MOVO_E2E=1 pnpm test:e2e` against `tests/e2e/settlement.test.ts`, driving the Movo
stack end to end and confirming the result from Horizon directly.

| Field | Value |
|---|---|
| **Transaction hash** | `e05853dac4902d8ceead5bc66fd314be0dc1e3e5a12cb04ed73e09693dd4a048` |
| Successful | `true` |
| Ledger | `4101310` |
| Closed at | `2026-08-12T09:41:54Z` |
| Network | `stellar:testnet` |
| Operation | `invoke_host_function` → `InvokeContract(Address, Sym, Address, Address, I128)` — a SEP-41 `transfer` |
| Asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` — Circle testnet USDC, the contract `getUsdcAddress("stellar:testnet")` returns |
| Amount | `10000` base units (7 decimals, so `$0.001`) |
| `payTo` (seller) | `GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM` |
| Buyer | `GCX3VGY6ND44NV5WC7S4XSBEY3MX2VPMTB7A4ZWKZPMP67JI7MZLP77W` |
| Transaction source (fee payer) | `GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K` — **the facilitator**, not the buyer |
| Fee charged | 23,073 stroops, paid by the facilitator |
| Facilitator | `https://www.x402.org/facilitator` (free, keyless) |

Each `MOVO_E2E=1 pnpm test:e2e` run settles a new payment; the transaction below is the one
inspected in full for this record. The most recent run at the time of writing settled
`806d1056e00247fca973b92123ad55bebb03826bf6162635b4946c1e49056ba5` at ledger 4101690.

Verify independently:

```
https://horizon-testnet.stellar.org/transactions/e05853dac4902d8ceead5bc66fd314be0dc1e3e5a12cb04ed73e09693dd4a048
```

**The transaction source being the facilitator's rather than the buyer's is the practical
demonstration of `areFeesSponsored: true`.** The buyer paid the asset amount and none of the
network fee.

### Why the on-chain fetch is the point

The test does not assert on the `PAYMENT-RESPONSE` header and stop. It takes the transaction
reference from that header and fetches the transaction from Horizon — a source that is neither
the server under test nor the facilitator that reported success — and asserts `successful: true`.

Asserting only on the header would let a fabricated or mocked settlement pass, which is exactly
the class of evidence the specification prohibits (§11.3). A mocked settlement presented as proof
that settlement works is not admissible here.

### AC2.9 — the asset is real Circle USDC

The M0 spike settled a self-issued token because Circle's faucet is captcha-gated. That gap is
now closed. The e2e suite asserts three things beyond settlement:

- the asset in the settled requirements equals `getUsdcAddress("stellar:testnet")`;
- decimals **read from the contract** equal 7;
- the `trustline` preflight passes against that asset for the configured `payTo`.

The trustline's issuer was verified by derivation rather than by trust: `USDC` issued by
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` produces the Stellar Asset Contract
id `CBIELTK6…DAMA`, which is byte-for-byte the contract upstream returns.

## Ordering invariants

`tests/integration/payment-invariants.test.ts`, run in PR CI with no network. The real Express
middleware and the real `x402ResourceServer`; only the facilitator is a stub.

| # | Invariant | Asserted by |
|---|---|---|
| I1 | No `PAYMENT-SIGNATURE` → 402, handler not invoked | handler spy, `verify` and `settle` call counts both 0 |
| I2 | Verification failure → 402 with a non-null reason, handler not invoked | reason decoded from the re-issued `PAYMENT-REQUIRED` header |
| I3 | Handler throws → error status, **`settle` called zero times** | `countOf("settle") === 0` |
| I4 | Settlement failure → 402, handler's return value **absent** from the body | response body asserted not to contain the handler's output |
| I5 | Success → 200 with `PAYMENT-RESPONSE` carrying a transaction reference | header decoded via `@x402/core/http` |
| I6 | Handler returns 4xx → not charged, no `PAYMENT-RESPONSE` | `countOf("settle") === 0`, buffered 4xx body flushed unchanged |

Each was verified against the installed middleware source before being written, so they assert
what upstream **does** rather than what the specification hoped it would.

**I2's reason is not where the invariant's wording suggests.** The 402 body is `{}`; the reason
travels in the re-issued `PAYMENT-REQUIRED` header's `error` field. That is upstream's actual
behaviour and the test asserts it, rather than asserting a shape that would have to be built to
be true.

## Protocol purity

`pnpm check:protocol-purity`, proven to fire by `tests/unit/check-protocol-purity.test.ts`.

- `@movoframework/server` and `@movoframework/stellar` contain no XDR construction, no signature
  handling, and no `PAYMENT-*` header literals outside tests (AC2.7).
- `packages/core` contains no direct `@stellar/stellar-sdk` import (Spec Amendment 003 §1).

## Secrets

`tests/integration/log-capture.test.ts` drives a complete paid request with a credential present
in the environment, in an `authHeaders` provider and in the resolved configuration, logs the
resolved config and the incoming headers at `debug`, and asserts zero occurrences of the fixture
seed, the API key and the encoded payment payload across every log record and every hook payload
(AC2.6).

## M6 — the Movo facilitator, on Stellar testnet

Produced by `MOVO_E2E=1 pnpm vitest run --project e2e tests/e2e/facilitator-settlement.test.ts`
against `apps/facilitator` running locally, with a Movo resource server pointed at it over HTTP.
Every hash below was submitted by the Movo facilitator and confirmed from Horizon directly.

### AC6.1 — an unmodified stock client completes a payment

The buyer is built from stock `@x402/fetch`, `@x402/stellar/exact/client` and
`createEd25519Signer`, under the narrow-waist buyer-side exemption. Nothing Movo-shaped touches
it.

| Field | Value |
|---|---|
| **Transaction hash** | `5cf022788bb26d102b49f9f979a098f30207a0f4ee03ec8be85923a0b12ceb44` |
| Successful | `true` |
| Ledger | `4165405` |
| Network | `stellar:testnet` |
| Scheme | `exact` |
| Transaction source (fee payer) | `GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV` — a Movo facilitator sponsor |
| Fee charged | 22,973 stroops, paid by the facilitator |
| Facilitator | `apps/facilitator`, local, `@movoframework/facilitator` |

```
https://horizon-testnet.stellar.org/transactions/5cf022788bb26d102b49f9f979a098f30207a0f4ee03ec8be85923a0b12ceb44
```

### AC6.12 — self-facilitation inside a resource server

The same stock client, against a resource server that settles its own payments in-process via
`createFacilitator(...).asFacilitatorClient()`. No standalone service, no HTTP hop.

| Field | Value |
|---|---|
| **Transaction hash** | `2bf8cc6980a7195c5309c0b61b29a45469d390aa9da2a1c81a65d29861efd01e` |
| Successful | `true` |
| Ledger | `4165413` |

### AC6.3 — `/supported` against the public reference facilitator

Compared field for field against `https://www.x402.org/facilitator/supported`, live, in the
same test run. The `stellar:testnet` / `exact` entries are byte-identical:

```json
ours:      {"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}
reference: {"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}
```

The `signers` block is deployment-specific by construction — it lists this deployment's own
sponsors under the `stellar:*` CAIP family, as the reference lists its own — so it is asserted
structurally rather than for equality.

### AC6.5 — every rejection carries a non-null, machine-readable reason

Five scenarios driven against the live service over HTTP. Each signature is **genuine**; only
the requirements it commits to differ, so every rejection comes from real verification rather
than from a malformed payload.

| Scenario | Reason returned |
|---|---|
| Amount tampered (signed for 1 stroop, checked against the advertised price) | `invalid_exact_stellar_payload_wrong_amount` |
| Wrong network | `unsupported_network` |
| Wrong asset | `invalid_exact_stellar_payload_wrong_asset` |
| Wrong recipient | `invalid_exact_stellar_payload_wrong_recipient` |
| Replayed after settling | `invalid_exact_stellar_payload_simulation_failed` |

Four of the five come from `@x402/stellar` unaltered. `unsupported_network` is a Movo transport
reason — the deployment has no signer for that network, so the payment never reached the scheme.
The service-tier reasons are enumerated from a single exported constant in
`packages/facilitator/src/reasons.ts` and asserted in `packages/facilitator/src/facilitator.test.ts`.

### AC6.6 — non-custody

Asserted against **two** transactions, and the distinction matters.

On the transaction the **buyer signed** — the object the invariant is about, because it is what
the buyer authorised — all four forbidden positions hold:

| Position | Value | Facilitator? |
|---|---|---|
| Transaction source | `GAAAAAAA…AWHF` | no |
| Operation source | inherits the transaction | no |
| Transfer `from` | `GCX3VGY6ND44NV5WC7S4XSBEY3MX2VPMTB7A4ZWKZPMP67JI7MZLP77W` (buyer) | no |
| Transfer `to` | `GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM` (seller) | no |
| Authorization entries | buyer only | absent |

On the **settled** transaction (`d176538dce1c5006a19b48a21b402a3f95ee066fdf209283c14d71f91c48449d`,
ledger 4165411), three of four hold — operation source, transfer `from`, and authorization
entries are all free of the facilitator.

**The fourth cannot hold, and must not.** The settled transaction's source *is* a facilitator
sponsor. `ExactStellarScheme.settle()` rebuilds the buyer's operation into a new transaction
sourced from a facilitator account, because paying the fee from the facilitator's account is what
fee sponsorship *is* on Stellar. This document recorded the same fact at Gate 1, before M6
existed: "the transaction source being the facilitator's rather than the buyer's is the practical
demonstration of `areFeesSponsored: true`."

Spec §8.2 and AC6.6 state all four positions over "any settled payment" without drawing that
distinction. The text is imprecise rather than wrong, and it is flagged for amendment. See
[ADR-0012](adr/0012-facilitator-architecture.md) §6.

### AC6.8 — 200 concurrent settlements, zero failures

| Sponsors | Concurrent settlements | Settled | Failed |
|---|---|---|---|
| 25 | 200 | **200** | **0** |

This number was arrived at by fixing a real defect, and the intermediate measurements are kept
here because they are the evidence for why the pool works the way it does. Against the first
implementation — which spread load across accounts by picking the least-loaded one — with five
sponsors:

| Concurrent settlements | Settled | Failed |
|---|---|---|
| 5 | 5 | 0 |
| 10 | 5 | 5 |
| 200 | 5 | 195 |

Exactly one settlement per account succeeded, because two settlements reading one account read
the same sequence number. Spreading distributes collisions; only exclusivity prevents them. The
pool now leases one account at a time and queues the rest.

**The first version of this test asserted the wrong thing.** It searched the returned reason
strings for `/seq/` and asserted none matched — and it passed while 190 of 200 settlements
failed, because upstream maps every non-PENDING submission onto the single opaque reason
`settle_exact_stellar_transaction_submission_failed`. A gate that greps that vocabulary for the
word "sequence" can never fire. The assertion is now the settled **count**, which is the only
observable that distinguishes a pool that serialises from one that does not.

### AC6.4 — the x402 repository's own e2e suite, against the Movo facilitator

**This is the RFP's literal acceptance mechanism (§3.6): reviewers point stock SDK code at the
deliverable rather than read a conformance claim.**

The x402 repository was cloned at `main`, its e2e workspace installed, and its packages built.
The Movo facilitator was registered as an **external facilitator proxy** — the mechanism
upstream provides for exactly this (`e2e/facilitators/external-proxies/`, "bridges between the
test suite and external services"). The proxy forwards `/verify`, `/settle` and `/supported` to
`apps/facilitator` and interprets nothing.

Everything else in the run is upstream's: upstream's clients, upstream's resource servers,
upstream's payment requirements, upstream's assertions. Note that the harness resolves
`@x402/*` at **2.22.0** from its own workspace, while Movo pins 2.21.0 — so this is a stock
client one minor version *ahead* of the pin paying through the service.

```
pnpm test --testnet --facilitators=movo \
  --servers=typescript/http/express,typescript/http/fastify,typescript/http/hono,typescript/mcp
```

| # | Client | Server | Endpoint | Result | Transaction |
|---|---|---|---|---|---|
| 1 | axios | express | `/exact/stellar` | ✅ | `2c3ed138ee7636b662354922ded6a18a7063ad9f3293858175557e8694caf47f` |
| 2 | fetch | express | `/exact/stellar` | ✅ | `da6febcf4323e7993fdf1017ae4b229bd3cc675da2172f2b6f4e394d795b227f` |
| 3 | axios | fastify | `/exact/stellar` | ✅ | `adf7cb7aca1f0d1cf96eb8644d5e7aa7a8f9e904d2c4fbfc1dc91224495efa6a` |
| 4 | fetch | fastify | `/exact/stellar` | ✅ | `f4dfad6fc7ad88b57af43d3d5bf29470c943af8a0d3ef3f2a4959d9c6faa79dd` |
| 5 | axios | hono | `/exact/stellar` | ✅ | `b460834a0c0c52651903f79560f08ef170dea4073685b8bdd09a7ae28176ef0f` |
| 6 | fetch | hono | `/exact/stellar` | ✅ | `9f02b1753461688ef69bfebf6a3d431b450336843145026a49ace9173f9eecbd` |
| 7 | mcp | mcp | `exact_stellar` | ✅ | `d3d3a84bb69e1c5b757a4a2e17ec52a6b0ad2d50839b87e4018128a16b035ccd` |

```
📊 Breakdown by Facilitator:
 movo            ✅ 7 / ❌ 0 (100%)
```

Both HTTP clients, three HTTP frameworks, and the **MCP transport**, all settling real testnet
payments through the Movo facilitator. Spot-checked from Horizon: #1 ledger 4166178, #5 ledger
4166210, #7 ledger 4166226, all `successful: true`, all sourced from a Movo sponsor.

**Two scenarios were not run, and neither reflects on the facilitator.**

- The `typescript/http/next` server (2 scenarios) could not be built in this environment. Its
  Turbopack build aborts with `path length … exceeds max length of filesystem` — a Windows
  `MAX_PATH` limit hit by the checkout's directory depth, before any payment code executes. The
  same `/exact/stellar` route is covered by three other HTTP frameworks.
- **Pubnet (the other half of AC6.4) is UNVERIFIED**, for the reason given under AC6.2.

**Two modifications were made to the checked-out harness, and both are disclosed because the
value of this evidence depends on the suite being unmodified:**

1. `e2e/src/proxy-base.ts` — added `shell: process.platform === 'win32'` to the two `spawn`
   calls. Without it every component fails with `spawn pnpm ENOENT` on Windows. It touches no
   protocol code, no assertion and no payment path.
2. `e2e/.env` — `CLIENT_EVM_PRIVATE_KEY` and `CLIENT_SVM_PRIVATE_KEY` set to freshly generated,
   unfunded throwaway keys. The harness's TypeScript client constructs EVM and Solana signers
   unconditionally at startup regardless of which family a scenario uses, so it cannot reach the
   Stellar path without them. Neither chain is touched by these scenarios.

Neither change alters what the suite asserts about the facilitator.

### AC6.9 — readiness fails below the sponsor floor

`/ready` reads real sponsor balances from Horizon. With the configured floor it returns 200 and
`ready: true`; with the floor raised above the sponsors' actual balances it returns **503** and
`ready: false`. A balance that could not be read is treated as failing, not as passing.

### Exit gate — the Docker image builds and runs from the README alone

Built and run using nothing but the two commands in `apps/facilitator/README.md`:

```
docker build -t movo-facilitator -f apps/facilitator/Dockerfile .   # → 430MB, non-root
docker run -p 8402:8402 -e MOVO_FACILITATOR_NETWORKS=stellar:testnet \
  -e MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS="$SEED" movo-facilitator
```

```
/health    {"status":"ok","version":"0.0.0","networks":["stellar:testnet"]}
/supported {"kinds":[{"x402Version":2,"scheme":"exact","network":"stellar:testnet",
                     "extra":{"areFeesSponsored":true}}],
            "extensions":[],"signers":{"stellar:*":["GBVMPGDR…","GD3V7LHL…","GDWZI5JI…"]}}
/ready     200
```

`/ready` returning 200 means the container read its sponsors' real balances from Horizon from
inside the image, not that it skipped the check.

Then the upstream e2e suite was pointed at the **container** and a stock `@x402/fetch` client
completed a payment through it:

| Field | Value |
|---|---|
| **Transaction hash** | `0cc0ea98a1d96350cfff778b06eaeb031394483a8f76b8e19f8adfc2e67c98c8` |
| Successful | `true` |
| Ledger | `4166513` |
| Source (fee payer) | `GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV` |
| Fee | 22,973 stroops |

### AC6.7 / AC6.10 — licence and protocol purity

`pnpm check:licenses`: 303 packages inspected, **0 prohibited**, 1 warned (`spawndamnit`,
`SEE LICENSE IN LICENSE`), 0 undeclared. No AGPL, SSPL or GPL anywhere in the tree. The two
dependencies M6 adds — `hono` and `@hono/node-server` — are both MIT.

`pnpm check:protocol-purity`: `packages/facilitator/src` and `apps/facilitator/src` are scanned
for XDR construction and signature handling under the same rules as `packages/server` and
`packages/stellar`, and both are clean. Proven to fire by
`tests/unit/check-protocol-purity.test.ts` against fixtures that construct a transaction and call
`Keypair.fromSecret` in each of those directories.

## M7 — catalog, discovery and MCP, on Stellar testnet

Added in the pre-M8 cleanup (§E.6): the evidence existed in commit `129d707` and in the PR body
for `feat/m7-catalog-discovery`, but this page had no M7 section, so the criteria were provable
only by reading git history.

**Two independent runs are recorded, not one.** Both are genuine and both were re-confirmed from
Horizon while writing this section. A single pair of hashes proves a payment settled once; two
pairs produced by separate runs of the same suite show the path is repeatable rather than a
result that happened to survive one execution.

### Run 1 — recorded in the commit message of `129d707`

| AC | Transaction hash | Ledger | Successful |
|---|---|---|---|
| AC7.1 / AC7.3 — a paid request makes the endpoint findable | `afb403aa97eec22258b24bbea669e80c51f3ecab324f37e430133af5c7ce60b3` | 4172914 | `true` |
| AC7.8 — an MCP agent discovers, selects and pays | `67171cdf40cae0d78e42d650abe959e66e1a19915242714b1b4ef082902c91ce` | 4172916 | `true` |

### Run 2 — recorded in the pull-request body for `feat/m7-catalog-discovery`

| AC | Transaction hash | Ledger | Successful |
|---|---|---|---|
| AC7.1 / AC7.3 | `e3270f26d880bef1c39da028c160e36163e3ce6529afa4b94c3ccb033fe98b2e` | 4173264 | `true` |
| AC7.8 (MCP agent) | `06b1de095ace91f65f7ea16ae2f6e287efc0dfcd1083962d9b4239bb2b64c130` | 4173266 | `true` |

All four were submitted by a Movo facilitator sponsor
(`GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV`) and are confirmable independently:

```
https://horizon-testnet.stellar.org/transactions/afb403aa97eec22258b24bbea669e80c51f3ecab324f37e430133af5c7ce60b3
https://horizon-testnet.stellar.org/transactions/67171cdf40cae0d78e42d650abe959e66e1a19915242714b1b4ef082902c91ce
https://horizon-testnet.stellar.org/transactions/e3270f26d880bef1c39da028c160e36163e3ce6529afa4b94c3ccb033fe98b2e
https://horizon-testnet.stellar.org/transactions/06b1de095ace91f65f7ea16ae2f6e287efc0dfcd1083962d9b4239bb2b64c130
```

**MCP payment execution is verified on testnet** — AC7.8 above is an agent that discovered a
resource through `bazaar.search`, selected it, and paid for it through `bazaar.paidCall`. Stated
plainly, and with its ceiling stated too: verified *on testnet*, which is not a claim about
production (§E.2).

### AC7.9 — a refused payment produces no signature

Asserted two ways rather than one: a signer spy records zero calls, **and** the buyer's budget is
read after the refusal. The second assertion exists because of the §D.1 `maxTotalSpend` defect —
a budget that is never credited looks identical to a budget that refused correctly if you only
ask whether a signature was produced.

### AC7.10 — the same suite against both backends, and now in CI

`tests/integration/catalog-store-parity.test.ts` and `tests/integration/discovery-catalog.test.ts`
run every case against SQLite and against Postgres. The first execution against real Postgres
found the `list()` extensions filter built as `"extensions ? ?"`, whose placeholder rewrite ate
the jsonb operator — a syntax error on every filtered query, in code that typechecked and had
never run. Fixed to `jsonb_exists`.

Until the pre-M8 cleanup, CI had no Postgres, so half of AC7.10 skipped: **30 passed, 30 skipped**
on every PR. `.github/workflows/ci.yml` now runs a `postgres:17-alpine` service container and the
same command reports **60 passed, 0 skipped**. A skipped test is not a passing test, and the
regression back to skipping is now itself a failure — `tests/unit/catalog-postgres-ci.test.ts`
fails the job if `MOVO_CATALOG_TEST_POSTGRES_URL` is ever unset while `CI` is set.

### Search quality, and the floor that now runs

`pnpm test:search-eval` measures nDCG@10 and recall@20 over 55 labelled resources and 114
queries. The floors existed from M7 but no workflow ran them, so the ranker could regress in
silence. `.github/workflows/ci.yml` now runs the lexical-only configuration as a required check:

```
search eval — lexical-only
  nDCG@10:        0.8524   (floor 0.55)
  recall@20:      0.8711   (floor 0.75)
```

The gate ships with its proof of failure. `pnpm test:search-eval:proof` re-runs the identical
stack with the fused ranking reversed and passes only when the floors reject it:

```
search eval — lexical-only [DEGRADED FIXTURE]
  nDCG@10:        0.3298   (floor 0.55)
search eval FAILED: lexical-only [DEGRADED FIXTURE] nDCG@10 0.3298 is below the floor 0.55.
proof-of-failure PASSED: the degraded ranking was rejected by its floors.
```

The hybrid floors (0.70 / 0.90) — the numbers `docs/discovery/search-quality.md` publishes — run
in the Conformance workflow rather than the PR gate, because that configuration downloads the
MiniLM weights on first run and a required check must not depend on a third party's CDN.

## Evidence alignment (§E.4)

Three criteria whose implementations were correct but whose evidence did not stand on its own.

### AC0.7 — the spike branch is deleted, and no spike code is on `main`

Not re-run, because the branch is gone and re-creating one would prove nothing about the one that
existed. What survives is checkable by anyone with the remote:

- `git ls-remote --heads origin` lists twelve branches — `main`, nine milestone branches and two
  `chore/*` — and **no `spike/*` branch**. `spike/x402-stellar-e2e` (spec §10, M0) is absent.
- `git ls-tree -r --name-only HEAD | grep -i spike` returns exactly one path: `docs/SPIKE_REPORT.md`.
  The report is on `main`; no spike *code* is.
- The report itself was added by `513aac3` (*"docs: M0 spike report — confirmed Stellar testnet
  settlement"*), a single-file commit touching `docs/SPIKE_REPORT.md` and nothing else.

### AC3.3 — a replayed payload is rejected on its second use

Previously asserted as `expect(errorReason).toBeTruthy()`, which is true of every rejection this
service can produce and could not have distinguished replay protection from any other failure —
nor caught a reason-collapse (§D.1). Now pinned by name, against a live run:

| Scenario | Reason |
|---|---|
| **Replayed after settling** | **`invalid_exact_stellar_payload_simulation_failed`** |
| Tampered amount | `invalid_exact_stellar_payload_wrong_amount` |
| Wrong network | `unsupported_network` |
| Wrong asset | `invalid_exact_stellar_payload_wrong_asset` |
| Wrong recipient | `invalid_exact_stellar_payload_wrong_recipient` |

Produced by `MOVO_E2E=1 pnpm vitest run --project e2e tests/e2e/facilitator-settlement.test.ts -t
"AC6.5"` against the live service, 7 passed. The reason is a single exported constant
(`REPLAYED_REJECTION_REASON` in `@movoframework/testing`) so the assertion and this table cannot
drift apart, and a named test asserts the replay reason is one no other scenario returns.

### AC4.7 — the four-concept table

The doc was never missing; the AC named a path that has never existed. §10's M4 criterion read
`docs/concepts/discovery.md`, while §17, the §22 M4 prompt, the §31 checklist and
`docs/quickstart.md` all name `docs/bazaar/overview.md`, which is where the four-concept table
and the non-promise statement have always been. The AC was corrected to match the other four
call sites rather than the doc moved to match the outlier.

## What is not claimed

- **AC6.2 — pubnet: UNVERIFIED.** Nothing in M6 was run against `stellar:pubnet`. No funded
  pubnet sponsor account exists and no key-management story is in place, and the milestone
  prompt is explicit that inventing a pubnet result is prohibited. The code path is
  configuration-identical to testnet and refuses to start on pubnet without an explicit Soroban
  RPC URL. What pubnet needs is listed in the M6 report: funded sponsors, a KMS/HSM signer
  integration, an RPC provider agreement, and the Audit Bank review that gates the production
  tag (§16a).
- **AC6.11 — `__check_auth` smart accounts: UNVERIFIED, but not blocked upstream.**

  AC6.11 requires verifying from the installed `@x402/stellar` declarations whether the
  facilitator scheme accepts smart-account signers *before* assuming it, and reporting an
  upstream gap rather than reimplementing auth-entry validation if it does not. That check was
  done, and **upstream accepts them**. Three findings, read from
  `node_modules/@x402/stellar/dist/esm/`:

  1. `ExactStellarScheme.validateAuthEntries` rejects only credentials that are not
     `xdr.SorobanCredentialsType.sorobanCredentialsAddress()`. An address credential carries an
     `ScAddress`, which is either an account (`G…`) or a **contract** (`C…`). A `__check_auth`
     contract account therefore passes the credential-type check; nothing narrows it to
     ed25519 accounts.
  2. `gatherAuthEntrySignatureStatus` (in `chunk-4HPDVFME.mjs`) decides "signed" by testing that
     the credential's signature `ScVal` is not `scvVoid`. It is indifferent to the shape of the
     signature and to the address type, so a smart account's custom signature payload counts as
     signed exactly as an ed25519 signature does.
  3. The `ClientStellarSigner` declaration states in terms that it "supports both classic (G) and
     contract (C) accounts".

  So there is no upstream gap to report and no reason to STOP. What is missing is the *live*
  half of the criterion: a payment completed on testnet by a stock client backed by a deployed
  `__check_auth` contract account, with an on-chain hash. Producing one requires authoring and
  deploying a custom account contract (Rust → `wasm32` → Soroban deploy). The Rust toolchain is
  present in this environment but the Stellar CLI and the `wasm32` target are not, and
  fabricating the result is prohibited. **Movo's own code needs no change for this**: the
  facilitator never inspects credential types, so whatever upstream accepts, this service
  accepts. Closing it is a fixture task, not an implementation task.

  **Re-verified in the pre-M8 cleanup (§E.5), from the installed declarations rather than from
  the earlier report.** `node_modules/@x402/stellar/dist/esm/signer-F5n-6Pce.d.mts` states of
  `ClientStellarSigner`: *"Supports both classic (G) and contract (C) accounts"*, and
  `chunk-4HPDVFME.mjs` still classifies an auth entry by `sorobanCredentialsAddress()` alone —
  `Address.fromScAddress(...)`, which resolves `C…` as readily as `G…`, then `signature.switch()
  .name !== "scvVoid"` for signed-ness. Nothing narrows either to ed25519. The upstream finding
  stands and there is still nothing to report upstream.

  **The live half remains blocked on toolchain, not on code.** Producing the evidence needs a
  `__check_auth` custom-account contract authored in Rust, built to `wasm32v1-none`, deployed to
  testnet with the Stellar CLI, and then paid through by a stock client. This environment has
  `rustup` and `cargo` but `rustup target list --installed` returns only
  `x86_64-pc-windows-msvc`, and `stellar` is not on `PATH`. Fabricating a hash is prohibited, so
  this stays **UNVERIFIED**. What would close it: `cargo install --locked stellar-cli`,
  `rustup target add wasm32v1-none`, a funded testnet deployer account, and one payment recorded
  with its Horizon-confirmed hash.
- **AC6.4 on pubnet: UNVERIFIED.** The testnet half passed 7/7 (above). The pubnet half needs
  the same prerequisites as AC6.2.
- **Pubnet (core track).** Nothing in M2 was run against `stellar:pubnet` either, and the M2 e2e
  suite refuses to (AC2.8).
- **Streaming.** Responses behind a paid route do not stream, by construction. See
  `docs/concepts/payment-lifecycle.md`.
- **A dedicated stock-client conformance suite — deferred to M8, deliberately and in writing.**

  Spec §1.16 layer 4 calls for an unmodified upstream client against a Movo app as evidence
  distinct from the e2e suite. Amendment 004 §8 left this open; amendment 008 §7 required M5 or
  M8 to either write it or re-scope it explicitly, rather than let it drift across another
  milestone report. **This is that explicit resolution: it is not re-scoped, and it is not
  written. It is assigned to M8.**

  The reasoning, so the decision can be argued with rather than merely found. The evidentiary
  value of layer 4 is that the buyer is genuinely third-party — `tests/e2e/settlement.test.ts`
  already builds its buyer from stock `@x402/fetch`, stock `@x402/stellar` and
  `createEd25519Signer`, importing them directly under the narrow-waist exemption (amendment 004
  §5), so the *client* half of the requirement is met today. What is missing is the separation:
  one suite currently serves as both Movo's own end-to-end test and its interoperability
  evidence, and a suite that fails cannot tell you which of the two claims it just falsified.

  Writing it at M5 would have produced a second copy of the same buyer against the same server,
  which is duplication rather than evidence. It becomes real evidence at M8, where GATE 3
  requires a settled transaction hash **per supported network per scheme** — at that point the
  suite has a matrix to cover that the e2e suite does not, and the separation earns its keep.

  Until then this document does not claim layer 4 is satisfied. `tests/conformance/` holds one
  file (`supported.test.ts`, the live `/supported` shape check), and that is the whole of it.
