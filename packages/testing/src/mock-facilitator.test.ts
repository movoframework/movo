import type { PaymentPayload, PaymentRequirements } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { MOCK_TRANSACTION_REFERENCE, MockFacilitator } from "./mock-facilitator.js";
import { mutateSignedPayment, PAYMENT_SCENARIOS } from "./scenarios.js";

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "stellar:testnet",
  asset: "asset",
  amount: "1",
  payTo: "pay-to",
  maxTimeoutSeconds: 60,
  extra: {},
};
const payload: PaymentPayload = { x402Version: 2, accepted: requirements, payload: {} };

describe("MockFacilitator", () => {
  it("accepts the ordinary case and records verification and settlement", async () => {
    const facilitator = new MockFacilitator();
    expect((await facilitator.verify(payload, requirements)).isValid).toBe(true);
    expect((await facilitator.settle(payload, requirements)).transaction).toBe(
      MOCK_TRANSACTION_REFERENCE,
    );
    expect(facilitator.countOf("verify")).toBe(1);
    expect(facilitator.countOf("settle")).toBe(1);
  });

  it("returns a programmed, non-null verification reason", async () => {
    const facilitator = new MockFacilitator({ kind: "verify_rejected", reason: "wrong network" });
    await expect(facilitator.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: "wrong network",
    });
  });

  it("rejects a programmed timeout instead of silently succeeding", async () => {
    const facilitator = new MockFacilitator({ kind: "timeout", operation: "verify" });
    await expect(facilitator.verify(payload, requirements)).rejects.toThrow("timeout");
  });

  it("covers the full nine-scenario matrix", async () => {
    expect(PAYMENT_SCENARIOS).toHaveLength(9);

    const matrix: Array<[string, PaymentPayload, PaymentRequirements, MockFacilitator]> = [
      [
        "wrongNetwork",
        mutateSignedPayment(payload, "wrongNetwork"),
        requirements,
        new MockFacilitator({ kind: "verify_rejected", reason: "wrong network" }),
      ],
      [
        "wrongAsset",
        mutateSignedPayment(payload, "wrongAsset"),
        requirements,
        new MockFacilitator({ kind: "verify_rejected", reason: "wrong asset" }),
      ],
      [
        "wrongAmount",
        mutateSignedPayment(payload, "wrongAmount"),
        requirements,
        new MockFacilitator({ kind: "verify_rejected", reason: "wrong amount" }),
      ],
      [
        "expired",
        mutateSignedPayment(payload, "expired"),
        requirements,
        new MockFacilitator({ kind: "verify_rejected", reason: "expired" }),
      ],
      [
        "replayed",
        mutateSignedPayment(payload, "replayed"),
        requirements,
        new MockFacilitator({ kind: "verify_rejected", reason: "replayed" }),
      ],
      [
        "facilitator5xx",
        payload,
        requirements,
        new MockFacilitator({ kind: "verify_rejected", reason: "facilitator 5xx" }),
      ],
      [
        "facilitatorTimeout",
        payload,
        requirements,
        new MockFacilitator({ kind: "timeout", operation: "verify" }),
      ],
      [
        "facilitatorMalformed",
        payload,
        requirements,
        new MockFacilitator({ kind: "malformed", operation: "verify" }),
      ],
      ["handlerFailureAfterVerify", payload, requirements, new MockFacilitator()],
    ];

    for (const [name, value, reqs, facilitator] of matrix) {
      if (name === "handlerFailureAfterVerify") {
        const settled = await facilitator.settle(value, reqs);
        expect(settled.success).toBe(true);
        continue;
      }

      if (name === "facilitatorTimeout" || name === "facilitatorMalformed") {
        await expect(facilitator.verify(value, reqs)).rejects.toThrow();
        continue;
      }

      await expect(facilitator.verify(value, reqs)).resolves.toMatchObject({
        isValid: false,
      });
    }
  });
});
