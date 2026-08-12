/**
 * A minimal `FacilitatorClient` stub for the integration suite.
 *
 * The full testing toolkit — `MockFacilitator`, `InProcessFacilitator`, the nine-scenario
 * matrix — is M3. This is the smallest thing that lets the integration suite drive the **real**
 * Express middleware and the **real** `x402ResourceServer` without a network, which is what
 * makes the invariant assertions meaningful: everything in the path is genuine except the
 * facilitator's answer.
 *
 * It records every call, so a test can assert that `settle` was invoked exactly zero times —
 * which is the difference between "the buyer was not charged" and "we believe the buyer was not
 * charged".
 */

import type {
  FacilitatorClient,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "../../packages/core/src/index.ts";

/** What the stub should do next. */
export type StubOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "verify_rejected"; readonly reason: string }
  | { readonly kind: "settle_failed"; readonly reason: string };

/** One recorded facilitator call. */
export interface StubCall {
  readonly kind: "verify" | "settle" | "supported";
  readonly at: number;
}

/** A transaction reference the stub reports on a successful settle. */
export const STUB_TRANSACTION = "stub-transaction-reference-not-a-real-hash";

/** The payer address the stub reports. */
export const STUB_PAYER = "GCX3VGY6ND44NV5WC7S4XSBEY3MX2VPMTB7A4ZWKZPMP67JI7MZLP77W";

/** A `FacilitatorClient` whose answers a test controls. */
export class StubFacilitator implements FacilitatorClient {
  private outcome: StubOutcome;

  /** Every call made to this facilitator, in order. */
  readonly calls: StubCall[] = [];

  constructor(outcome: StubOutcome = { kind: "ok" }) {
    this.outcome = outcome;
  }

  /**
   * Change what the stub does next.
   *
   * @param outcome - The new outcome
   */
  setOutcome(outcome: StubOutcome): void {
    this.outcome = outcome;
  }

  /** How many times a given method was called. */
  countOf(kind: StubCall["kind"]): number {
    return this.calls.filter((call) => call.kind === kind).length;
  }

  /**
   * Report which scheme/network pairs this facilitator supports.
   *
   * @returns The supported kinds, mirroring the live testnet facilitator's shape
   */
  async getSupported(): Promise<SupportedResponse> {
    this.calls.push({ kind: "supported", at: this.calls.length });
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: "stellar:testnet",
          // Mirrors what the real testnet facilitator advertises, so the scheme's
          // `enhancePaymentRequirements` takes the same branch it takes in production.
          extra: { areFeesSponsored: true },
        },
      ],
      extensions: [],
      signers: {},
    };
  }

  /**
   * Verify a payment.
   *
   * @param paymentPayload - The buyer's signed payload
   * @param paymentRequirements - What the server asked for
   * @returns The verification outcome
   */
  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    this.calls.push({ kind: "verify", at: this.calls.length });
    void paymentPayload;
    void paymentRequirements;

    if (this.outcome.kind === "verify_rejected") {
      return { isValid: false, invalidReason: this.outcome.reason, payer: STUB_PAYER };
    }
    return { isValid: true, payer: STUB_PAYER };
  }

  /**
   * Settle a verified payment.
   *
   * @param paymentPayload - The buyer's signed payload
   * @param paymentRequirements - What the server asked for
   * @returns The settlement outcome
   */
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.calls.push({ kind: "settle", at: this.calls.length });
    void paymentPayload;

    if (this.outcome.kind === "settle_failed") {
      return {
        success: false,
        // Upstream requires the field even on failure: a settlement that did not happen still
        // has to say so in the same shape as one that did.
        transaction: "",
        errorReason: this.outcome.reason,
        network: paymentRequirements.network,
        payer: STUB_PAYER,
      };
    }

    return {
      success: true,
      transaction: STUB_TRANSACTION,
      network: paymentRequirements.network,
      payer: STUB_PAYER,
    };
  }
}
