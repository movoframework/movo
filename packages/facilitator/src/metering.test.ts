import { describe, expect, it } from "vitest";
import { ANONYMOUS_CALLER, Metering } from "./metering.js";

describe("Metering", () => {
  it("counts verifies and settles separately, split by outcome", () => {
    const metering = new Metering(0);
    metering.record("team-a", "verify", true);
    metering.record("team-a", "verify", false);
    metering.record("team-a", "settle", true);
    metering.record("team-a", "settle", false);

    const [meter] = metering.snapshot();
    expect(meter).toMatchObject({
      caller: "team-a",
      verifyTotal: 2,
      verifyInvalid: 1,
      settleTotal: 2,
      settleFailed: 1,
    });
  });

  it("accrues the operator fee only on a successful settlement", () => {
    const metering = new Metering(100);
    metering.record("team-a", "settle", true);
    metering.record("team-a", "settle", false);
    metering.record("team-a", "verify", true);

    expect(metering.snapshot()[0]?.accruedFeeStroops).toBe(100);
  });

  it("accrues nothing at the default zero fee", () => {
    const metering = new Metering(0);
    metering.record("team-a", "settle", true);

    expect(metering.snapshot()[0]?.accruedFeeStroops).toBe(0);
  });

  it("counts transport rejections apart from failed verifications", () => {
    // Different operational signals: bad requests from a caller, versus bad payments from a
    // buyer. Collapsing them hides which one is happening during an incident.
    const metering = new Metering(0);
    metering.recordRejection("team-a");
    metering.record("team-a", "verify", false);

    expect(metering.snapshot()[0]).toMatchObject({ rejectedTotal: 1, verifyInvalid: 1 });
  });

  it("keeps callers separate and aggregates unauthenticated traffic", () => {
    const metering = new Metering(0);
    metering.record("team-a", "verify", true);
    metering.record(ANONYMOUS_CALLER, "verify", true);
    metering.record(ANONYMOUS_CALLER, "verify", true);

    const snapshot = metering.snapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot.find((meter) => meter.caller === ANONYMOUS_CALLER)?.verifyTotal).toBe(2);
  });

  it("records no counter that could carry caller data", () => {
    const metering = new Metering(7);
    metering.record("team-a", "settle", true);

    for (const value of Object.values(metering.snapshot()[0] as object)) {
      // Every field is either the caller id or a number. A payload, an address or a reason
      // string appearing here would be caller-influenced data retained in memory and served
      // on /metrics, which is a different privacy posture than counters.
      expect(typeof value === "number" || value === "team-a").toBe(true);
    }
  });
});
