# ADR-0012 — Facilitator architecture: Movo owns the service, never the cryptography

- **Status:** Accepted
- **Date:** 2026-08-16
- **Milestone:** M6 (SCF track, gated — §26 decision recorded as BUILD in `docs/context/RFP_COVERAGE_MAP.md`)
- **Supersedes:** nothing. **Related:** ADR-0003 (facilitator composition), ADR-0004 (narrow waist), ADR-0007 (Stellar boundary)

## Context

The SCF RFP requires a production-ready Stellar x402 facilitator on testnet and pubnet, under
a permissive OSI licence, self-hostable and forkable. Two facts shape every decision below.

**The protocol layer already exists and is settled.** `@x402/core` exports `x402Facilitator`;
`@x402/stellar/exact/facilitator` exports an `ExactStellarScheme` that performs auth-entry
validation, simulation, expiry checking, transaction rebuild, signing, fee bumping, submission
and confirmation polling. M2 settled real testnet payments through these objects and Gate 1
recorded the evidence. There is no version of this milestone in which Movo writes verification
or settlement logic.

**The existing production Stellar facilitator cannot be used as a base.** It is built on the
OpenZeppelin Relayer and its x402 plugin, which are AGPL-3.0-or-later. Movo is operated as a
network service, so the AGPL's network clause would extend source obligations to every third
party the service serves. The RFP names this constraint itself (§3.6).

So the question this ADR answers is not "how do we build a facilitator". It is: **given that
the protocol layer is upstream's and the reference implementation is unusable, what is left,
and where does it live?**

## Decision

### 1. Movo owns the service tier and never the cryptography

`packages/facilitator` composes `x402Facilitator` + `ExactStellarScheme` and adds only what a
scheme object is not: a signer pool with channel accounts, balance floors and readiness, caller
authentication, metering, rate limiting, and request/response handling.

| Concern | Owner |
|---|---|
| Auth-entry structure, credential type, expiry ledger bounds, sub-invocation rejection | `@x402/stellar` |
| Simulation, transfer-event matching, the facilitator-safety checks | `@x402/stellar` |
| Transaction rebuild, signing, fee bumping, submission, confirmation polling | `@x402/stellar` |
| Protocol request/response shapes, hooks, `getSupported()` | `@x402/core` |
| Signer pool, channel accounts, balance floors, readiness | `@movoframework/facilitator` |
| HTTP surface, auth, metering, rate limiting, logging | `apps/facilitator` |

This is enforced, not asserted. `pnpm check:protocol-purity` scans `packages/facilitator/src`
and `apps/facilitator/src` for XDR construction and signature handling and fails the build on
either (AC6.10), with proof-of-failure fixtures under
`tests/fixtures/protocol-purity/violating/`.

### 2. No AGPL code is vendored, forked, copied or adapted

The OpenZeppelin Relayer, `relayer-plugin-x402-facilitator` and the Relayer SDK appear nowhere
in this repository's dependency tree, source, or history. Movo may call a hosted facilitator
over HTTP — M2 does exactly that against `https://www.x402.org/facilitator` — because calling a
network service is not linking against it. `pnpm check:licenses` fails the build on any
AGPL/SSPL/GPL package and is run on every dependency added.

Dependencies added by this milestone: `hono` (MIT) and `@hono/node-server` (MIT). Nothing else.

### 3. The facilitator HTTP surface exists in exactly two directories

`packages/facilitator` and `apps/facilitator`. This is the point of the §26 gate: spec v2 §A.2
rule 7 forbids anything that parses or serialises the `verify`/`settle`/`supported` HTTP surface
from shipping before M6, regardless of which package it would live in. M3 removed `asHandler()`
from `createInProcessFacilitator` for this reason. That rule is now discharged for these two
directories and remains in force everywhere else.

### 4. A fourth narrow-waist module, `@movoframework/core/facilitator`

The waist rule stands: only `packages/core/src/protocol/**` imports `@x402/*`. A facilitator
needs `x402Facilitator`, the facilitator-subpath `ExactStellarScheme`, upstream's payload and
requirements schemas, and `createEd25519Signer`.

It reaches them through a **new** waist module rather than through `core/server`, for the same
reason `server.ts` was split off `index.ts`: `core/server` re-exports `@x402/express`, which
imports Express. The facilitator runs on Hono and never calls Express, and a deployment should
not carry a second HTTP framework it does not use. Keeping `createEd25519Signer` off the root
waist is deliberate too — a resource server never needs a seed, and a seed-consuming
constructor on the entry point resource servers import is an invitation.

### 5. An account is a mutex, not a weight — and this was measured, not assumed

This is the decision most likely to be re-litigated by someone who has not run the numbers, so
the numbers are here.

