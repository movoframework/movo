import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compileApp } from "./compile.js";
import { defineApp } from "./defineApp.js";
import { defineResource } from "./defineResource.js";

/**
 * Type-level regression tests for `AnyMovoResource`.
 *
 * The bug these exist for: `AnyMovoResource` was first written as `MovoResource<never, unknown>`,
 * which erases the handler context correctly and the schemas exactly backwards. A schema is
 * covariant in its output, so `StandardSchemaV1<unknown, unknown>` is not assignable to
 * `StandardSchemaV1<unknown, never>` — and the symptom was that the most ordinary code in the
 * documentation, a list of resources with different input types, would not compile.
 *
 * It was caught by the documentation gate rather than by the unit suite, because every test
 * happened to build its list from resources that inferred compatibly. That is worth recording:
 * the docs exercised a shape the tests did not.
 */

const PAY_TO = "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3";

const noSchemas = defineResource({
  method: "GET",
  path: "/ping",
  price: "$0.001",
  handler: () => "pong",
});

const withInput = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  input: z.object({ city: z.string().describe("City name") }),
  handler: (ctx) => ({ city: ctx.input.city, tempC: 14 }),
});

const withDifferentInput = defineResource({
  method: "POST",
  path: "/quote",
  price: "$0.01",
  input: z.object({ symbol: z.string().describe("Ticker") }),
  output: z.object({ price: z.number() }),
  handler: (ctx) => ({ price: ctx.input.symbol.length }),
});

describe("a heterogeneous resource list", () => {
  it("accepts resources with no schema, with an input schema, and with both", () => {
    // The assertion is that this file compiles. `pnpm typecheck` is what runs it; the runtime
    // expectation below only keeps the value alive.
    const app = defineApp({ resources: [noSchemas, withInput, withDifferentInput] });
    expect(app.resources).toHaveLength(3);
  });

  it("compiles that list into routes", () => {
    const compiled = compileApp(
      defineApp({ resources: [noSchemas, withInput, withDifferentInput] }),
      {
        config: { payTo: PAY_TO },
        env: {},
      },
    );

    expect(Object.keys(compiled.routes).sort()).toEqual([
      "GET /ping",
      "GET /weather/:city",
      "POST /quote",
    ]);
  });

  it("keeps each resource's own handler reachable through the compiled map", () => {
    const compiled = compileApp(defineApp({ resources: [noSchemas, withInput] }), {
      config: { payTo: PAY_TO },
      env: {},
    });

    expect(compiled.handlers.get("GET /ping")?.resource).toBe(noSchemas);
    expect(compiled.handlers.get("GET /weather/:city")?.resource).toBe(withInput);
  });
});
