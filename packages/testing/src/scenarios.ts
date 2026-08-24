import type { PaymentPayload, PaymentRequirements } from "@movoframework/core";

/** The M3 payment-failure matrix. */
export const PAYMENT_SCENARIOS = [
  "wrongNetwork",
  "wrongAsset",
  "wrongAmount",
  "expired",
  "replayed",
  "facilitator5xx",
  "facilitatorTimeout",
  "facilitatorMalformed",
  "handlerFailureAfterVerify",
] as const;
export type PaymentScenario = (typeof PAYMENT_SCENARIOS)[number];

/**
 * The reason a payload replayed after settlement is rejected with (AC3.3).
 *
 * Upstream's, not Movo's: a settled payload's authorisation entry no longer simulates, so
 * `ExactStellarScheme` fails it at simulation. Observed from the live service and recorded in
 * `docs/CONFORMANCE.md` under AC6.5.
 *
 * Named here rather than spelled out at the assertion because §E.4 asks AC3.3 to be pinned by an
 * explicit assertion on the **distinct reason**, and §D.1's lesson is that a test asserting only
 * that rejection happened cannot see a reason-collapse: the moment replay and, say, a tampered
 * amount return the same token, an agent can no longer tell "you already spent this" from "you
 * underpaid", and every test that checked `toBeTruthy()` stays green through it.
 */
export const REPLAYED_REJECTION_REASON = "invalid_exact_stellar_payload_simulation_failed";

/** Clone a payload supplied by an upstream client before a test mutates it. */
export function cloneSignedPayment(payload: PaymentPayload): PaymentPayload {
  return structuredClone(payload);
}

/**
 * Mutate a validly signed payment payload so that the rejection originates in real verification.
 * Each mutation keeps the payload structurally coherent while changing one fact the verifier is
 * required to check.
 */
export function mutateSignedPayment(
  payload: PaymentPayload,
  scenario: PaymentScenario,
): PaymentPayload {
  const next = cloneSignedPayment(payload);
  const requirements = { ...next.accepted };

  switch (scenario) {
    case "wrongNetwork":
      next.accepted = { ...requirements, network: "stellar:pubnet" };
      return next;
    case "wrongAsset":
      next.accepted = {
        ...requirements,
        asset: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      };
      return next;
    case "wrongAmount":
      next.accepted = {
        ...requirements,
        amount: String(Math.max(1, Number(requirements.amount) + 1)),
      };
      return next;
    case "expired":
      next.accepted = {
        ...requirements,
        maxTimeoutSeconds: 0,
      };
      return next;
    case "replayed":
      next.accepted = { ...requirements };
      return next;
    case "facilitator5xx":
    case "facilitatorTimeout":
    case "facilitatorMalformed":
    case "handlerFailureAfterVerify":
      return next;
    default: {
      const exhaustive: never = scenario;
      throw new Error(`Unhandled scenario: ${String(exhaustive)}`);
    }
  }
}

/** Convenience helper for tests that need to assert the exact set of scenarios a runner covers. */
export function paymentRequirementsFor(payload: PaymentPayload): PaymentRequirements {
  return { ...payload.accepted };
}
