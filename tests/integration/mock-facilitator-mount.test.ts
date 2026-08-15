import { MockFacilitator, withPaidServer } from "@movoframework/testing";
import { describe, expect, it } from "vitest";
import { defineApp, defineResource, PAYMENT_HEADERS } from "../../packages/core/src/index.ts";

/**
 * `MockFacilitator` through a **real mount**.
 *
 * This test exists because the mock was, for two milestones, unusable in the one way its
 * documentation describes. `getSupported()` returned `kinds: []`, and upstream's
 * `x402ResourceServer.initialize` throws "no supported payment kinds loaded from any facilitator"
 * when every configured facilitator advertises none — so any project following the toolkit's own
 * guidance got a 500 on the first request and never saw a 402 at all.
 *
 * Nothing caught it. The mock satisfied the `FacilitatorClient` type, recorded its calls, and had
 * unit tests asserting each method's return value; the integration suite drove the mount with a
 * different stub. It is the plausible-fake shape from amendment 004 §6, and the thing that
 * finally surfaced it was making the scaffold templates real workspace members so their generated
 * tests actually ran.
 *
 * So the assertion here is deliberately end-to-end: mount the real middleware, make a real
 * request, and require the **402** rather than merely a non-throwing call.
 */

const PAY_TO = "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E";

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  handler: (ctx) => ({ city: ctx.params["city"] ?? "unknown" }),
});

const app = defineApp({ resources: [weather] });

const layers = {
  config: { env: "testnet" as const, network: "stellar:testnet" as const, payTo: PAY_TO },
};

describe("MockFacilitator drives a real mount", () => {
  it("serves a 402 with payment requirements, rather than a 500", async () => {
    await withPaidServer(
      app,
      { facilitator: new MockFacilitator(), config: layers },
      async (server) => {
        const response = await fetch(`${server.url}/weather/SFO`);

        expect(response.status).toBe(402);
        expect(response.headers.get(PAYMENT_HEADERS.required)).not.toBeNull();
      },
    );
  });

  it("advertises at least one payment kind, which is what initialisation requires", async () => {
    const supported = await new MockFacilitator().getSupported();

    // Stated as a property rather than as an exact payload: what upstream needs is a non-empty
    // list carrying the scheme and network in use, not one specific shape.
    expect(supported.kinds.length).toBeGreaterThan(0);
    expect(supported.kinds[0]?.scheme).toBe("exact");
    expect(supported.kinds[0]?.network).toBe("stellar:testnet");
  });

  it("still records the calls the mount made", async () => {
    const facilitator = new MockFacilitator();

    await withPaidServer(app, { facilitator, config: layers }, async (server) => {
      await fetch(`${server.url}/weather/SFO`);
    });

    // The unpaid request must reach `supported` and must NOT reach `settle`: nobody paid, so
    // nobody may be charged.
    expect(facilitator.countOf("supported")).toBeGreaterThan(0);
    expect(facilitator.countOf("settle")).toBe(0);
  });
});
