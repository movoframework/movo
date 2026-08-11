import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MovoError } from "../errors/MovoError.js";
import type { RouteConfig } from "../protocol/index.js";
import { compileApp, routeKeyFor } from "./compile.js";
import { defineApp } from "./defineApp.js";
import { defineResource } from "./defineResource.js";

const PAY_TO = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";
const PAY_TO_RESOURCE = "GDIONU2OOPFE5TAVLPNITGJH6KUIEAHJOTG2SDH3D332LNJ5B6C5LCAR";
const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const BASE = { config: { payTo: PAY_TO }, env: {} } as const;

function routesOf(routes: unknown): Record<string, RouteConfig> {
  return routes as Record<string, RouteConfig>;
}

/** The single payment option on a compiled route, as a plain record for assertion. */
function acceptsOf(route: RouteConfig | undefined): Record<string, unknown> {
  if (route === undefined) throw new Error("expected a compiled route, found none");
  return route.accepts as unknown as Record<string, unknown>;
}

function caught(run: () => unknown): MovoError {
  try {
    run();
  } catch (error) {
    return error as MovoError;
  }
  throw new Error("expected compileApp to throw, but it returned");
}

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather for a city",
  mimeType: "application/json",
  handler: () => ({ tempC: 14 }),
});

describe("route keys", () => {
  it("are the method and the path, separated by a space", () => {
    expect(routeKeyFor("GET", "/weather/:city")).toBe("GET /weather/:city");
  });

  it("key the compiled routes and the handler map identically", () => {
    const compiled = compileApp(defineApp({ resources: [weather] }), BASE);
    expect(Object.keys(compiled.routes)).toEqual([...compiled.handlers.keys()]);
  });
});

describe("compiled payment options", () => {
  it("carry the network, payTo, price and timeout that resolution produced", () => {
    const compiled = compileApp(defineApp({ resources: [weather] }), BASE);
    const route = routesOf(compiled.routes)["GET /weather/:city"];

    expect(route?.accepts).toEqual({
      scheme: "exact",
      network: "stellar:testnet",
      payTo: PAY_TO,
      price: "$0.001",
      maxTimeoutSeconds: 60,
    });
  });

  it("let a resource override the payTo it would otherwise inherit", () => {
    const resource = defineResource({
      method: "GET",
      path: "/premium",
      price: "$1.00",
      payTo: PAY_TO_RESOURCE,
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [resource] }), BASE);
    const route = routesOf(compiled.routes)["GET /premium"];

    expect(acceptsOf(route)["payTo"]).toBe(PAY_TO_RESOURCE);
  });

  it("pass an asset amount through untouched, performing no conversion", () => {
    const price = { asset: USDC_TESTNET, amount: "10000000" } as const;
    const resource = defineResource({ method: "GET", path: "/asset", price, handler: () => 1 });
    const compiled = compileApp(defineApp({ resources: [resource] }), BASE);

    expect(acceptsOf(routesOf(compiled.routes)["GET /asset"])["price"]).toBe(price);
  });

  it("inherit the price from config defaults when the resource states none", () => {
    const resource = defineResource({ method: "GET", path: "/cheap", handler: () => 1 });
    const compiled = compileApp(defineApp({ resources: [resource] }), {
      config: { payTo: PAY_TO, defaults: { price: "$0.002" } },
      env: {},
    });

    expect(acceptsOf(routesOf(compiled.routes)["GET /cheap"])["price"]).toBe("$0.002");
  });
});