`ExactStellarScheme.settle()` rebuilds the buyer's operation into a new transaction sourced
from a facilitator account, reading that account's sequence number with
`server.getAccount(address)`. Stellar serialises per source account by sequence number.

The first `SignerPool` selected the least-loaded account — a weighted spread. Measured on
testnet with five funded sponsors:

| Concurrent settlements | Settled | Failed |
|---|---|---|
| 5 | 5 | 0 |
| 10 | 5 | 5 |
| 200 | 5 | 195 |

Exactly one settlement per account succeeded. Spreading distributes collisions evenly; it
prevents none of them. So `acquire()` now hands out **one lease per account** and *waits* when
every account is busy. With 25 sponsors, 200 concurrent settlements produce 200 settlements and
zero failures.

The operational consequence is a real constraint and the runbook states it: **pool size is the
concurrency ceiling.** Excess load queues, then times out as `signer_pool_exhausted` — never as
a lost payment. Adding sponsors is a configuration change.

### 6. Non-custody is asserted on the buyer-signed transaction, and the settled transaction is
       the facilitator's by design

Spec §8.2 and AC6.6 require the facilitator address to appear as none of: transaction source,
operation source, transfer `from`, or an address in any authorization entry.

**All four hold on the transaction the buyer signed** — the object the invariant is actually
about, because it is what the buyer authorised. Upstream enforces three of them itself
(`invalid_exact_stellar_payload_unsafe_tx_or_op_source`, `..._facilitator_in_auth`,
`..._facilitator_is_payer`), and Movo asserts all four by test.

**Three of four hold on the settled transaction. The fourth cannot, and must not.** The settled
transaction's source *is* a facilitator sponsor — that is what fee sponsorship means on
Stellar, it is what `areFeesSponsored: true` advertises, and `docs/CONFORMANCE.md` recorded it
as the practical demonstration of sponsorship as far back as Gate 1. A facilitator that was
absent from the settled transaction's source would not be sponsoring the fee.

The spec text is therefore imprecise rather than wrong, and this ADR records the reading the
implementation uses. See the M6 report; it is flagged for a spec amendment.

### 7. Rejections keep the protocol's shape even on 4xx

`HTTPFacilitatorClient` turns a non-2xx response whose body contains `isValid` / `success` into
a typed `VerifyError` / `SettleError` carrying `invalidReason` / `errorReason`, and anything
else into an opaque `Error` with a text excerpt. So a bespoke error envelope would hand callers
a string to regex, and AC6.5's "machine-readable reason" would be true only at this service's
boundary and false at the client's. Every rejection is emitted in the specification's own
response shape, at every status code.

Two reason families, and only one is Movo's: protocol reasons come from `@x402/stellar`
unaltered; transport reasons — for requests that never reach the scheme — are defined once in
`packages/facilitator/src/reasons.ts`.

## Consequences

**Good.** Upstream churn lands in one waist file. The claim "Movo reimplements no protocol
primitive" is checked by CI rather than promised. A self-hoster gets both deployment shapes —
standalone service and in-process self-facilitation — from one composition. Throughput is a
configuration decision (pool size) rather than a code change.

**Accepted costs.** Settlement throughput is bounded by sponsor count; an operator who wants
more concurrency funds more accounts. Rate limiting and metering are in-memory and therefore
per-instance, so a multi-replica deployment must divide limits or put a shared limiter at the
ingress — stated in the runbook rather than hidden. `maxInFlightPerSigner` is configurable and
correct only at 1 on today's network; raising it re-introduces the collisions in §5.

**Deferred.** The `upto` scheme (§24.14, a reasoned phase-2 deferral — it needs
`scheme_upto_stellar.md` authored upstream and likely a Soroban contract). The
scheme-registration extension point stays open: adding a scheme is one `engine.register()` call.

## Alternatives rejected

**Fork the OpenZeppelin Relayer plugin.** AGPL-3.0-or-later, and this service is operated over
a network. Not a judgement call.

**Write our own verify/settle against the Stellar SDK.** This is the reimplementation D1/D4
exist to prevent. Upstream's implementation is the specification's reference behaviour on
Stellar; a second one would diverge on the day it mattered most, and every divergence is a money
bug.

**Give each settlement a freshly created channel account.** Correct in principle and it removes
the pool ceiling, but creating and funding an account per payment is itself a transaction —
paid for, sequenced, and racing on the *funder's* sequence number. It moves the bottleneck
rather than removing it, and it burns XLM in reserves. A fixed pool of long-lived accounts with
a fee-bump signer is the same mechanism without the per-payment cost. `feeBumpSigner` is
supported and documented for operators who want fee payment decoupled from sequencing.

**Reach upstream through `@movoframework/core/server`.** Would have made every facilitator
deployment carry Express. See §4.
