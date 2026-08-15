import { attachDiscovery } from "@movoframework/bazaar";
import { compileApp } from "@movoframework/core";
import { MockFacilitator, withPaidServer } from "@movoframework/testing";
import { describe, expect, it } from "vitest";
import { config } from "../movo.config.ts";
import { app } from "./app.ts";

/**
 * The generated test. No keys, no funds, no network.
 *
 * The discovery assertion is the one worth keeping as you edit this project. Upstream drops an
 * invalid discovery field silently at request time, on the facilitator's server, and the first
 * you would learn of it is a listing with something missing. Validating here means a bad
 * `iconUrl` or an example that does not match its own schema fails in CI instead.
 */

const PAY_TO = "GCQQ4LGCXPRVCAWY3IK7RUUXYVFVQQ2NAMBUNBUFDG5WLPKPMK4AMQ4E";

describe("the discoverable weather API", () => {
  it("compiles two routes, one of them declared discoverable", () => {
    const compiled = compileApp(app, { config, argument: { payTo: PAY_TO } });

    expect(compiled.handlers.size).toBe(2);
    // `internalMetrics` sets `discovery: false`, so it must not be here.
    expect(compiled.discoveryDeclared).toEqual(["GET /weather/:city"]);
  });

  it("produces discovery metadata that upstream's own validators accept", async () => {
    const compiled = compileApp(app, { config, argument: { payTo: PAY_TO } });

    // Derive, then validate. Validating a freshly compiled app would report nothing, because
    // upstream's validator reads `route.extensions` and derivation is what puts them there.
    const findings = await attachDiscovery(compiled);
    const errors = findings.filter((finding) => finding.level === "error");

    expect(errors).toEqual([]);
  });

  it("demands payment before running the handler", async () => {
    await withPaidServer(
      app,
      { facilitator: new MockFacilitator(), config: { config, argument: { payTo: PAY_TO } } },
      async (server) => {
        const response = await fetch(`${server.url}/weather/SFO`);

        expect(response.status).toBe(402);
        expect(response.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
      },
    );
  });
});
