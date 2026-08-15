import { describe, expect, it } from "vitest";
import { type CatalogOutcome, isCatalogRejection, readCatalogOutcome } from "./outcome.js";

/**
 * AC4.3 and the surrounding semantics.
 *
 * The single most important assertion in this file is that an **absent header is not a
 * failure**. The specification makes `EXTENSION-RESPONSES` optional and says its absence
 * carries no signal; a decoder reporting absence as rejection would teach developers to chase
 * cataloging problems that do not exist. `processing` is the second trap — it means accepted
 * and indexing later, not declined.
 */

/** Encode an extension-responses payload the way a facilitator would. */
function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

describe("AC4.3 — absence is not failure", () => {
  it("returns unknown/absent for undefined", () => {
    expect(readCatalogOutcome(undefined)).toEqual({ status: "unknown", reason: "absent" });
  });

  it("returns unknown/absent for null and for an empty string", () => {
    // `headers.get()` returns null, not undefined, when a header is missing. Handling only
    // undefined would misclassify every real response that lacks the header.
    expect(readCatalogOutcome(null)).toEqual({ status: "unknown", reason: "absent" });
    expect(readCatalogOutcome("")).toEqual({ status: "unknown", reason: "absent" });
  });

  it("is not classified as a rejection by any code path", () => {
    for (const value of [undefined, null, ""]) {
      const outcome = readCatalogOutcome(value);
      expect(isCatalogRejection(outcome)).toBe(false);
      expect(outcome.status).not.toBe("rejected");
    }
  });

  it("never returns undefined, so a caller cannot branch on falsiness", () => {
    // The retained WIP file returned undefined for absent, malformed and missing-entry alike.
    // A caller writing `if (!outcome)` would then treat "no signal" as a problem.
    const outcomes: CatalogOutcome[] = [
      readCatalogOutcome(undefined),
      readCatalogOutcome("not base64 %%%"),
      readCatalogOutcome(encode({ other: { status: "success" } })),
    ];

    for (const outcome of outcomes) {
      expect(outcome).toBeDefined();
      expect(outcome.status).toBe("unknown");
    }
  });
});

describe("the four states", () => {
  it("reads success", () => {
    expect(readCatalogOutcome(encode({ bazaar: { status: "success" } }))).toEqual({
      status: "success",
    });
  });

  it("reads processing as its own state, not as failure", () => {
    const outcome = readCatalogOutcome(encode({ bazaar: { status: "processing" } }));

    expect(outcome).toEqual({ status: "processing" });
    expect(isCatalogRejection(outcome)).toBe(false);
  });

  it("reads rejected, with the reason when one is given", () => {
    const outcome = readCatalogOutcome(
      encode({ bazaar: { status: "rejected", rejectedReason: "iconUrl unreachable" } }),
    );

    expect(outcome).toEqual({ status: "rejected", rejectedReason: "iconUrl unreachable" });
    expect(isCatalogRejection(outcome)).toBe(true);
  });

  it("reads rejected without a reason", () => {
    expect(readCatalogOutcome(encode({ bazaar: { status: "rejected" } }))).toEqual({
      status: "rejected",
    });
  });
});

describe("unknown carries why", () => {
  it("distinguishes malformed base64 from an absent header", () => {
    expect(readCatalogOutcome("!!!not-base64!!!")).toEqual({
      status: "unknown",
      reason: "malformed",
    });
  });

  it("distinguishes non-JSON content", () => {
    expect(readCatalogOutcome(Buffer.from("plain text").toString("base64"))).toEqual({
      status: "unknown",
      reason: "malformed",
    });
  });

  it("distinguishes a JSON array from an object", () => {
    expect(readCatalogOutcome(encode([1, 2, 3]))).toEqual({
      status: "unknown",
      reason: "malformed",
    });
  });

  it("distinguishes a payload carrying no bazaar entry", () => {
    expect(readCatalogOutcome(encode({ "builder-code": { status: "success" } }))).toEqual({
      status: "unknown",
      reason: "no-bazaar-entry",
    });
  });

  it("treats an unrecognised status as unknown rather than as rejection", () => {
    // A facilitator may add states. Guessing that an unfamiliar one means failure is the same
    // error as treating absence as failure.
    const outcome = readCatalogOutcome(encode({ bazaar: { status: "queued-for-review" } }));

    expect(outcome.status).toBe("unknown");
    expect(isCatalogRejection(outcome)).toBe(false);
  });
});

describe("the extension key comes from upstream", () => {
  it("reads the entry under upstream's own key rather than a hardcoded string", async () => {
    // If upstream renamed the extension, this test and the implementation move together —
    // neither spells "bazaar" out.
    const { BAZAAR } = await import("@movoframework/core/bazaar");

    expect(readCatalogOutcome(encode({ [BAZAAR.key]: { status: "success" } }))).toEqual({
      status: "success",
    });
  });
});
