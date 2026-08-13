import type { PaymentPayload } from "@movoframework/core";

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

/** Clone a payload supplied by an upstream client before a test mutates it. */
export function cloneSignedPayment(payload: PaymentPayload): PaymentPayload {
  return structuredClone(payload);
}
