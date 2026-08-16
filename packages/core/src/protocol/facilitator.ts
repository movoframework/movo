/**
 * THE NARROW WAIST — facilitator half.
 *
 * Same rule as `./index.ts` and `./server.ts`, same directory, separate module. This file
 * carries the pieces that only a running *facilitator* needs: the upstream facilitator
 * engine, the Stellar `exact` scheme in its facilitator subpath, the request-envelope
 * schemas, and the seed-to-signer constructor.
 *
 * **Why it is a separate module rather than more exports on `./server.ts`.** A facilitator is
 * not a resource server and must not inherit a resource server's dependencies.
 * `@movoframework/core/server` re-exports `@x402/express`, which imports `express`. The
 * facilitator service runs on Hono and has no use for Express; routing it through the server
 * waist would make every facilitator deployment carry a second HTTP framework it never calls.
 * The same argument that split `server.ts` off `index.ts` splits this off `server.ts`.
 *
 * **What this module is not.** It is re-exports and nothing else — no request parsing, no
 * response serialisation, no routing. The facilitator HTTP surface is built in
 * `packages/facilitator` and `apps/facilitator` and nowhere else (spec v2 §A.2 rule 7). A
 * waist module that re-exports a zod schema has not built an HTTP surface any more than
 * re-exporting `PaymentRequirements` builds a resource server.
 *
 * Shapes here were read from the installed declarations at
 * `node_modules/@x402/{core,stellar}/dist/esm/**\/*.d.mts` for version 2.21.0.
 *
 * @see docs/adr/0012-facilitator-architecture.md
 */

// ─── The facilitator engine (@x402/core/facilitator) ─────────────────────────────────────
//
// `x402Facilitator` owns the protocol: scheme registration, hook dispatch, `getSupported()`,
// and the `verify`/`settle` entry points. Movo registers schemes on it and calls it. Movo
// does not wrap, subclass or reimplement any part of it.

export type {
  FacilitatorAfterSettleHook,
  FacilitatorAfterVerifyHook,
  FacilitatorBeforeSettleHook,
  FacilitatorBeforeVerifyHook,
  FacilitatorOnSettleFailureHook,
  FacilitatorOnVerifyFailureHook,
  FacilitatorSettleContext,
  FacilitatorSettleResultContext,
  FacilitatorVerifyContext,
  FacilitatorVerifyResultContext,
} from "@x402/core/facilitator";
export { x402Facilitator } from "@x402/core/facilitator";

// ─── The Stellar `exact` scheme, facilitator subpath (@x402/stellar/exact/facilitator) ───
//
// This class is where every protocol primitive M6 must not reimplement actually lives:
// auth-entry structure and credential-type validation, signature-expiration ledger bounds,
// sub-invocation rejection, simulation, transfer-event checking, the facilitator-safety
// checks, transaction rebuild, signing, fee bumping, submission and confirmation polling.
//
// Read from the installed declaration, the constructor is:
//
//   constructor(signers: FacilitatorStellarSigner[], options?: {
//     rpcConfig?, areFeesSponsored?, maxTransactionFeeStroops?, selectSigner?, feeBumpSigner?
//   })
//
// It therefore already provides signer pooling, a fee ceiling, round-robin signer selection
// and fee-bump wrapping. `docs/SPIKE_REPORT.md` finding 4 called for M6 to be re-scoped
// against that fact, and it was: Movo's `SignerPool` supplies `selectSigner` and the
// operational tier around it (in-flight tracking, balance floors, readiness) rather than a
// second selection mechanism.
//
// Aliased `FacilitatorExactStellarScheme` for the same reason `./server.ts` aliases it: three
// different classes upstream share the name `ExactStellarScheme` across three subpaths, and a
// bare import would make the subpath — the thing that decides whether you have a client, a
// server or a facilitator — invisible at the use site.

export { ExactStellarScheme as FacilitatorExactStellarScheme } from "@x402/stellar/exact/facilitator";

// ─── Request envelope schemas and types (@x402/core) ─────────────────────────────────────
//
// A facilitator receives JSON from the open internet and must validate it before handing it
// to the scheme. The validators are upstream's: `PaymentPayloadSchema` and
// `PaymentRequirementsSchema` are the same schemas `HTTPFacilitatorClient` uses to parse
// facilitator responses, so a payload this service accepts is a payload upstream accepts.
//
// Movo authors no field-level validator here. The rule from spec v2 §A.1 (§5.7
// `validateDiscoveryStrict`) applies with equal force on this side of the wire: a Movo-written
// address or amount validator would either duplicate upstream's or disagree with it, and the
// second is a money bug.
//
// `VerifyRequest` and `SettleRequest` are upstream's declared envelope types — the exact
// bodies `HTTPFacilitatorClient.verify()` and `.settle()` POST. They carry `x402Version` plus
// the two objects above; upstream ships no zod schema for the envelope itself, only for its
// members, which is why `packages/facilitator` composes the two rather than importing a third.

export { PaymentPayloadSchema, PaymentRequirementsSchema } from "@x402/core/schemas";
export type { SettleRequest, VerifyRequest } from "@x402/core/types";

// ─── Seed-to-signer construction (@x402/stellar) ─────────────────────────────────────────
//
// `createEd25519Signer(seed, network)` turns an operator-supplied secret seed into the
// SEP-43-shaped `{ address, signAuthEntry, signTransaction }` the scheme expects. It derives a
// signer from a key the operator already has; it generates nothing. `check-key-generation`
// forbids `Keypair.random`, and this is not that.
//
// It is exported here rather than on the root waist deliberately. A resource server never
// needs it — the buyer signs — and putting a seed-consuming constructor on the entry point
// that resource servers import is an invitation to put a seed in a resource server.

export { createEd25519Signer } from "@x402/stellar";
