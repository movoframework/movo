# Spec Amendment 001 — post-M0

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md`
**Trigger:** M0 complete; Gate 1 part A passed; spike report filed
**Status:** binding — amends the spec, does not replace it

Place this file next to the spec in `docs/context/`. Claude Code must read both.

---

## 1. Open questions resolved

### OQ-1 — settle ordering — **RESOLVED**

`[FACT — observed empirically in the M0 spike]` Settlement occurs **after** the handler. Upstream buffers the response and cancels settlement when the handler throws or returns status ≥ 400. A throwing handler returned 500, emitted no `PAYMENT-RESPONSE`, and charged zero.

Consequences, all binding:

1. **Delete the `settlementPolicy` option** from §5.2's `MovoResource`. It was speculative and upstream's behaviour is both correct and not configurable through the surface Movo uses. Do not implement `"before-handler"`.
2. **Invariants I3 and I4 are upstream guarantees.** M2 asserts them; M2 does not build them. This is the compose-don't-wrap thesis confirmed under test.
3. **New invariant I6:** a handler returning a 4xx status is not charged. Add a test. This is a genuine product feature — a paid route that 404s costs the buyer nothing — and it belongs in `docs/concepts/payment-lifecycle.md`, not buried in a test file.
4. **New documented limitation — response buffering.** Upstream holds the entire response until settlement resolves. Therefore: **streaming responses behind a paid route do not stream.** Two required actions:
   - `docs/concepts/payment-lifecycle.md` states this explicitly, with the reason.
   - `§13` compatibility matrix gains a row: *Streaming / SSE / chunked responses behind a paid route — **UNSUPPORTED***.
   - A secondary note: large responses are held in memory pending settlement, so very large paid payloads have a memory profile authors will not expect. Mention it; do not engineer around it in v0.1.0.

### OQ-2 — testnet fee workaround — **RESOLVED: not required**

`[FACT — observed]` Settlement succeeded first try with no `fee: "1"` transaction clone.

- **Delete `stellar.testnetFeeWorkaround` from the config schema in §5.1.**
- **Delete item (D) from the M2 prompt entirely**, including its test.
- Record in `docs/COMPATIBILITY.md` that the workaround described in the official quickstart was not needed against `@x402/*` 2.21.0 and the public testnet facilitator as of this date, so that a future reappearance is recognised as a regression rather than mistaken for a permanent requirement.

### OQ-5 — TypeScript version — **RESOLVED: TypeScript 7.0.2**

Typecheck, lint, build and test all pass under TS 7 with Biome and Vitest 4. Pin it exactly. Revisit only if the Node 22/26 CI matrix contradicts this — see §4 below.

---

## 2. Mount point change — supersedes §5.4 and M2 item (A)

**DECISION:** `@movo/server` mounts via **`paymentMiddlewareFromHTTPServer`**, not `paymentMiddlewareFromConfig`.

**WHY:** `paymentMiddlewareFromConfig` constructs and hides the `x402ResourceServer`, making all seven lifecycle hooks unreachable. §5.4 already promises that `MountResult.server` exposes the raw resource server so consumers can attach upstream hooks, and `movo doctor`'s runtime diagnostics are designed to live on those hooks. The `FromConfig` variant makes both impossible.

**CONSEQUENCE:** `mountExpress` constructs the `x402ResourceServer` itself — facilitator client, scheme registration, extension registration — and passes it to `paymentMiddlewareFromHTTPServer`. This is more explicit code in `@movo/server`, and that is the correct trade: the object Movo needs to expose is the object Movo must construct.

`[VERIFY]` M2 must read `paymentMiddlewareFromHTTPServer`'s exact signature from the installed `.d.mts` before writing against it.

---

## 3. New M2 acceptance criterion — real USDC

The M0 spike settled a self-issued SEP-41 token because Circle's testnet faucet is captcha-gated. That was the right call — do not work around a third party's bot protection. Fee sponsorship generalises (fees are XLM, asset-independent) and the transfer path is identical, so what remains unverified is narrow but real.

**Add to the M2 prompt as AC2.9:**

> AC2.9 The e2e settlement uses the **real Circle testnet USDC contract** returned by `getUsdcAddress("stellar:testnet")` — not a self-issued token. The test asserts three things beyond settlement: that the asset in the settled requirements equals that contract address; that decimals read from the contract equal 7; and that the `trustline` preflight check passes against that asset for the configured `payTo`.

**Human prerequisite, do this before starting M2:** fund a testnet account with real USDC through the Circle faucet and establish trustlines on both the buyer and seller accounts. Claude Code cannot do this and will stall mid-milestone if it is not already done. Put the addresses in `.env` first.

---

## 4. Verification gaps carried forward

| Gap | Action | By |
|---|---|---|
| AC0.1 verified on Node 24 only; 22 and 26 UNVERIFIED | Push to GitHub and let `ci.yml` run once **before starting M1**. A broken workflow or a TS 7 incompatibility on Node 22 is cheap now and expensive at M5. | Before M1 |
| The one package the licence gate warned on is unrecorded | Name it and its licence in the §14 supply-chain matrix. A warning nobody wrote down becomes a warning nobody re-examines. | Before M1 |
| `CODEOWNERS` skipped | Legitimate deferral — there is no maintainer group yet. Tracked here so it does not silently vanish; create it in M8. | M8 |
| pnpm 11.21.0 exists; 10.23.0 installed | `packageManager` pins the installed version, which is correct. Add a §13 row: pnpm 10.x SUPPORTED, 11.x UNTESTED. | M1 |

---

## 5. Governance addition

Add to `CONTRIBUTING.md` and the PR checklist:

> **No gate ships without a proof-of-failure test.** Any check intended to block a merge — lint rule, licence gate, isolation check, redaction assertion — must have a committed fixture that makes it fail, and a test asserting it fails on that fixture. A gate that has never been observed to fail has not been shown to work.

Rationale, from M0: Biome parses `biome.json` as strict JSON and silently truncated the config at an explanatory comment. Lint reported success while the narrow-waist rule was not loaded at all. Only the proof-of-failure test caught it. Config files that accept comments use the `.jsonc` extension.

---

## 6. Amendments to the M1 prompt

The M1 prompt in §19 is unchanged except for two additions. Paste these at the end of its `EXACT SCOPE` section:

```text
BINDING FINDINGS FROM M0 — read docs/SPIKE_REPORT.md and Spec Amendment 001 first
- Do NOT implement a settlementPolicy option on MovoResource. Upstream settles after the
  handler and cancels on throw or on status >= 400. That behaviour is correct, is not
  configurable through the surface Movo uses, and Movo asserts it rather than reimplementing
  or overriding it.
- Do NOT implement stellar.testnetFeeWorkaround in the config schema. The M0 spike proved
  the workaround is unnecessary against the current packages and facilitator.
- Upstream buffers the entire response until settlement resolves. When you write
  docs/concepts/payment-lifecycle.md, state plainly that streaming responses behind a paid
  route do not stream, and why.
```

---

## 7. Amendments to the M2 prompt

Three edits to §20:

1. **Item (A), mount point.** Replace the instruction to use `paymentMiddleware` or `paymentMiddlewareFromConfig` with:

```text
Use paymentMiddlewareFromHTTPServer. The M0 spike established that
paymentMiddlewareFromConfig constructs and HIDES the x402ResourceServer, which makes all
seven lifecycle hooks unreachable — and those hooks are where Movo's runtime diagnostics
are designed to live. @movo/server must construct the x402ResourceServer itself (facilitator
client, scheme registration, extension registration) and pass it in, then expose it on
MountResult.server. Read paymentMiddlewareFromHTTPServer's exact signature from the installed
.d.mts before writing against it.
```

2. **Item (D), fee workaround.** Delete the item and its test entirely. Replace with:

```text
NO FEE WORKAROUND. The M0 spike proved the fee: "1" transaction clone described in the
official Stellar quickstart is not required against @x402/* 2.21.0 and the public testnet
facilitator. Do not implement the flag. Do not add the config field. If settlement
unexpectedly fails in a way that suggests a fee limit, STOP and report it as a regression
rather than reintroducing the workaround silently.
```

3. **Tests.** Add to the integration invariants:

```text
I6 handler returns 4xx -> not charged, no PAYMENT-RESPONSE emitted. Upstream cancels
   settlement on status >= 400. Assert it, and document it in
   docs/concepts/payment-lifecycle.md as a deliberate property: a paid route that 404s
   costs the buyer nothing.
```

and add AC2.9 from §3 above to the acceptance criteria list.
