import type { PaymentRequirements } from "@movoframework/core";
import { describe, expect, it, vi } from "vitest";
import { createBudget } from "./budget.js";

/**
 * AC4.4 and AC4.5 — budget refusal, and the property that makes it a security control.
 *
 * The assertion that matters is not "the request failed". It is that **no signature was ever
 * produced**. A budget that refused after signing would leave a valid signed authorisation in
 * existence — retriable by the server, leakable from a log — and "we chose not to submit it" is
 * a far weaker guarantee than "it does not exist". The signer spy is how that difference becomes
 * visible, because it is invisible in any response body.
 */

const PAY_TO = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";
const OTHER_PAY_TO = "GCX3VGY6ND44NV5WC7S4XSBEY3MX2VPMTB7A4ZWKZPMP67JI7MZLP77W";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function offer(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    asset: USDC,
    amount: "10000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: {},
    ...overrides,
  };
}

describe("the ordinary case", () => {
  it("accepts an offer within every limit", () => {
    // The positive baseline. A budget that refused everything would pass every negative test in
    // this file while being completely useless.
    const budget = createBudget({
      maxAmountPerRequest: "50000",
      maxTotalSpend: "100000",
      allowedNetworks: ["stellar:testnet"],
      allowedPayTo: [PAY_TO],
    });

    expect(budget.policy(2, [offer()])).toHaveLength(1);
    expect(budget.refusals).toEqual([]);
  });

  it("accepts everything when no limits are configured", () => {
    const budget = createBudget();
    expect(budget.policy(2, [offer({ amount: "999999999999" })])).toHaveLength(1);
  });
});

describe("AC4.4 — a budget below the offered amount refuses", () => {
  it("filters the offer out, so upstream creates no payment", () => {
    const budget = createBudget({ maxAmountPerRequest: "9999" });

    // Returning an empty array is how a PaymentPolicy says "none of these". Upstream then has
    // nothing to sign.
    expect(budget.policy(2, [offer({ amount: "10000" })])).toEqual([]);
    expect(budget.refusals[0]?.code).toBe("MOVO_E_BUDGET_EXCEEDED");
  });

  it("refuses before the signer is ever reached", async () => {
    // The signer spy. If a single call lands here, refusal happened too late.
    const sign = vi.fn();
    const signer = {
      publicKey: PAY_TO,
      signTransaction: sign,
      signAuthEntry: sign,
    } as unknown as Parameters<typeof import("./client.js").createMovoClient>[0]["signer"];

    const { createMovoClient } = await import("./client.js");
    const budget = createBudget({ maxAmountPerRequest: "1" });
    const client = createMovoClient({ signer, network: "stellar:testnet", budget });

    // Drive the policy the way upstream does, with an offer over the cap.
    const selected = budget.policy(2, [offer({ amount: "10000" })]);

    expect(selected).toEqual([]);
    expect(sign).not.toHaveBeenCalled();
    expect(client.fetch).toBeTypeOf("function");
  });

  it("enforces cumulative spend, which a stateless policy cannot", () => {
    // The one thing upstream's PaymentPolicy cannot do, and the reason this package exists.
    const budget = createBudget({ maxTotalSpend: "25000" });

    expect(budget.policy(2, [offer({ amount: "10000" })])).toHaveLength(1);
    budget.record(offer({ amount: "10000" }));
    expect(budget.spent()).toBe("10000");

    expect(budget.policy(2, [offer({ amount: "10000" })])).toHaveLength(1);
    budget.record(offer({ amount: "10000" }));
    expect(budget.spent()).toBe("20000");
    expect(budget.remaining()).toBe("5000");

    // Third would take the total over the cap.
    expect(budget.policy(2, [offer({ amount: "10000" })])).toEqual([]);
    expect(budget.refusals.at(-1)?.reason).toContain("cumulative spend");
  });

  it("counts a settlement that reports no amount, so maxTotalSpend is not inert", () => {
    // THE REGRESSION THIS EXISTS FOR. `SettleResponse.amount` is optional and the `exact`
    // scheme — every Stellar payment Movo makes — does not populate it. The client therefore
    // took the "no amount reported" branch on every real settlement, `spent()` never moved, and
    // maxTotalSpend was a cap that could not fire. It shipped that way through M4 and was found
    // by an M7 e2e that asserted on the budget after a confirmed on-chain settlement.
    const budget = createBudget({ maxTotalSpend: "25000" });

    // The policy approving an offer is what makes the authorisation available to count.
    expect(budget.policy(2, [offer({ amount: "10000" })])).toHaveLength(1);
    expect(budget.recordAuthorized()).toBe("10000");
    expect(budget.spent()).toBe("10000");
    expect(budget.remaining()).toBe("15000");

    expect(budget.policy(2, [offer({ amount: "10000" })])).toHaveLength(1);
    expect(budget.recordAuthorized()).toBe("10000");
    expect(budget.spent()).toBe("20000");

    // And the cumulative cap now actually fires.
    expect(budget.policy(2, [offer({ amount: "10000" })])).toEqual([]);
    expect(budget.refusals.at(-1)?.code).toBe("MOVO_E_BUDGET_EXCEEDED");
  });

  it("counts each settlement once, whether or not an amount was reported", () => {
    const budget = createBudget();

    // One approval, then a settlement that DID report its amount. The authorisation must be
    // consumed by it, or a later amount-less settlement would count the same payment twice.
    expect(budget.policy(2, [offer({ amount: "10000" })])).toHaveLength(1);
    budget.record(offer({ amount: "10000" }));
    expect(budget.spent()).toBe("10000");

    expect(budget.recordAuthorized()).toBeUndefined();
    expect(budget.spent()).toBe("10000");
  });

  it("counts nothing for a settlement no approval preceded", () => {
    // Defensive: reaching settlement without the policy having approved anything means
    // something bypassed the gate. Inventing a number here would misreport spend either way,
    // so the accountant reports that it counted nothing.
    const budget = createBudget();
    expect(budget.recordAuthorized()).toBeUndefined();
    expect(budget.spent()).toBe("0");
  });

  it("resets", () => {
    const budget = createBudget({ maxTotalSpend: "10000" });
    budget.record(offer({ amount: "10000" }));
    expect(budget.policy(2, [offer({ amount: "1" })])).toEqual([]);

    budget.reset();
    expect(budget.spent()).toBe("0");
    expect(budget.policy(2, [offer({ amount: "1" })])).toHaveLength(1);
  });
});

