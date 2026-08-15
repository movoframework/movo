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
}

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

      return true;
    });

  return {
    policy,
    spent: () => spent.toString(),
    remaining: () => (maxTotal === undefined ? undefined : (maxTotal - spent).toString()),
    reset: () => {
      spent = 0n;
    },
    refusals,
    record: (requirements) => {
      try {
        spent += BigInt(requirements.amount);
      } catch {
        // An unparseable amount cannot have been approved by the policy above, so reaching here
        // means something bypassed it. Ignoring it would understate spend; there is nothing
        // sensible to add, so the accountant is left untouched and the policy stays the gate.
      }
    },
  };
}
