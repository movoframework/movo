/**
 * `createBudget` — the buyer's only defence.
 *
 * **The threat, stated plainly.** A 402 is a claim, not a fact. A hostile or compromised server
 * can name any `payTo` it likes and any amount it likes, and nothing in the protocol prevents
 * it. The facilitator will faithfully settle whatever the buyer signed. **The buyer is the only
 * party in the exchange that can refuse**, which makes these controls security controls rather
 * than conveniences, and makes the moment of refusal load-bearing.
 *
 * **Refusal happens before payment creation, so no signature is ever produced.** That ordering
 * is the whole design. A budget that rejected after signing would leave a valid, signed
 * authorisation in existence — one that a server could retry, or that could leak from a log —
 * and "we did not submit it" is a much weaker guarantee than "it does not exist".
 * `budget.test.ts` asserts it with a signer spy, because the difference is invisible in a
 * response body.
 *
 * **Built on upstream's `PaymentPolicy`, not instead of it.** A `PaymentPolicy` is
 * `(x402Version, requirements[]) => requirements[]` — a stateless filter upstream already
 * applies before creating a payment. That is exactly the right hook for the per-request checks,
 * and Movo does not reimplement it. What upstream cannot do, because it is stateless, is track
 * cumulative spend across requests. That accountant is Movo's addition, and the only one.
 */

import {
  MovoError,
  type Network,
  type PaymentPolicy,
  type PaymentRequirements,
} from "@movoframework/core";

/** Why a payment offer was refused. */
export interface BudgetRefusal {
  /** The registry code corresponding to the constraint that failed. */
  readonly code:
    | "MOVO_E_BUDGET_EXCEEDED"
    | "MOVO_E_BUDGET_PAYTO_NOT_ALLOWED"
    | "MOVO_E_BUDGET_NETWORK_NOT_ALLOWED";
  /** Human-readable explanation naming the constraint and what the offer contained. */
  readonly reason: string;
  /** The offer that was refused. */
  readonly requirements: PaymentRequirements;
}

/** Options for {@link createBudget}. */
export interface BudgetOptions {
  /** Maximum for any single request, in base units. */
  readonly maxAmountPerRequest?: string;
  /** Maximum cumulative spend over this budget's lifetime, in base units. */
  readonly maxTotalSpend?: string;
  /** Networks this buyer will settle on. Absent means any. */
  readonly allowedNetworks?: readonly Network[];
  /** Addresses this buyer will pay. Absent means any. */
  readonly allowedPayTo?: readonly string[];
  /** Called for each refused offer. Observability only; it cannot reverse a refusal. */
  readonly onRefusal?: (refusal: BudgetRefusal) => void;
}

/** A budget: an upstream policy plus the stateful accountant upstream cannot provide. */
export interface Budget {
  /** Pass to `x402Client.registerPolicy`. Filters offers before payment creation. */
  readonly policy: PaymentPolicy;
  /** Cumulative spend so far, in base units. */
  spent(): string;
  /** Remaining allowance, or undefined when no total was set. */
  remaining(): string | undefined;
  /** Reset the accountant to zero. */
  reset(): void;
  /** Every refusal this budget has issued, in order. */
  readonly refusals: readonly BudgetRefusal[];
  /**
   * Record a settled payment against the budget.
   *
   * Separate from the policy because a policy runs when an offer is *considered*, and spending
   * happens only when one settles. Counting at selection time would charge the buyer for
   * payments that failed verification.
   */
  record(requirements: PaymentRequirements): void;
  /**
   * Record a settlement whose amount the facilitator did not report.
   *
   * **`[FACT — installed declarations + observed on testnet]` `SettleResponse.amount` is
   * optional**, documented upstream as "present for schemes like `upto` where settlement amount
   * may differ from the authorized maximum". The `exact` scheme — every Stellar payment Movo
   * makes today — does not populate it. So the amount-carrying path above never ran in
   * production, `spent()` stayed at `"0"` through real settled payments, and **`maxTotalSpend`
   * was inert**: the per-request cap held, and the cumulative cap silently never fired.
   *
   * Found by an e2e that asserted on the budget after a confirmed on-chain settlement rather
   * than on the response alone. It is the §A.2 rule-4 shape once more — the field typechecked,
   * the code read correctly, and the control did nothing.
   *
   * The fix is to count what was *authorized*. Under `exact` the authorized amount is the
   * settled amount by definition of the scheme, so this is exact rather than an estimate; under
   * a scheme where the two can differ, that scheme populates `amount` and `record` is used
   * instead. Authorizations are consumed oldest-first, so N payments settle against the N
   * offers the policy approved and the running total stays correct regardless of ordering.
   *
   * **Residual, stated rather than hidden:** spend is counted at settlement, not at approval, so
   * payments genuinely in flight at the same instant are each checked against the total
   * separately. Counting at approval instead would permanently consume the cap for every
   * payment that was approved and then failed, which is a worse failure — an agent that
   * gradually locks itself out. Sequential tool calls, which is what `bazaar.paidCall` makes,
   * are unaffected either way.
   *
   * @returns The amount counted, or undefined when there was no outstanding authorization
   */
  recordAuthorized(): string | undefined;
}

