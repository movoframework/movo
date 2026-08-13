import type { PaymentPayload, PaymentRequirements } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { MOCK_TRANSACTION_REFERENCE, MockFacilitator } from "./mock-facilitator.js";

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
});
