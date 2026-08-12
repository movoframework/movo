# Spec Amendment 003 — post-M1

**Applies to:** `MOVO_FINAL_ARCHITECTURE_SPEC.md`, amendments 001–002, the M2–M8 prompts
**Trigger:** M1 complete; `@movoframework/core` shipped at 98.94% line coverage; AC1.1–AC1.10 met
**Status:** binding — supersedes the spec and earlier amendments where they conflict

---

## 1. Dependency ruling — `@x402/stellar` in `@movoframework/core`

**DECISION.** `@x402/stellar` is an **allowed runtime dependency of `@movoframework/core`**. §3.1's forbidden-dependency row listing `@stellar/stellar-sdk` for `core` is amended: the SDK may be present **transitively via `@x402/stellar`**, but `core` must never import `@stellar/stellar-sdk` directly.

**WHY.** `[FACT — verified by inspecting the published export map]` `@x402/stellar@2.21.0` exposes exactly four entry points: `.`, `./exact/client`, `./exact/server`, `./exact/facilitator`. `isStellarNetwork`, `validateStellarDestinationAddress` and `getUsdcAddress` are reachable only through the root entry, and that entry imports `ExactStellarScheme` unconditionally, which imports `@stellar/stellar-sdk` at module top level. There is no narrow subpath. The three options were: reimplement the validators (forbidden by D4, and precisely the class of duplication that produces a silent money bug), move config validation to M2 (breaks AC1.3 and AC1.5 and leaves M1's config system unable to validate its own inputs), or accept the dependency.

**The footprint cost is theoretical.** No real Movo application uses `@movoframework/core` without `@movoframework/stellar`, and settlement requires `@x402/stellar` regardless. The SDK is in the install tree of every actual consumer either way.

**CONSEQUENCES.**
- §3.1 `@movoframework/core` — forbidden dependencies now read: *any other `@movoframework/*` package; `express`; direct import of `@stellar/stellar-sdk`.*
- A CI check must assert `core` contains no direct `@stellar/stellar-sdk` import specifier. Add it with a proof-of-failure fixture per amendment 001 §5.
- `[VERIFY]` If a future `@x402/stellar` release adds a validators-only or constants-only subpath, migrate `core` to it and re-narrow the boundary. Record the check in the dependency-bump PR template.

## 2. Accepted deviations from M1

All five stand as implemented. Recorded here so no later milestone "corrects" them back.

| Deviation | Ruling |
|---|---|
| `resolveConfig(layers?: ConfigLayers)` rather than §5.1's `Partial<MovoConfig>` | **Accepted.** A single partial cannot express five precedence layers, and two shapes sharing an `env` key with different meanings would require runtime guessing in a money path. §5.1's signature is amended to match ADR-0006. |
| `MovoConfigInput` fields typed `?: T \| undefined` | **Accepted.** `payTo: process.env["MOVO_PAY_TO"]` must compile under `exactOptionalPropertyTypes`; both alternatives are worse for the reader. |
| `onCompile` receives the live `CompiledApp`, not a redacted copy | **Accepted, and the reasoning is correct.** Redacting would render the handler map as `"[function]"` and make the hook's type a lie. The safety property is asserted directly instead — a fixture seed in the environment appears in zero bytes of the payload. §5.9's blanket "every hook payload passes through `redact()`" is amended: hook payloads carrying live framework objects assert the non-leakage property by test rather than by transformation. |
| Movo narrows `Price` to `` `$${string}` `` where upstream `Money` also accepts `number` | **Accepted.** Deliberate tightening under P3; a bare number in a price field is an invitation to a float bug. Document it in `docs/concepts/resources.md` and note the upstream escape hatch: a caller needing upstream's wider type writes `accepts: PaymentOption[]` directly. |
| `RouteConfig.resource` omitted; upstream fills `url` from the request | **Accepted and required.** `ResourceInfo.url` is mandatory, so a pure compiler cannot construct one. This is the correct boundary. |

## 3. Open question resolved

**§5.5 `[VERIFY]` — can `SkipHandlerDirective` cause a handler to run unverified? — RESOLVED: no.**

`[FACT — from the installed declarations]` `SkipHandlerDirective` is returned by `AfterVerifyHook` and causes the handler to be **skipped**, never to run without verification. `MovoPaymentContext.verified` therefore remains the literal type `true`. No change needed; the invariant holds.

## 4. Known limitations — document, do not silently carry

Three gaps were reported honestly and are accepted as limitations rather than defects. Each must appear in user-facing documentation, not only in a test file.

1. **`MOVO_W_PARAM_UNDESCRIBED` fires only for Zod-shaped schemas.** Standard Schema exposes validation, not introspection, so there is no vendor-neutral way to enumerate parameter descriptions. Already documented in `compilation.md` and ADR-0005. **M4 action:** when Bazaar derivation lands, the same limitation applies to deriving `inputSchema` — surface it there too, and make the explicit `inputSchema` override the documented path for non-Zod users.

2. **Redaction detects opaque credentials by key name only.** A high-entropy string in a field documented to hold a route is indistinguishable from a route. The real control is that `MOVO_FACILITATOR_API_KEY` is never read into config at all — it is reachable only inside the `authHeaders` closure, enforced by `MOVO_E_SECRET_IN_CONFIG`. **Action:** `docs/security/secrets-and-redaction.md` must state this boundary plainly rather than implying redaction is a general secret detector. The property test's split between shape-detectable and key-detectable secrets is the right model; keep it.

3. **Discovery field validation deferred to M4.** Correct per D3. No action.

## 5. Carried-forward items — status

| Item | Status |
|---|---|
| AC0.1 Node 22/24/26 | **CLOSED** — green on `main` |
| `spawndamnit@3.0.1` licence | **CLOSED** — MIT by LICENSE inspection, non-SPDX declaration, dev-only via `@changesets/cli`, recorded in §14 |
| pnpm 11.x, streaming-unsupported rows | **CLOSED** — added to §13 |
| `CODEOWNERS` | Still deferred to M8 |
| Real Circle USDC + trustlines on buyer and seller | **OPEN — blocks M2 AC2.9.** Human step; the faucet is captcha-gated. Do this before starting M2. |

## 6. Additions to the M2 prompt

Append to `ARCHITECTURE CONSTRAINTS`:

```text
DEPENDENCY BOUNDARY (amendment 003 §1)
@movoframework/core now depends on @x402/stellar, because the validators and constants it
needs are reachable only through that package's root entry, which pulls @stellar/stellar-sdk
transitively. That is accepted. What is NOT accepted: any direct import of
@stellar/stellar-sdk from packages/core. @movoframework/stellar may import the SDK directly —
it is the diagnostics package and preflight needs Horizon and RPC clients.
Add a CI check asserting packages/core contains no direct @stellar/stellar-sdk import
specifier, with a proof-of-failure fixture.

CONSTANTS (amendment 003 §1, and the M1 single-source rule)
Do not define Stellar network identifiers, USDC addresses, decimals, passphrases, RPC URLs,
address validators or amount converters. Import every one from @x402/stellar. M1 established
the pattern with EXACT_SCHEME asserted against `new ExactStellarScheme().scheme`; apply the
same discipline to anything you are tempted to write down twice.
```

Append to the `TESTS REQUIRED` section:

```text
Preflight checks must return findings and never throw for a negative result. In addition to
the negative cases already specified, assert the POSITIVE baseline: a correctly funded
account with a valid trustline returns level "ok" from every check. M1 showed that a suite
of negative-only tests can pass while the ordinary case is broken — the AnyMovoResource
variance defect broke defineApp for resources with differing input types, and every existing
test happened to use compatibly-inferring resources. Test the ordinary case explicitly.
```
