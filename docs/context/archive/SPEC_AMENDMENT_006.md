# Spec Amendment 006 — `InProcessFacilitator.asHandler()` removed from M3

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md` §5.11, §21 (M3 prompt), §24 (M6)
**Trigger:** M3 not yet started (second stop). Codex correctly identified that
`InProcessFacilitator`'s required `asHandler()` method constitutes the M6 HTTP facilitator
service, built two milestones early and outside the gate.
**Status:** binding — supersedes §5.11 and the M3 prompt where they conflict

---

## What happened

Correct behaviour again: no files changed, no commands run, the conflict named precisely and a
ruling requested rather than assumed. This is a sharper catch than amendment 005's two
conflicts, which were cross-reference bugs between sections that disagreed with each other.
This one is a single section — §5.11 — quietly specifying M6's deliverable inside M3's scope,
where nothing else in the spec disagreed because nothing else in the spec was checking M3
against the M6 gate boundary. The dependency-direction script (`check-track-isolation.ts`)
catches an SCF package being *imported* from the core track; it cannot catch the core track
*reimplementing* what an SCF package is supposed to be. This is a gap in the automated checks,
not only in the prose, and is addressed below.

---

## 1. `asHandler()` is removed from `createInProcessFacilitator`

**THE CONFLICT.** §5.11 specifies:

```ts
export declare function createInProcessFacilitator(o: {
  signer: FacilitatorStellarSigner;
  network: Network;
  allowMainnet?: boolean;
}): FacilitatorClient & { asHandler(): RequestListener };
```

"So tests can exercise the real HTTP path" was the stated reason for `asHandler()`. But the
"real HTTP path" for a facilitator **is** `/verify`, `/settle`, `/supported` request/response
handling — that is the entirety of the facilitator wire contract, not a subset of it. `[FACT]`
`x402Facilitator` exports `register`, `registerV1`, `registerExtension`, `getSupported`,
`verify`, and `settle` as in-process methods; it does not export an HTTP adapter, because
producing one is explicitly M6's job (§8.2, §24), gated behind the SCF decision matrix in §26.
Building `asHandler()` in M3 means building that adapter — deciding request parsing, response
serialisation, status codes, and error-shape mapping for three HTTP endpoints — two milestones
before the gate that is supposed to decide whether Movo builds a facilitator service at all.

**DECISION.** `asHandler()` is deleted from `createInProcessFacilitator`'s return type and from
all M3 scope, tests, and documentation. The corrected signature:

```ts
export declare function createInProcessFacilitator(o: {
  signer: FacilitatorStellarSigner;
  network: Network;
  allowMainnet?: boolean;
}): FacilitatorClient;
```

**WHY THIS LOSES NOTHING M3 ACTUALLY NEEDS.** Every consumer of `InProcessFacilitator`
described anywhere in M3's scope — `withPaidServer`, the nine-scenario matrix, the gated
testnet integration tests — uses it as a `FacilitatorClient` passed directly into
`mountExpress`'s `MountOptions.facilitator` (per amendment 005 §1), in the same process, with
no HTTP hop between the resource server and the facilitator. "Real verification, real
settlement, in-process" is delivered completely by implementing `FacilitatorClient` alone.
Nothing in M3's acceptance criteria (AC3.1–AC3.6) requires an HTTP client to reach the
facilitator; they require real Stellar testnet verification and settlement, which
`FacilitatorClient.verify`/`.settle` already provide.

**WHY THE NARROWER-ADAPTER ALTERNATIVE WAS REJECTED.** There is no smaller version of "an HTTP
surface for verify/settle/supported" than the surface itself — those three routes are the
complete facilitator wire contract per the x402 specification, not a large surface with a
scoped-down subset available. Any HTTP handler exposing them, however minimal its intended call
volume or test-only its intended audience, is the M6 deliverable. Scoping it "narrowly" would
mean implementing the same three routes with less error handling, which is a worse version of
M6's job, built early, outside the gate, without the conformance discipline §24 requires of it
(field-for-field comparison against the reference `/supported` response, the non-custody test,
the licence posture check). None of that discipline applies to a convenience method added to a
testing package, which is exactly how a real facilitator surface would end up existing in the
repository without ever having passed through the gate meant to decide whether it should.

## 2. `withPaidServer` needs no change

§5.11's `withPaidServer(app, { facilitator })` already takes a `FacilitatorClient`, not an
`asHandler()`-based adapter. `InProcessFacilitator` satisfies that parameter directly, both
before and after this amendment. No other M3 API in §5.11 referenced `asHandler()`.

## 3. Gap closed: the isolation check does not catch reimplementation

**OBSERVATION.** `check-track-isolation.ts` (M0) verifies that no core-track package *imports*
an SCF-track package. It has no mechanism to catch a core-track package *reimplementing* what
an SCF-track package is supposed to provide — which is what `asHandler()` would have been.
Import-direction checks and scope-creep checks are different problems, and only the first one
has an automated gate.

**ACTION.** No new automated check is prescribed here — an HTTP-surface-detection linter would
be its own significant undertaking and is out of proportion to one incident. Instead, this is
recorded as a standing review question, alongside the plausible-fake check from amendment 004
§6:

> **Does this feature quietly build an M6/M7 deliverable inside an earlier milestone?**
> Specifically: does any core-track code parse or serialise HTTP request/response bodies for
> `verify`, `settle`, or `supported`? If yes, it is the facilitator service regardless of what
> package it lives in or how small its intended surface is, and it belongs behind the M6 gate,
> not inside M0–M5.

Add this to `CONTRIBUTING.md` alongside the two existing review questions.

## 4. Naming discipline, reaffirmed

§5.11's own text already states the reason `InProcessFacilitator` is named as it is: "it
performs REAL verification and REAL on-chain settlement... docs must state this explicitly so
nobody mistakes it for an offline stub." This amendment does not weaken that. Removing
`asHandler()` does not make `InProcessFacilitator` less real — it remains genuine verification
and genuine settlement against Stellar testnet. It only removes the *transport* option of
reaching it over HTTP, which was never necessary for what M3 does with it.

---

## Resume M3

Apply amendment 005 in full, then this amendment's §1 in place of §5.11's `asHandler()`
requirement. `createInProcessFacilitator` returns `FacilitatorClient` only. No other change to
M3's scope, tests, or acceptance criteria is implied by this amendment.
