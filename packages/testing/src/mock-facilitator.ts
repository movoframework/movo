import {
  EXACT_SCHEME,
  type FacilitatorClient,
  type Network,
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  STELLAR_TESTNET_CAIP2,
  type SupportedResponse,
  type VerifyResponse,
} from "@movoframework/core";

/**
 * The network the mock advertises by default.
 *
 * Derived from the upstream constant rather than written as a literal, so a CAIP-2 identifier
 * cannot drift between the mock and the code under test.
 */
export const MOCK_NETWORK: Network = STELLAR_TESTNET_CAIP2 as Network;

/** Behaviour deliberately simulated by {@link MockFacilitator}. */
export type MockFacilitatorOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "verify_rejected"; readonly reason: string }
  | { readonly kind: "settle_failed"; readonly reason: string }
  | { readonly kind: "timeout"; readonly operation: "verify" | "settle" | "supported" }
  | { readonly kind: "malformed"; readonly operation: "verify" | "settle" | "supported" };

/** A call received by a {@link MockFacilitator}. */
export interface MockFacilitatorCall {
  readonly operation: "verify" | "settle" | "supported";
  readonly payment?: PaymentPayload;
  readonly requirements?: PaymentRequirements;
}

/** A non-chain reference that makes it impossible to mistake mock results for settlement proof. */
export const MOCK_TRANSACTION_REFERENCE = "movo-mock-not-an-on-chain-transaction";

/**
 * A programmable, network-free implementation of upstream's FacilitatorClient.
 *
 * This is intentionally not a validator or a settlement simulator. Its only job is to make
 * resource-server orchestration failures deterministic; real verification belongs to
 * InProcessFacilitator and upstream's ExactStellarScheme.
 */
export class MockFacilitator implements FacilitatorClient {
  readonly calls: MockFacilitatorCall[] = [];
  private outcome: MockFacilitatorOutcome;
  private readonly network: Network;

  constructor(outcome: MockFacilitatorOutcome = { kind: "ok" }, network: Network = MOCK_NETWORK) {
    this.outcome = outcome;
    this.network = network;
  }

  setOutcome(outcome: MockFacilitatorOutcome): void {
    this.outcome = outcome;
  }

  countOf(operation: MockFacilitatorCall["operation"]): number {
    return this.calls.filter((call) => call.operation === operation).length;
  }

  /**
   * Advertise one supported kind: `exact` on the configured network.
   *
   * **This must not be empty**, and the reason is worth recording rather than rediscovering.
   * Upstream's `x402ResourceServer.initialize` throws "no supported payment kinds loaded from any
   * facilitator" when every configured facilitator advertises none, so a mock returning `kinds:
   * []` produces a 500 on the first request and can never serve a 402 at all. It satisfied the
   * `FacilitatorClient` type, recorded its calls, and was unusable through a real mount — the
   * plausible-fake shape named in amendment 004 §6.
   *
   * `extra.areFeesSponsored` mirrors what the real testnet facilitator advertises, so the
   * scheme's `enhancePaymentRequirements` takes the same branch it takes in production.
   */
  async getSupported(): Promise<SupportedResponse> {
    this.calls.push({ operation: "supported" });
    this.raiseIfProgrammed("supported");
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: EXACT_SCHEME,
          network: this.network,
          extra: { areFeesSponsored: true },
        },
      ],
      extensions: [],
      signers: {},
    };
  }

  async verify(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    this.calls.push({ operation: "verify", payment, requirements });
    this.raiseIfProgrammed("verify");
    if (this.outcome.kind === "verify_rejected") {
      return { isValid: false, invalidReason: this.outcome.reason };
    }
    return { isValid: true };
  }

  async settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    this.calls.push({ operation: "settle", payment, requirements });
    this.raiseIfProgrammed("settle");
    if (this.outcome.kind === "settle_failed") {
      return {
        success: false,
        transaction: "",
        errorReason: this.outcome.reason,
        network: requirements.network,
      };
    }
    return {
      success: true,
      transaction: MOCK_TRANSACTION_REFERENCE,
      network: requirements.network,
    };
  }

  private raiseIfProgrammed(operation: MockFacilitatorCall["operation"]): void {
    if (this.outcome.kind === "timeout" && this.outcome.operation === operation) {
      throw new Error(`Mock facilitator timeout during ${operation}`);
    }
    if (this.outcome.kind === "malformed" && this.outcome.operation === operation) {
      throw new Error(`Mock facilitator returned a malformed ${operation} response`);
    }
  }
}