describe("AC4.5 — allowedPayTo mismatch refuses without signing", () => {
  it("refuses an offer naming an address outside the allowlist", () => {
    const budget = createBudget({ allowedPayTo: [PAY_TO] });

    expect(budget.policy(2, [offer({ payTo: OTHER_PAY_TO })])).toEqual([]);
    expect(budget.refusals[0]?.code).toBe("MOVO_E_BUDGET_PAYTO_NOT_ALLOWED");
    expect(budget.refusals[0]?.reason).toContain(OTHER_PAY_TO);
  });

  it("explains why the control exists, in the refusal itself", () => {
    const budget = createBudget({ allowedPayTo: [PAY_TO] });
    budget.policy(2, [offer({ payTo: OTHER_PAY_TO })]);

    // A developer reading this at 2am should learn the threat, not just the rule.
    expect(budget.refusals[0]?.reason).toContain("can name any recipient");
  });
});

describe("network allowlist", () => {
  it("refuses an offer on a network outside the allowlist", () => {
    // What stops a testnet-only buyer being talked onto mainnet by a 402.
    const budget = createBudget({ allowedNetworks: ["stellar:testnet"] });

    expect(budget.policy(2, [offer({ network: "stellar:pubnet" })])).toEqual([]);
    expect(budget.refusals[0]?.code).toBe("MOVO_E_BUDGET_NETWORK_NOT_ALLOWED");
  });
});

describe("selection, not rejection", () => {
  it("keeps acceptable offers and drops only the unacceptable ones", () => {
    // A 402 may carry several options. The policy is a filter, so the buyer pays the one it is
    // willing to pay rather than refusing the whole exchange.
    const budget = createBudget({ maxAmountPerRequest: "10000", allowedPayTo: [PAY_TO] });

    const selected = budget.policy(2, [
      offer({ amount: "50000" }),
      offer({ amount: "10000" }),
      offer({ payTo: OTHER_PAY_TO, amount: "1" }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.amount).toBe("10000");
    expect(budget.refusals).toHaveLength(2);
  });
});

describe("amounts are BigInt throughout", () => {
  it("handles amounts beyond Number.MAX_SAFE_INTEGER without rounding", () => {
    // A 7-decimal asset passes the safe-integer boundary at roughly 900 million units, which is
    // not a large balance. Number arithmetic here would be a rounding bug waiting for a
    // sufficiently rich buyer.
    const huge = "9007199254740993"; // MAX_SAFE_INTEGER + 2
    const budget = createBudget({ maxAmountPerRequest: "9007199254740992" });

    expect(budget.policy(2, [offer({ amount: huge })])).toEqual([]);
  });

  it("refuses an offer whose amount is not an integer string", () => {
    const budget = createBudget({ maxAmountPerRequest: "10000" });

    expect(budget.policy(2, [offer({ amount: "1.5" })])).toEqual([]);
    expect(budget.refusals[0]?.reason).toContain("not an integer");
  });

  it("rejects a malformed budget limit at construction", () => {
    expect(() => createBudget({ maxAmountPerRequest: "lots" })).toThrowError(
      expect.objectContaining({ code: "MOVO_E_BUDGET_EXCEEDED" }),
    );
  });
});

describe("onRefusal", () => {
  it("is notified for every refusal, and cannot reverse one", () => {
    const seen: string[] = [];
    const budget = createBudget({
      maxAmountPerRequest: "1",
      onRefusal: (refusal) => void seen.push(refusal.code),
    });

    expect(budget.policy(2, [offer()])).toEqual([]);
    expect(seen).toEqual(["MOVO_E_BUDGET_EXCEEDED"]);
  });
});
