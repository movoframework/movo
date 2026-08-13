/**
 * THE NARROW WAIST — server half.
 *
 * Same rule as `./index.ts`, same directory, separate module. This file carries the pieces that
 * only a *mounted* Movo app needs: the resource server, the facilitator client, the Stellar
 * scheme server, and the Express middleware.
 *
 * **Why it is a separate module rather than more exports on `index.ts`.** `@x402/express`
 * imports `express`, and `@x402/stellar/exact/server` pulls the Stellar SDK. If those were
 * re-exported from the package's main entry, then importing `@movoframework/core` — a package
 * whose defining property is that it is pure and network-free — would load an HTTP framework.
 * Splitting them means `@movoframework/core` stays what it claims to be, and the code that
 * needs a server reaches for `@movoframework/core/server` explicitly.
 *
 * **Why it is still inside `packages/core/src/protocol/`.** Spec §3.1 says `@movoframework/server`
 * takes `@x402/express` *via the core waist re-export*, and P2 says all `@x402/*` imports live in
 * one directory. Giving the server package its own protocol directory would have been the other
 * option, and it would have halved the value of the boundary: upstream churn would then be two
 * files to read and two diffs to review instead of one (ADR-0004, ADR-0008).
 */

// ─── Resource server and facilitator client (@x402/core/server) ──────────────────────────

// The in-process facilitator is upstream's implementation. Movo's testing package composes
// it; it does not define a parallel facilitator contract or an HTTP service.
export { x402Facilitator } from "@x402/core/facilitator";
export type {
  AfterSettleHook,
  AfterVerifyHook,
  BeforeSettleHook,
  BeforeVerifyHook,
  FacilitatorConfig,
  OnSettleFailureHook,
  OnVerifiedPaymentCanceledHook,
  OnVerifyFailureHook,
  VerifiedPaymentCanceledContext,
  VerifiedPaymentCancellationReason,
} from "@x402/core/server";
export {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@x402/core/server";

// ─── The Stellar `exact` scheme server (@x402/stellar/exact/server) ──────────────────────
//
// Takes no constructor arguments; confirmed against the installed declaration and asserted by
// `upstream-conformance.test.ts`. Its `registerMoneyParser` is the supported extension point
// for pricing in a non-default asset — Movo must never implement its own price conversion.

export { ExactStellarScheme as FacilitatorExactStellarScheme } from "@x402/stellar/exact/facilitator";
export { ExactStellarScheme } from "@x402/stellar/exact/server";

// ─── Express middleware (@x402/express) ──────────────────────────────────────────────────
//
// `paymentMiddlewareFromHTTPServer` and not `paymentMiddlewareFromConfig`: the latter builds
// and HIDES the x402ResourceServer, which makes all seven lifecycle hooks unreachable — and
// those hooks are where Movo's diagnostics are designed to live (Spec Amendment 001 §2,
// docs/SPIKE_REPORT.md Q3).

export { paymentMiddlewareFromHTTPServer } from "@x402/express";