/**
 * How many approved-but-not-yet-settled offers are remembered.
 *
 * Bounded because an approval is only consumed by a settlement, and a payment that is approved
 * and then fails leaves its authorization behind. Unbounded, a long-lived agent would grow this
 * list for the lifetime of the process.
 */
const MAX_PENDING_AUTHORIZATIONS = 1024;

/**
 * Amounts are base units and can exceed `Number.MAX_SAFE_INTEGER`, so all arithmetic and every
 * comparison is BigInt. A 7-decimal asset reaches unsafe territory at about 900 million units,
 * which is not a large balance — using numbers here would be a rounding bug waiting for a
 * sufficiently rich buyer.
 */
function toBigInt(value: string, field: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new MovoError(
      "MOVO_E_BUDGET_EXCEEDED",
      `${field} must be an integer string in base units, received ${JSON.stringify(value)}.`,
      { context: { field, value } },
    );
  }
}

/**
 * Create a budget.
 *
 * @param options - Limits and allowlists; every one optional
 * @returns The policy to register, plus the spend accountant
 */
export function createBudget(options: BudgetOptions = {}): Budget {
  const maxPerRequest =
    options.maxAmountPerRequest === undefined
      ? undefined
      : toBigInt(options.maxAmountPerRequest, "maxAmountPerRequest");
  const maxTotal =
    options.maxTotalSpend === undefined
      ? undefined
      : toBigInt(options.maxTotalSpend, "maxTotalSpend");

  let spent = 0n;
  const refusals: BudgetRefusal[] = [];
  /** Amounts the policy approved and no settlement has yet consumed. Oldest first. */
  const authorized: bigint[] = [];

  function refuse(
    code: BudgetRefusal["code"],
    reason: string,
    requirements: PaymentRequirements,
  ): void {
    const refusal: BudgetRefusal = { code, reason, requirements };
    refusals.push(refusal);
    options.onRefusal?.(refusal);
  }

  /**
   * The upstream policy: filter the offers this buyer is willing to consider.
   *
   * Returning an empty array means "none of these are acceptable", and upstream then creates no
   * payment — which is precisely how refusal-before-signing is achieved without Movo owning any
   * part of the signing path.
   */
  const policy: PaymentPolicy = (_x402Version, requirements) =>
    requirements.filter((offer) => {
      if (
        options.allowedNetworks !== undefined &&
        !options.allowedNetworks.includes(offer.network)
      ) {
        refuse(
          "MOVO_E_BUDGET_NETWORK_NOT_ALLOWED",
          `offer names network ${offer.network}, which is not in allowedNetworks (${options.allowedNetworks.join(", ")})`,
          offer,
        );
        return false;
      }

      if (options.allowedPayTo !== undefined && !options.allowedPayTo.includes(offer.payTo)) {
        refuse(
          "MOVO_E_BUDGET_PAYTO_NOT_ALLOWED",
          `offer names payTo ${offer.payTo}, which is not in allowedPayTo. A server can name any recipient in a 402; this is the check that stops one being paid.`,
          offer,
        );
        return false;
      }

      let amount: bigint;
      try {
        amount = BigInt(offer.amount);
      } catch {
        refuse(
          "MOVO_E_BUDGET_EXCEEDED",
          `offer amount ${JSON.stringify(offer.amount)} is not an integer in base units, so it cannot be checked against a budget`,
          offer,
        );
        return false;
      }

      if (maxPerRequest !== undefined && amount > maxPerRequest) {
        refuse(
          "MOVO_E_BUDGET_EXCEEDED",
          `offer amount ${offer.amount} exceeds maxAmountPerRequest ${String(maxPerRequest)}`,
          offer,
        );
        return false;
      }

      if (maxTotal !== undefined && spent + amount > maxTotal) {
        refuse(
          "MOVO_E_BUDGET_EXCEEDED",
          `offer amount ${offer.amount} would take cumulative spend to ${String(spent + amount)}, over maxTotalSpend ${String(maxTotal)} (already spent ${String(spent)})`,
          offer,
        );
        return false;
      }

      // Approved. Remembered so that a settlement reporting no amount — which is every `exact`
      // settlement, see `recordAuthorized` — can still be counted against the cumulative cap.
      authorized.push(amount);
      if (authorized.length > MAX_PENDING_AUTHORIZATIONS) authorized.shift();

      return true;
    });

  return {
    policy,
    spent: () => spent.toString(),
    remaining: () => (maxTotal === undefined ? undefined : (maxTotal - spent).toString()),
    reset: () => {
      spent = 0n;
      authorized.length = 0;
    },
    refusals,
    recordAuthorized: () => {
      const amount = authorized.shift();
      if (amount === undefined) return undefined;
      spent += amount;
      return amount.toString();
    },

    record: (requirements) => {
      try {
        spent += BigInt(requirements.amount);
        // A settlement that reported its own amount consumes an authorization too, so a later
        // `recordAuthorized` cannot count the same payment a second time.
        authorized.shift();
      } catch {
        // An unparseable amount cannot have been approved by the policy above, so reaching here
        // means something bypassed it. Ignoring it would understate spend; there is nothing
        // sensible to add, so the accountant is left untouched and the policy stays the gate.
      }
    },
  };
}
