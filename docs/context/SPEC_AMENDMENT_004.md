# Spec Amendment 004 — GATE 1 PASSED, post-M2 rulings

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md`, amendments 001–003, the M3–M8 prompts
**Trigger:** M2 complete; `docs/CONFORMANCE.md` filed; transaction
`e05853dac4902d8ceead5bc66fd314be0dc1e3e5a12cb04ed73e09693dd4a048` independently confirmed on
Stellar testnet
**Status:** binding — supersedes the spec and earlier amendments where they conflict

---

## GATE 1 — TECHNICAL VALIDATION: **PASSED**

All §12 Gate 1 evidence requirements are met:

- A real, on-chain-confirmed testnet settlement, fetched independently from Horizon rather than
  asserted from the `PAYMENT-RESPONSE` header alone.
- Invariants I1–I6 pass, each verified against the installed `@x402/express` middleware source
  before being written, so they assert observed behaviour rather than assumed behaviour.
- No XDR construction, signature handling, or `PAYMENT-*` header literal outside tests in
  `@movoframework/server` or `@movoframework/stellar` (AC2.7), and no direct
  `@stellar/stellar-sdk` import in `packages/core` (amendment 003 §1) — both proven by a
  gate with a fitted proof-of-failure test.
- Zero secret leakage across logs and hook payloads under a full paid request with a credential
  present in three places at once (AC2.6).
- AC2.9: the settled asset is real Circle testnet USDC, verified by deriving the Stellar Asset
  Contract id from the issuer address and confirming it is byte-for-byte
  `getUsdcAddress("stellar:testnet")`, not merely by asset-code string match.

Proceed to M3 and M4, which may run in parallel per §11.

---

## 1. I2's rejection reason — location corrected

`[FACT — verified against installed middleware source]` A verification failure produces a 402
with body `{}`. The rejection reason is **not** in the 402 body. It travels in the `error` field
of the **re-issued `PAYMENT-REQUIRED` header**.

**§6.2's invariant table is amended:** I2 reads "Verification failure → 402 with a non-null
reason (in the re-issued `PAYMENT-REQUIRED` header's `error` field, not the response body),
handler not invoked." Any test or doc asserting the reason is in the body is wrong and must be
corrected on sight.

## 2. Q1 re-derived, not re-asserted — settle ordering, upgraded confidence

M0's spike observed settle-after-handler empirically, from one run. M2 re-derived the same
behaviour by reading `@x402/express`'s compiled source directly:

- handler runs first, response buffered
- throw → `cancel("handler_threw")`, buffered output discarded
- `statusCode >= 400` → `cancel("handler_failed")`, buffered body flushed unchanged
- settle failure → `bufferedCalls = []`

This is the source-level confirmation the spike's black-box observation could not provide.
Invariants I3, I4 and I6 stand as written in amendment 001 §1 with no further changes.

## 3. `@x402/express` re-exports — resolved to a subpath, not the main entry

**DECISION.** `@x402/express`-derived exports live at `@movoframework/core/server`, a subpath.
Not on `packages/core`'s main entry.

**WHY.** §3.1 said server-mounting exports reach `@movoframework/server` "via core waist
re-export," without specifying where on `core` they'd sit. Placing them on the main entry would
force every consumer of the pure, network-free config/compiler layer to load an HTTP framework
merely by importing `@movoframework/core`. A subpath keeps `core`'s primary entry genuinely
free of HTTP concerns while satisfying the narrow-waist rule — `@x402/*` imports still live only
under `packages/core/src/protocol/`, now organised as two modules (root, and the `server`
subpath) rather than one file.

**CONSEQUENCE.** §3.1 and any later prompt referencing "core's protocol re-export" should read
this as two entry points sharing the same import boundary, not one flat file. `@movoframework/server`
imports from `@movoframework/core/server`, never from `@x402/express` directly.

## 4. `contract.Client` — accepted as the boundary for on-chain reads

**RULING.** Reading SEP-41 decimals via `contract.Client` (a simulated read, no transaction
built, no signature, no fee) is **not** a protocol-purity violation, and is required to satisfy
"decimals read from the contract, not assumed" at all. `TransactionBuilder` and
`Keypair.fromSecret` remain violations — those construct and sign, which is settlement's job,
not diagnostics'.

ADR-0007's line is confirmed as the standing boundary: **a read that submits nothing and signs
nothing is diagnostics; anything that builds a transaction or touches a key is protocol work**,
forbidden in `@movoframework/{server,stellar}` under D2/D4. `check-protocol-purity`'s existing
allow/deny list is correct as implemented; no change needed.

**Recorded for the record, not for correction:** the first draft of this check stubbed the read
and always returned `"unknown"` — a fake check masquerading as a real one — and was caught and
replaced before merge. See §6 for the general pattern this instance belongs to.

## 5. Narrow-waist exemption for e2e and conformance suites — made explicit

**DECISION.** `tests/e2e/**` and `tests/conformance/**` are exempt from the narrow-waist
`noRestrictedImports` lint rule. `tests/integration/**` is **not** exempt and remains fully
covered, as does everything under `packages/**`.

**WHY.** §1.16 layer 4 defines conformance as driving the Movo stack with an **unmodified
upstream client** — `@x402/fetch`, `@x402/stellar`'s client scheme, `createEd25519Signer`. A
suite acting as a genuine third-party buyer is not part of Movo's internal architecture and is
not bound by the import discipline that protects Movo's own compile-time coupling to `@x402/*`.
Requiring it to funnel through `packages/core/src/protocol/` would be pointless indirection for
code whose entire purpose is to behave exactly like an external consumer.

**CONSEQUENCE.** This exemption must be a named, documented line in the narrow-waist lint
config (a comment, and ideally a scoped override rather than a silent glob), not an
undocumented gap a future contributor discovers by accident. Any M3–M8 prompt instructing an
agent to write e2e or conformance code should state this exemption explicitly rather than
leaving the agent to infer it from a passing lint run.

## 6. Named failure pattern: the plausible fake

Three instances now, across M1 and M2, of the same defect shape:

| Milestone | Instance |
|---|---|
| M1 | `AnyMovoResource` typechecked correctly while the schema variance was backwards |
| M2 | A fabricated `ctx.payment` — real types, empty-string values, would have lied to any handler that read it |
| M2 | The first `contract.Client` decimals check stubbed to always return `"unknown"` |

**The pattern:** something that satisfies its type signature, its test harness, or its lint
rule while being **structurally hollow** — correct-looking, not correct. None of these were
caught by the thing they most resembled passing; they were caught by a stricter downstream
check (a docs compiler, a value-level assertion, a second author's review) or by the author's
own second look.

**This is now a named review question, not just a retrospective observation.** Add to
`CONTRIBUTING.md` alongside the proof-of-failure rule:

> **Does this satisfy its type/test/lint only by being hollow?** A stub, a placeholder, or a
> fixture that typechecks or passes without doing the real thing is a more dangerous defect
> than a missing implementation, because nothing signals its absence. When implementing a
> check against real external state (a network call, a contract read, a signed payload), verify
> the check fails when the real thing is absent — not only that it passes when a plausible
> value is supplied.

## 7. Test-author error, correctly attributed

The AC2.4 preflight test asserted against a stale fixture address while the real `MOVO_PAY_TO`
sat in the environment layer. Per M1's precedence, environment outranks config, so preflight
checked the real seller account and reported `ok`, correctly. The defect was entirely in the
test's model of precedence, not in `resolveConfig` or `preflight`.

**Recorded because the alternative reading is wrong and would be a regression if assumed later:**
this is not evidence that preflight or provenance resolution needs hardening. It is evidence
that they worked exactly as designed under a test that briefly forgot the design. No action
beyond the fix already made.

## 8. Tracked, not blocking: the dedicated stock-client conformance suite

**STATUS: open, tracked for M3 or M8, not a Gate 1 blocker.**

§1.16 layer 4 calls for a conformance suite as evidence distinct from the e2e suite. M2's e2e
buyer already uses stock `@x402/fetch` and `@x402/stellar` — which is most of the way there —
but a dedicated `tests/conformance/` suite exercising the full stock-client path independently,
per the spec's original layer separation, does not yet exist.

**ACTION.** Whichever of M3 or M8 first touches `tests/conformance/` must either write this
suite or explicitly re-scope §1.16 layer 4 to acknowledge that the e2e suite now serves this
purpose. Do not let this drift indefinitely as an unwritten item across multiple milestone
reports — resolve it explicitly once, in writing, in whichever milestone's report next
mentions conformance.

## 9. Amendments to the M3 and M4 prompts

Append to both prompts' `ARCHITECTURE CONSTRAINTS` section:

```text
GATE 1 EVIDENCE — read Spec Amendment 004 before starting
- I2's rejection reason lives in the re-issued PAYMENT-REQUIRED header's `error` field, not
  the 402 response body. Any code or test you write that expects it in the body is wrong.
- Settle-after-handler is confirmed at the source level (amendment 004 §2), not just
  observed empirically. Build against it with full confidence; it is not a candidate for
  reinterpretation.
- @x402/express-derived exports live at @movoframework/core/server, a subpath — never on
  core's main entry, and never imported directly from @x402/express outside that subpath.
- tests/e2e/** and tests/conformance/** are exempt from the narrow-waist lint rule, because
  they act as a genuine third-party buyer using an unmodified upstream client. This must be a
  named, commented exception in the lint config, not an inferred gap. tests/integration/**
  remains fully covered, as does everything under packages/**.
- Before implementing any check against real external state (a network call, a contract
  read, a signed payload, a settled transaction), read amendment 004 §6. Verify the check
  fails when the real thing is genuinely absent, not only that it passes when handed a
  plausible value. A stub that always returns a placeholder is a worse defect than no
  implementation, because its presence gives false confidence.
```
