import { defineResource, resolveConfig } from "@movoframework/core";
import { validateDiscoveryExtensionSpec } from "@movoframework/core/bazaar";
import { describe, expect, it } from "vitest";
// `zod/v4` rather than the classic entry: only the v4 schema shape carries the internals
// `toJSONSchema` reads. Movo reports that distinction as a finding rather than failing
// obscurely, and the test below asserts the classic path produces that finding.
import { z } from "zod/v4";
import { deriveDiscovery } from "./derive.js";
import { isJsonSchema, schemaVendor, toJsonSchema } from "./json-schema.js";

/**
 * Derivation, asserted against upstream's own validator.
 *
 * The headline assertion is the round-trip: whatever `deriveDiscovery` produces is handed
 * straight to `validateDiscoveryExtensionSpec` and must come back `valid: true` **unmodified**.
 * That is the check the discarded WIP could never have passed — it fed upstream the wrong
 * `input.type` and a Standard Schema object where JSON Schema was required, both hidden by
 * `any` (Spec Amendment 007 §2).
 */

const CONFIG = resolveConfig({ env: {}, config: { discovery: { enabled: true } } });

/** Every derived extension goes through upstream's validator, so no test can skip it. */
function expectValidUpstream(extension: Record<string, unknown> | undefined): void {
  expect(extension).toBeDefined();
  for (const declaration of Object.values(extension ?? {})) {
    const result = validateDiscoveryExtensionSpec(declaration as Record<string, unknown>);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  }
}

describe("HTTP derivation", () => {
  it("round-trips a GET through upstream validation unmodified (AC4.1)", async () => {
    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      description: "Current conditions",
      input: z.object({ city: z.string().describe("City name or IATA code") }),
      output: z.object({ tempC: z.number() }),
      discovery: { example: { city: "SFO" }, outputExample: { tempC: 14 } },
      handler: () => ({ tempC: 14 }),
    });

    const { extension, findings } = await deriveDiscovery(resource, CONFIG);

    expectValidUpstream(extension);
    expect(findings).toEqual([]);
  });

  it("derives real JSON Schema from the input validator, descriptions included", async () => {
    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      input: z.object({ city: z.string().describe("City name or IATA code") }),
      discovery: {},
      handler: () => ({ ok: true }),
    });

    const { extension } = await deriveDiscovery(resource, CONFIG);
    const serialised = JSON.stringify(extension);

    // The actual conversion, not a passed-through validator object. An agent reading the
    // listing sees the parameter and its description.
    expect(serialised).toContain('"city"');
    expect(serialised).toContain("City name or IATA code");
    expect(serialised).not.toContain("~standard");
  });

  it("sets bodyType for methods that carry one, and omits it for those that do not", async () => {
    const post = defineResource({
      method: "POST",
      path: "/quote",
      price: "$0.01",
      input: z.object({ symbol: z.string().describe("Ticker") }),
      discovery: {},
      handler: () => ({ price: 1 }),
    });
    const get = defineResource({
      method: "GET",
      path: "/quote",
      price: "$0.01",
      input: z.object({ symbol: z.string().describe("Ticker") }),
      discovery: {},
      handler: () => ({ price: 1 }),
    });

    const posted = await deriveDiscovery(post, CONFIG);
    const fetched = await deriveDiscovery(get, CONFIG);

    expectValidUpstream(posted.extension);
    expectValidUpstream(fetched.extension);

    // Upstream's body-method config requires bodyType; its query-method config has no such
    // field. The discarded WIP conflated the two and would have produced neither correctly.
    expect(JSON.stringify(posted.extension)).toContain("json");
    expect(JSON.stringify(fetched.extension)).not.toContain('"bodyType"');
  });

  it("honours an explicit bodyType", async () => {
    const resource = defineResource({
      method: "POST",
      path: "/upload",
      price: "$0.01",
      input: z.object({ file: z.string().describe("File contents") }),
      discovery: { bodyType: "form-data" },
      handler: () => ({ ok: true }),
    });

    const { extension } = await deriveDiscovery(resource, CONFIG);
    expectValidUpstream(extension);
    expect(JSON.stringify(extension)).toContain("form-data");
  });
});

