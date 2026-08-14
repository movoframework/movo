/**
 * THE NARROW WAIST — the only place in the Movo monorepo that imports `@x402/*`.
 *
 * `@x402/core` and `@x402/stellar` are the protocol source of truth. They ship roughly weekly
 * and pin each other tightly, so an upstream breaking change would otherwise surface as
 * compile errors scattered across seven packages with no single place to absorb them. Every
 * other Movo file imports the protocol through this module; the rule is enforced by
 * `style/noRestrictedImports` in `biome.jsonc` and proven to fire by
 * `tests/unit/narrow-waist.test.ts`.
 *
 * Three rules govern what may appear here.
 *
 *  1. **Re-export, never rename.** `PaymentRequirements` stays `PaymentRequirements`. A
 *     parallel Movo vocabulary for identical wire objects is the failure mode ADR-0001 and
 *     ADR-0004 exist to prevent, and it would double the surface that upstream drift can
 *     break.
 *  2. **Re-export, never reimplement.** Nothing in Movo may recompute what upstream already
 *     exports — no address validators, no decimal arithmetic, no network identifiers, no
 *     header codecs. If it is missing upstream, that is a PR to upstream, not a local
 *     shim (spec §1.8 D1 and D4).
 *  3. **No behaviour.** This module contains re-exports and one asserted constant. Logic
 *     belongs in the modules that consume it, where it is testable without the protocol.
 *
 * Shapes here were read from the installed declarations at
 * `node_modules/@x402/{core,stellar}/dist/esm/**\/*.d.mts` for version 2.21.0, never from
 * documentation. `protocol/upstream-conformance.test.ts` re-checks the load-bearing ones
 * against the installed packages on every run.
 *
 * @see docs/adr/0004-x402-narrow-waist.md
 */

// ─── Protocol wire types (@x402/core) ────────────────────────────────────────────────────

export type {
  AssetAmount,
  Money,
  MoneyParser,
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  Price,
  ResourceInfo,
  SchemeNetworkServer,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";

// ─── Resource-server surface (@x402/core/server) ─────────────────────────────────────────
//
// `RoutesConfig` is the type `compileApp` produces and is deliberately exposed unaliased on
// `CompiledApp.routes`: a developer may take it straight to `paymentMiddleware` and bypass
// the Movo server package entirely. That is a stability promise (spec §5.3), and it only
// holds while the type is upstream's rather than a Movo copy of it.

export type { PaymentOption } from "@x402/core/http";
export type { FacilitatorClient, RouteConfig, RoutesConfig } from "@x402/core/server";
export { checkIfBazaarNeeded } from "@x402/core/server";
export type { PaymentPolicy } from "@x402/fetch";

// ─── Header codecs (@x402/core/http) ─────────────────────────────────────────────────────
//
// All six are re-exported because the spike (docs/SPIKE_REPORT.md, Q5) established that
// `decodePaymentRequiredHeader` is available *only* from `@x402/core/http` — `@x402/fetch`
// does not re-export it — and the Movo client package may not import `@x402/*` directly.

export {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";

// ─── Stellar constants, validators and converters (@x402/stellar) ────────────────────────
//
// Movo defines none of these itself (spec §1.8 D4). Hard-coding a USDC contract address or a
// decimal count that upstream already exports is precisely the duplication that produces a
// silent money bug the day one of the two copies changes.

export type { FacilitatorStellarSigner, RpcConfig } from "@x402/stellar";
export {
  convertToTokenAmount,
  DEFAULT_ESTIMATED_LEDGER_SECONDS,
  DEFAULT_TOKEN_DECIMALS,
  getEstimatedLedgerCloseTimeSeconds,
  getHorizonClient,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  getUsdcAddress,
  isStellarNetwork,
  STELLAR_NETWORK_TO_PASSPHRASE,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from "@x402/stellar";

// ─── The one asserted constant ───────────────────────────────────────────────────────────

/**
 * The x402 scheme identifier Movo compiles resources to.
 *
 * `exact` is the only scheme registered for Stellar (spec §13), and `ExactStellarScheme`
 * declares it as an instance field rather than a static one, so it cannot be read without
 * constructing a scheme server — which a pure, network-free compiler must not do. The literal
 * therefore lives here, in the narrow waist, exactly once; and
 * `upstream-conformance.test.ts` constructs the real scheme and asserts the two agree, so a
 * change upstream fails a test rather than producing routes no facilitator will settle.
 */
export const EXACT_SCHEME = "exact";

/**
 * The x402 wire header names.
 *
 * Upstream writes these as literals inside its own middleware and codecs and exports no
 * constant for them, so Movo declares them here — once, in the waist — rather than letting the
 * strings appear wherever a header is read. Two reasons that matters.
 *
 * First, single-sourcing: `AC2.7` requires that no `PAYMENT-*` literal appears in
 * `@movoframework/server` or `@movoframework/stellar` outside tests, because a Movo package
 * writing protocol header strings is the shape of a package that has started implementing the
 * protocol. Importing a named constant keeps that check meaningful — it fails on the thing it
 * is meant to catch rather than on a package that legitimately reads one header.
 *
 * Second, these are the *wire* names, verified against the installed packages rather than
 * remembered: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE` all appear as
 * literals in `@x402/express` and `@x402/core`. The integration suite drives real requests
 * through the real middleware using these constants, so a rename upstream fails a test rather
 * than silently producing a server that never sees a payment.
 */
export const PAYMENT_HEADERS = {
  /** Sent by the server on a 402, carrying the accepted payment options. */
  required: "PAYMENT-REQUIRED",
  /** Sent by the buyer on the retry, carrying the signed payload. */
  signature: "PAYMENT-SIGNATURE",
  /** Sent by the server on success, carrying the settlement result. */
  response: "PAYMENT-RESPONSE",
} as const;
