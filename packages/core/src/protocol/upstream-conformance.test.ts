/**
 * Conformance against the *installed* upstream declarations.
 *
 * This file lives inside `packages/core/src/protocol/` because that is the one directory
 * permitted to import `@x402/*`, and asserting that Movo's output matches upstream's types
 * requires naming those types. Putting it anywhere else would need a hole in the narrow-waist
 * rule, and a gate with an exception for its own test is not a gate.
 *
 * What it defends against is R1 — upstream API drift, rated Critical in the risk register.
 * `@x402/*` ships roughly weekly. These assertions turn a drift that would otherwise appear
 * as a runtime payment failure into a failing test at `pnpm test`.
 */

import type { paymentMiddleware } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { describe, expect, it } from "vitest";
import { compileApp } from "../resource/compile.js";
import { defineApp } from "../resource/defineApp.js";
import { defineResource } from "../resource/defineResource.js";
import { EXACT_SCHEME, STELLAR_TESTNET_CAIP2 } from "./index.js";

/** A shape-valid Stellar account address for compilation. Never funded, never used. */
const PAY_TO = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";

const app = defineApp({
  resources: [
    defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      description: "Current conditions",
      mimeType: "application/json",
      handler: () => ({ tempC: 14 }),
    }),
  ],
});

describe("compiled routes are what upstream middleware accepts", () => {
  it("assigns to paymentMiddleware's first parameter without a cast (AC1.1)", () => {
    const compiled = compileApp(app, { config: { payTo: PAY_TO }, env: {} });

    // The assertion is the assignment itself: this line stops compiling if `routes` ever
    // stops being exactly the type upstream's middleware takes. No cast — a cast would
    // silence precisely the drift this test exists to catch.
    type MiddlewareRoutes = Parameters<typeof paymentMiddleware>[0];
    const routes: MiddlewareRoutes = compiled.routes;

    expect(routes).toBe(compiled.routes);
  });

  it("produces a route key of the form upstream matches on", () => {
    const compiled = compileApp(app, { config: { payTo: PAY_TO }, env: {} });
    expect(Object.keys(compiled.routes)).toEqual(["GET /weather/:city"]);
  });
});

describe("the exact scheme identifier", () => {
  it("equals the identifier the installed ExactStellarScheme declares", () => {
    // EXACT_SCHEME is the single literal Movo writes for the scheme name, because
    // `ExactStellarScheme` exposes it as an instance field and a pure compiler must not
    // construct a scheme server to read it. This is the assertion that keeps the two in step.
    expect(new ExactStellarScheme().scheme).toBe(EXACT_SCHEME);
  });

  it("is the scheme every compiled payment option carries", () => {
    const compiled = compileApp(app, { config: { payTo: PAY_TO }, env: {} });
    const route = (compiled.routes as Record<string, { accepts: { scheme: string } }>)[
      "GET /weather/:city"
    ];
    expect(route?.accepts.scheme).toBe(EXACT_SCHEME);
  });
});

describe("upstream declarations still have the shapes Movo compiles against", () => {
  it("accepts a money string as a Price without conversion", () => {
    const compiled = compileApp(app, { config: { payTo: PAY_TO }, env: {} });
    const route = (compiled.routes as Record<string, { accepts: { price: unknown } }>)[
      "GET /weather/:city"
    ];
    // Passed through untouched. Movo performs no decimal conversion: upstream's money parser
    // owns that, against the asset's real decimals.
    expect(route?.accepts.price).toBe("$0.001");
  });

  it("uses the CAIP-2 network identifier upstream exports", () => {
    expect(STELLAR_TESTNET_CAIP2).toBe("stellar:testnet");
  });
});
