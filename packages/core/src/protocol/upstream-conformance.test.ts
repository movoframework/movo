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

describe("the Bazaar surface, as installed", () => {
  it("exposes one declareDiscoveryExtension, not a separate MCP variant (amendment 007 §3.1)", async () => {
    // Spec §22 names `declareMcpDiscoveryExtension` alongside `declareDiscoveryExtension`. The
    // installed package exports only the latter, dispatching on `toolName`. Asserted rather
    // than assumed, because deriveDiscovery's MCP path depends on it.
    const bazaar = await import("@x402/extensions/bazaar");

    expect(typeof bazaar.declareDiscoveryExtension).toBe("function");
    expect("declareMcpDiscoveryExtension" in bazaar).toBe(false);
  });

  it("still exports no public EXTENSION-RESPONSES decoder (amendment 007 §3.2)", async () => {
    // The gap that justifies `readCatalogOutcome` existing in Movo at all. If upstream ever
    // ships one, this fails and Movo should delete its decoder and delegate.
    const [core, http, extensions] = await Promise.all([
      import("@x402/core"),
      import("@x402/core/http"),
      import("@x402/extensions/bazaar"),
    ]);

    const names = [...Object.keys(core), ...Object.keys(http), ...Object.keys(extensions)];
    const decoders = names.filter(
      (name) => /extensionresponse/i.test(name) && /decode|parse|read/i.test(name),
    );

    expect(decoders).toEqual([]);
  });

  it("validates service metadata, icon URLs and route templates itself (D3)", async () => {
    // The D3 baseline, asserted so that "upstream already does this" is a checked claim rather
    // than a remembered one. Every rule below is a rule Movo must NOT reimplement.
    const bazaar = await import("@x402/extensions/bazaar");

    expect(bazaar.isValidServiceName("Example Weather")).toBe(true);
    expect(bazaar.isValidServiceName("x".repeat(33))).toBe(false);
    expect(bazaar.isValidServiceName("café")).toBe(false);

    expect(bazaar.isValidIconUrl("https://example.com/i.png")).toBe(true);
    expect(bazaar.isValidIconUrl("http://127.0.0.1/i.png")).toBe(false);
    expect(bazaar.isValidIconUrl("http://localhost/i.png")).toBe(false);
    expect(bazaar.isValidIconUrl("https://192.168.1.5/i.png")).toBe(false);

    expect(bazaar.sanitizeTags(["a", "b", "c", "d", "e", "f"])).toHaveLength(5);
    expect(bazaar.sanitizeTags(["café", "ok"])).toEqual(["ok"]);

    // Percent-encoded traversal, which the discarded WIP reimplemented as its own contribution.
    expect(bazaar.validateRouteTemplate("%2e%2e%2f")).toBeUndefined();
    expect(bazaar.validateRouteTemplate("/../etc")).toBeUndefined();
    expect(bazaar.validateRouteTemplate("/users/:id")).toBe("/users/:id");
  });

  it("returns { valid, errors } from its validators rather than throwing", async () => {
    // The specific defect in the discarded validate.ts: it wrapped upstream in a try/catch and
    // discarded the return value, so the one real delegation in the file was a no-op catching
    // an exception that never comes (amendment 007 §1).
    const bazaar = await import("@x402/extensions/bazaar");

    const result = bazaar.validateDiscoveryExtensionSpec({ nonsense: true });

    expect(result).toHaveProperty("valid");
    expect(result.valid).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