describe("the inputSchema override (§22)", () => {
  it("wins over derivation", async () => {
    const override = {
      type: "object",
      properties: { city: { type: "string", description: "Hand-written" } },
      required: ["city"],
    };

    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      input: z.object({ city: z.string().describe("Derived") }),
      discovery: { inputSchema: override },
      handler: () => ({ ok: true }),
    });

    const { extension } = await deriveDiscovery(resource, CONFIG);

    expectValidUpstream(extension);
    expect(JSON.stringify(extension)).toContain("Hand-written");
    expect(JSON.stringify(extension)).not.toContain("Derived");
  });

  it("supplies a schema where derivation is impossible", async () => {
    // A Standard Schema from a vendor Movo has no converter for. Without the override there is
    // nothing to declare; with it, the listing is complete.
    const opaque = {
      "~standard": {
        version: 1 as const,
        vendor: "handrolled",
        validate: (value: unknown) => ({ value }),
      },
    };

    const withoutOverride = await deriveDiscovery(
      defineResource({
        method: "GET",
        path: "/opaque",
        price: "$0.001",
        input: opaque,
        discovery: {},
        handler: () => ({ ok: true }),
      }),
      CONFIG,
    );

    expect(withoutOverride.findings).toHaveLength(1);
    expect(withoutOverride.findings[0]?.id).toBe("bazaar.schema-underived");
    expect(withoutOverride.findings[0]?.detail).toContain("handrolled");

    const withOverride = await deriveDiscovery(
      defineResource({
        method: "GET",
        path: "/opaque",
        price: "$0.001",
        input: opaque,
        discovery: { inputSchema: { type: "object", properties: {} } },
        handler: () => ({ ok: true }),
      }),
      CONFIG,
    );

    expect(withOverride.findings).toEqual([]);
    expectValidUpstream(withOverride.extension);
  });
});

describe("MCP derivation (amendment 007 §3.1)", () => {
  it("dispatches on toolName through the single upstream function", async () => {
    const resource = defineResource({
      method: "POST",
      path: "/analyse",
      price: "$0.05",
      description: "Analyse financial data for a ticker",
      input: z.object({ ticker: z.string().describe("Ticker symbol") }),
      discovery: { toolName: "financial_analysis", transport: "streamable-http" },
      handler: () => ({ recommendation: "hold" }),
    });

    const { extension } = await deriveDiscovery(resource, CONFIG);

    expectValidUpstream(extension);
    const serialised = JSON.stringify(extension);
    expect(serialised).toContain("financial_analysis");
    expect(serialised).toContain("mcp");
  });
});

describe("opting out", () => {
  it("derives nothing when the resource sets discovery: false", async () => {
    const resource = defineResource({
      method: "GET",
      path: "/private",
      price: "$0.001",
      discovery: false,
      handler: () => ({ ok: true }),
    });

    expect(await deriveDiscovery(resource, CONFIG)).toEqual({ findings: [] });
  });

  it("derives nothing when discovery is disabled project-wide", async () => {
    const disabled = resolveConfig({ env: {}, config: { discovery: { enabled: false } } });
    const resource = defineResource({
      method: "GET",
      path: "/x",
      price: "$0.001",
      discovery: {},
      handler: () => ({ ok: true }),
    });

    expect(await deriveDiscovery(resource, disabled)).toEqual({ findings: [] });
  });
});

describe("schema resolution paths", () => {
  it("recognises a JSON Schema and passes it through", async () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(isJsonSchema(schema)).toBe(true);

    const resolved = await toJsonSchema(schema as never, undefined, "GET /x");
    expect(resolved.via).toBe("json-schema");
    expect(resolved.schema).toBe(schema);
  });

  it("does not mistake a Standard Schema for a JSON Schema", () => {
    expect(isJsonSchema(z.object({ a: z.string() }))).toBe(false);
  });

  it("reports the vendor it converted through", async () => {
    const resolved = await toJsonSchema(z.object({ a: z.string() }), undefined, "GET /x");
    expect(resolved.via).toBe("vendor");
    expect(resolved.vendor).toBe("zod");
    expect(schemaVendor(z.object({ a: z.string() }))).toBe("zod");
  });

  it("reports no schema, and no finding, when there is no input at all", async () => {
    const resolved = await toJsonSchema(undefined, undefined, "GET /x");
    expect(resolved.via).toBe("none");
    expect(resolved.finding).toBeUndefined();
  });
});
