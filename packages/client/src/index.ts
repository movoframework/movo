/**
 * `@movoframework/client` — the buyer side.
 *
 * Two additions over upstream, and no more.
 *
 * **A stateful spend accountant.** Upstream's `PaymentPolicy` is stateless by design —
 * `(x402Version, requirements[]) => requirements[]` — so it can enforce a per-request cap but
 * cannot track cumulative spend. `createBudget` builds *on* that policy rather than replacing
 * it, adding the running total upstream has no place to keep.
 *
 * **A typed `call()`.** It reuses the server's own `MovoResource` declaration, so the handler's
 * return type is the call site's result type with no cast and no duplicated interface.
 *
 * **The threat this exists for.** A hostile server can name any `payTo` and any amount in a 402,
 * and the buyer is the only party that can refuse. Budget controls are security controls, not
 * conveniences — and refusal happens before payment creation, so a refused offer leaves no
 * signature in existence to be retried or leaked. See docs/security/buyer-budgets.md.
 *
 * **Never abstracted:** signing, key generation, key storage. The signer is always supplied by
 * the caller. No Movo package contains a keypair-generation code path.
 */

export {
  type Budget,
  type BudgetOptions,
  type BudgetRefusal,
  createBudget,
} from "./budget.js";
export {
  type CallResult,
  createMovoClient,
  type MovoClient,
  type MovoClientOptions,
  type PaymentStatus,
} from "./client.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
