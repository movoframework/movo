import { compileApp } from "@movoframework/core";
import { MockFacilitator, withPaidServer } from "@movoframework/testing";
import { describe, expect, it } from "vitest";
import { config } from "../movo.config.ts";
import { app } from "./app.ts";

/**
 * The generated test. It runs with no keys, no funds and no network.
 *
 * `MockFacilitator` makes orchestration deterministic — it is not a settlement simulator and
 * does not pretend to be one. It answers "does my route return 402 before payment, and does my
 * handler run after a successful verification", which is what you want failing fast in a watch
 * loop. Real settlement is `movo dev --facilitator in-process` against testnet.
 */

describe("the weather resource", () => {
  it("compiles into one paid route", () => {
    const compiled = compileApp(app, {
      config,
      // A `payTo` is supplied here rather than read from the environment so this test passes on
      // a fresh clone with no `.env` — a generated test that only passes once you are already
      // configured teaches nothing on the first run.
      argument: { payTo: "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E" },
    });

    expect(compiled.handlers.size).toBe(1);
    expect([...compiled.handlers.keys()]).toEqual(["GET /weather/:city"]);
  });

  it("demands payment before running the handler", async () => {
    await withPaidServer(
      app,
      {
        facilitator: new MockFacilitator(),
        config: {
          config,
          argument: { payTo: "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E" },
        },
      },
      async (server) => {
        const response = await fetch(`${server.url}/weather/SFO`);

        expect(response.status).toBe(402);

        // The body of a 402 is empty. The payment requirements travel in the PAYMENT-REQUIRED
        // header, which is where a buyer's client reads them from.
        expect(response.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
      },
    );
  });
});
