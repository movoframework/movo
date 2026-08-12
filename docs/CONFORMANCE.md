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

## What is not claimed

- **Pubnet.** Nothing here was run against `stellar:pubnet`, and the e2e suite refuses to (AC2.8).
- **Streaming.** Responses behind a paid route do not stream, by construction. See
  `docs/concepts/payment-lifecycle.md`.
- **A stock-client conformance run.** Spec §1.16 layer 4 calls for an unmodified upstream client
  against a Movo app as separate evidence. The e2e buyer already uses stock `@x402/fetch` and
  `@x402/stellar`, which is most of the way there, but the dedicated conformance suite is not
  yet written.