describe("optional route metadata", () => {
  it("includes only the fields the resource actually set", () => {
    const compiled = compileApp(defineApp({ resources: [weather] }), BASE);
    const route = routesOf(compiled.routes)["GET /weather/:city"];

    expect(Object.keys(route ?? {}).sort()).toEqual(["accepts", "description", "mimeType"].sort());
  });

  it("never writes a present-but-undefined field", () => {
    // `exactOptionalPropertyTypes` makes `{ description: undefined }` distinct from `{}`, and
    // upstream reads the former as a value — which reaches a buyer's catalog as an empty
    // description rather than an absent one.
    const bare = defineResource({
      method: "GET",
      path: "/bare",
      price: "$0.001",
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [bare] }), BASE);
    const route = routesOf(compiled.routes)["GET /bare"];

    expect(Object.hasOwn(route ?? {}, "description")).toBe(false);
    expect(Object.hasOwn(route ?? {}, "tags")).toBe(false);
  });

  it("copies tags into a fresh array rather than sharing the resource's own", () => {
    const tags = ["weather", "forecast"];
    const resource = defineResource({
      method: "GET",
      path: "/tagged",
      price: "$0.001",
      tags,
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [resource] }), BASE);
    const route = routesOf(compiled.routes)["GET /tagged"];

    expect(route?.tags).toEqual(tags);
    expect(route?.tags).not.toBe(tags);
  });

  it("falls back to project-level discovery metadata", () => {
    const resource = defineResource({
      method: "GET",
      path: "/svc",
      price: "$0.001",
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [resource] }), {
      config: {
        payTo: PAY_TO,
        discovery: { enabled: true, serviceName: "Example Weather", tags: ["weather"] },
      },
      env: {},
    });
    const route = routesOf(compiled.routes)["GET /svc"];

    expect(route?.serviceName).toBe("Example Weather");
    expect(route?.tags).toEqual(["weather"]);
  });
});

describe("compile-time failures", () => {
  it("rejects two resources compiling to the same route key", () => {
    const a = defineResource({ method: "GET", path: "/dup", price: "$0.001", handler: () => 1 });
    const b = defineResource({ method: "GET", path: "/dup", price: "$0.002", handler: () => 2 });

    expect(caught(() => compileApp(defineApp({ resources: [a, b] }), BASE)).code).toBe(
      "MOVO_E_ROUTE_DUPLICATE",
    );
  });

  it("permits the same path under different methods", () => {
    const get = defineResource({
      method: "GET",
      path: "/thing",
      price: "$0.001",
      handler: () => 1,
    });
    const post = defineResource({
      method: "POST",
      path: "/thing",
      price: "$0.001",
      handler: () => 2,
    });

    expect(
      Object.keys(compileApp(defineApp({ resources: [get, post] }), BASE).routes).sort(),
    ).toEqual(["GET /thing", "POST /thing"]);
  });

  it("rejects a resource with no payTo anywhere", () => {
    const resource = defineResource({
      method: "GET",
      path: "/x",
      price: "$0.001",
      handler: () => 1,
    });
    expect(caught(() => compileApp(defineApp({ resources: [resource] }), { env: {} })).code).toBe(
      "MOVO_E_PAYTO_MISSING",
    );
  });

  it("rejects a resource with no price anywhere", () => {
    const resource = defineResource({ method: "GET", path: "/x", handler: () => 1 });
    expect(caught(() => compileApp(defineApp({ resources: [resource] }), BASE)).code).toBe(
      "MOVO_E_PRICE_MISSING",
    );
  });

  it("defers config-dependent failures to compile time, not definition time", () => {
    // Defining the resource is fine — whether it is missing a payTo is unknowable until
    // configuration is present. This is the split spec §5.2 describes.
    expect(() =>
      defineResource({ method: "GET", path: "/later", price: "$0.001", handler: () => 1 }),
    ).not.toThrow();
  });

  it("rejects discovery metadata when discovery is disabled", () => {
    const resource = defineResource({
      method: "GET",
      path: "/discoverable",
      price: "$0.001",
      discovery: { example: { city: "SFO" } },
      handler: () => 1,
    });

    expect(
      caught(() =>
        compileApp(defineApp({ resources: [resource] }), {
          config: { payTo: PAY_TO, discovery: { enabled: false } },
          env: {},
        }),
      ).code,
    ).toBe("MOVO_E_DISCOVERY_DISABLED");
  });
});

