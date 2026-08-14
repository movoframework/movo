/**
 * THE NARROW WAIST — buyer half.
 *
 * The fourth module in the same directory, under the same rule, for the same reason as
 * `./server.ts` and `./bazaar.ts` (amendment 004 §3): `@x402/fetch` and
 * `@x402/stellar/exact/client` pull a signing stack that a seller-only project has no reason to
 * load, so they live behind `@movoframework/core/client` rather than on the main entry.
 *
 * **The custody boundary runs through this file.** Movo re-exports `createEd25519Signer` and
 * the client scheme so a buyer can *construct* a signer, and re-exports nothing that generates,
 * derives, stores or persists a key. The signer is always supplied by the caller; no Movo
 * package contains a keypair-generation code path, and CI greps for one (spec §5.8).
 */

// ─── The client and its policy hook ──────────────────────────────────────────────────────
//
// `PaymentPolicy` is `(x402Version, requirements[]) => requirements[]` — a stateless filter
// upstream applies *before* creating a payment. It is the seam a budget hooks into, which is
// what makes refusal-before-signing possible without Movo touching the signing path.

export { x402Client } from "@x402/core/client";

// `PaymentPolicy` is exported from `@x402/fetch`, not `@x402/core/server` — verified against
// the installed declarations rather than inferred from where it is used.
export type { PaymentPolicy } from "@x402/fetch";

// ─── Fetch wrapping ──────────────────────────────────────────────────────────────────────

export { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";

// ─── The Stellar `exact` scheme, buyer side ──────────────────────────────────────────────
//
// A different constructor from the server subpath's: this one takes a signer, because the buyer
// is the party that signs. `createEd25519Signer` turns a secret into one.

export type { ClientStellarSigner } from "@x402/stellar";

export { createEd25519Signer, isClientStellarSigner } from "@x402/stellar";
export { ExactStellarScheme } from "@x402/stellar/exact/client";
