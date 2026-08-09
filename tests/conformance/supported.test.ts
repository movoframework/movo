import { describe, expect, it } from "vitest";

/**
 * Conformance probe against a live, third-party facilitator.
 *
 * Skipped unless MOVO_E2E=1. This must never block the PR gate: the public facilitator is a
 * service Movo does not operate, and its downtime is not a defect in this repository
 * (spec §1.16 layer 4, §16.9). It runs on the `conformance` workflow — manual and weekly.
 *
 * What it protects: assumption A3 (a free keyless testnet facilitator exists) and the claim
 * that `stellar:testnet` + `exact` are actually settleable through it. If this starts
 * failing, the quickstart in the README is broken for every new user.
 */

const FACILITATOR_URL = process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator";
const ENABLED = process.env["MOVO_E2E"] === "1";

interface SupportedKind {
  readonly x402Version?: number;
  readonly scheme?: string;
  readonly network?: string;
  readonly extra?: { readonly [key: string]: unknown };
}

interface SupportedPayload {
  readonly kinds?: readonly SupportedKind[];
}

describe.skipIf(!ENABLED)(`facilitator /supported — ${FACILITATOR_URL}`, () => {
  let status = 0;
  let payload: SupportedPayload = {};

  it("returns 200", async () => {
    const response = await fetch(`${FACILITATOR_URL.replace(/\/+$/, "")}/supported`, {
      headers: { accept: "application/json" },
    });
    status = response.status;
    payload = (await response.json()) as SupportedPayload;
    expect(status).toBe(200);
  });

  it("advertises the exact scheme on stellar:testnet", () => {
    const kinds = payload.kinds ?? [];
    const stellarExact = kinds.filter(
      (kind) => kind.network === "stellar:testnet" && kind.scheme === "exact",
    );
    expect(stellarExact.length).toBeGreaterThan(0);
  });

  it("advertises areFeesSponsored in the stellar:testnet extra block", () => {
    const kinds = payload.kinds ?? [];
    const stellarExact = kinds.find(
      (kind) => kind.network === "stellar:testnet" && kind.scheme === "exact",
    );
    expect(stellarExact?.extra).toBeDefined();
    expect(stellarExact?.extra).toHaveProperty("areFeesSponsored");
  });

  it("advertises x402 protocol version 2 for the Stellar kind", () => {
    const kinds = payload.kinds ?? [];
    const stellarExact = kinds.find(
      (kind) => kind.network === "stellar:testnet" && kind.scheme === "exact",
    );
    expect(stellarExact?.x402Version).toBe(2);
  });
});