describe("discovery declaration", () => {
  it("lists route keys that declare discovery metadata", () => {
    const discoverable = defineResource({
      method: "GET",
      path: "/discoverable",
      price: "$0.001",
      discovery: { example: { city: "SFO" } },
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [discoverable, weather] }), BASE);

    expect(compiled.discoveryDeclared).toEqual(["GET /discoverable"]);
  });

  it("treats discovery: false as an explicit opt-out, not as metadata", () => {
    const opted = defineResource({
      method: "GET",
      path: "/private",
      price: "$0.001",
      discovery: false,
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [opted] }), {
      config: { payTo: PAY_TO, discovery: { enabled: false } },
      env: {},
    });

    expect(compiled.discoveryDeclared).toEqual([]);
  });

  it("emits no bazaar extension at M1", () => {
    const discoverable = defineResource({
      method: "GET",
      path: "/discoverable",
      price: "$0.001",
      discovery: { example: { city: "SFO" } },
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [discoverable] }), BASE);

    expect(routesOf(compiled.routes)["GET /discoverable"]?.extensions).toBeUndefined();
  });
});

describe("static diagnostics", () => {
  it("warns about an input field with no description", () => {
    const resource = defineResource({
      method: "GET",
      path: "/undescribed",
      price: "$0.001",
      input: z.object({ city: z.string(), units: z.string().describe("metric or imperial") }),
      handler: () => 1,
    });
    const compiled = compileApp(defineApp({ resources: [resource] }), BASE);

    expect(compiled.diagnostics).toHaveLength(1);
    expect(compiled.diagnostics[0]?.id).toBe("resource.param-undescribed");
    expect(compiled.diagnostics[0]?.level).toBe("warn");
    expect(compiled.diagnostics[0]?.title).toContain('"city"');
  });

  it("stays quiet when every field is described", () => {
    const resource = defineResource({
      method: "GET",
      path: "/described",
      price: "$0.001",
      input: z.object({ city: z.string().describe("City name or IATA code") }),
      handler: () => 1,
    });

    expect(compileApp(defineApp({ resources: [resource] }), BASE).diagnostics).toEqual([]);
  });

  it("reports nothing for a schema it cannot introspect", () => {
    // Standard Schema exposes validation, not introspection. A non-Zod-shaped schema produces
    // no finding rather than a false one.
    const opaque = {
      "~standard": {
        version: 1 as const,
        vendor: "fixture",
        validate: (value: unknown) => ({ value }),
      },
    };
    const resource = defineResource({
      method: "GET",
      path: "/opaque",
      price: "$0.001",
      input: opaque,
      handler: () => 1,
    });

    expect(compileApp(defineApp({ resources: [resource] }), BASE).diagnostics).toEqual([]);
  });

  it("carries the registry's fix text and docs URL onto the finding", () => {
    const resource = defineResource({
      method: "GET",
      path: "/undescribed",
      price: "$0.001",
      input: z.object({ city: z.string() }),
      handler: () => 1,
    });
    const finding = compileApp(defineApp({ resources: [resource] }), BASE).diagnostics[0];

    expect(finding?.fix).toContain("describe(");
    expect(finding?.docs).toContain("MOVO_W_PARAM_UNDESCRIBED");
  });
});

describe("purity", () => {
  it("produces the same output for the same input", () => {
    const app = defineApp({ resources: [weather] });
    expect(compileApp(app, BASE).routes).toEqual(compileApp(app, BASE).routes);
  });

  it("returns the application-level resolved config, with provenance", () => {
    const compiled = compileApp(defineApp({ resources: [weather] }), BASE);
    expect(compiled.resolvedConfig.payTo).toEqual({ value: PAY_TO, source: "config" });
  });

  it("compiles an application with no resources at all", () => {
    const compiled = compileApp(defineApp({ resources: [] }), BASE);
    expect(compiled.routes).toEqual({});
    expect(compiled.handlers.size).toBe(0);
  });
});

describe("defineApp", () => {
  it("rejects anything that is not a resource list", () => {
    expect(caught(() => defineApp({ resources: "nope" as never })).code).toBe("MOVO_E_APP_INVALID");
  });

  it("rejects an entry that is not a resource", () => {
    expect(caught(() => defineApp({ resources: [{ method: "GET" } as never] })).code).toBe(
      "MOVO_E_APP_INVALID",
    );
  });

  it("keeps the resource list it was given", () => {
    expect(defineApp({ resources: [weather] }).resources).toEqual([weather]);
  });
});
