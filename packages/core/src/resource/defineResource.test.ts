import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { MovoError } from "../errors/MovoError.js";
import { defineResource } from "./defineResource.js";
import type { MovoResource } from "./types.js";

const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function caught(run: () => unknown): MovoError {
  try {
    run();
  } catch (error) {
    return error as MovoError;
  }
  throw new Error("expected defineResource to throw, but it returned");
}

describe("method and path validation", () => {
  it("accepts a well-formed resource", () => {
    const resource = defineResource({
      method: "GET",
      path: "/weather/:city",
      price: "$0.001",
      handler: () => ({ tempC: 14 }),
    });
    expect(resource.path).toBe("/weather/:city");
  });

  it("rejects a method it does not compile", () => {
    expect(
      caught(() => defineResource({ method: "OPTIONS" as never, path: "/x", handler: () => 1 }))
        .code,
    ).toBe("MOVO_E_METHOD_INVALID");
  });

  it("rejects a path that does not begin with a slash", () => {
    expect(
      caught(() => defineResource({ method: "GET", path: "weather", handler: () => 1 })).code,
    ).toBe("MOVO_E_PATH_INVALID");
  });

  it("rejects a non-string path", () => {
    expect(
      caught(() => defineResource({ method: "GET", path: 42 as never, handler: () => 1 })).code,
    ).toBe("MOVO_E_PATH_INVALID");
  });

  it("rejects a wildcard path and explains why", () => {
    const error = caught(() =>
      defineResource({ method: "GET", path: "/files/*", handler: () => 1 }),
    );
    expect(error.code).toBe("MOVO_E_PATH_WILDCARD");
    expect(error.message).toContain("catalog key");
  });

  it("rejects a named wildcard too, not only the bare star", () => {
    expect(
      caught(() => defineResource({ method: "GET", path: "/files/*name", handler: () => 1 })).code,
    ).toBe("MOVO_E_PATH_WILDCARD");
  });

  it("accepts a named parameter, which is the intended replacement", () => {
    expect(defineResource({ method: "GET", path: "/files/:name", handler: () => 1 }).path).toBe(
      "/files/:name",
    );
  });

  it("rejects a resource with no handler", () => {
    expect(
      caught(() => defineResource({ method: "GET", path: "/x", handler: undefined as never })).code,
    ).toBe("MOVO_E_HANDLER_INVALID");
  });

  it("rejects a non-positive maxTimeoutSeconds", () => {
    expect(
      caught(() =>
        defineResource({ method: "GET", path: "/x", maxTimeoutSeconds: 0, handler: () => 1 }),
      ).code,
    ).toBe("MOVO_E_MAX_TIMEOUT_INVALID");
  });
});

describe("price rules (AC1.2)", () => {
  it("accepts a money string", () => {
    expect(
      defineResource({ method: "GET", path: "/x", price: "$0.001", handler: () => 1 }).price,
    ).toBe("$0.001");
  });

  it("accepts an asset amount naming a SEP-41 contract address", () => {
    const price = { asset: USDC_TESTNET, amount: "10000000" } as const;
    expect(defineResource({ method: "GET", path: "/x", price, handler: () => 1 }).price).toBe(
      price,
    );
  });

  it('throws MOVO_E_PRICE_ASSET_ALIAS for { asset: "USDC" }, naming all three facts', () => {
    const error = caught(() =>
      defineResource({
        method: "GET",
        path: "/x",
        price: { asset: "USDC" } as never,
        handler: () => 1,
      }),
    );

    expect(error.code).toBe("MOVO_E_PRICE_ASSET_ALIAS");
    expect(error.message).toContain("getUsdcAddress");
    expect(error.message).toContain("begins with C");
    expect(error.message).toContain("7 decimals");
    expect(error.message).toContain('"10000000"');
  });

  it("reports the alias problem before a missing amount, because the alias is the misconception", () => {
    // `{ asset: "USDC" }` has no amount either. Reporting the missing amount first would send
    // the reader off to add one and hit the real problem on the next run.
    expect(
      caught(() =>
        defineResource({
          method: "GET",
          path: "/x",
          price: { asset: "USDC" } as never,
          handler: () => 1,
        }),
      ).code,
    ).toBe("MOVO_E_PRICE_ASSET_ALIAS");
  });

  it("rejects a money string without the dollar prefix", () => {
    expect(
      caught(() =>
        defineResource({ method: "GET", path: "/x", price: "0.001" as never, handler: () => 1 }),
      ).code,
    ).toBe("MOVO_E_PRICE_INVALID");
  });

  it("rejects a bare number, whose units are ambiguous", () => {
    const error = caught(() =>
      defineResource({ method: "GET", path: "/x", price: 0.001 as never, handler: () => 1 }),
    );
    expect(error.code).toBe("MOVO_E_PRICE_INVALID");
    expect(error.message).toContain("a number of");
  });

  it("rejects a decimal point in a base-unit amount and points at convertToTokenAmount", () => {
    const error = caught(() =>
      defineResource({
        method: "GET",
        path: "/x",
        price: { asset: USDC_TESTNET, amount: "1.0" } as never,
        handler: () => 1,
      }),
    );
    expect(error.code).toBe("MOVO_E_PRICE_INVALID");
    expect(error.message).toContain("convertToTokenAmount");
  });

  it("rejects a numeric amount, which loses precision at 7 decimals", () => {
    expect(
      caught(() =>
        defineResource({
          method: "GET",
          path: "/x",
          price: { asset: USDC_TESTNET, amount: 10_000_000 } as never,
          handler: () => 1,
        }),
      ).code,
    ).toBe("MOVO_E_PRICE_INVALID");
  });

  it("rejects a price that is neither form", () => {
    expect(
      caught(() =>
        defineResource({ method: "GET", path: "/x", price: true as never, handler: () => 1 }),
      ).code,
    ).toBe("MOVO_E_PRICE_INVALID");
  });
});

// ─── Type-level tests ────────────────────────────────────────────────────────────────────
//
// These assert at compile time, not at run time: `pnpm typecheck` is what runs them. They are
// exported so that `noUnusedLocals` does not delete the very thing being asserted.

/** Exact type equality, invariant in both directions. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its argument is `true`. */
type Expect<T extends true> = T;

const inferred = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  input: z.object({ city: z.string().describe("City name or IATA code") }),
  handler: (ctx) => ({ city: ctx.input.city, tempC: 14, conditions: "foggy" }),
});

/** Extract the input type a resource's handler is given. */
type InputOf<T> = T extends MovoResource<infer TIn, unknown> ? TIn : never;

/** The input schema is the single source of the handler context's input type. */
export type _InputFlowsFromSchema = Expect<Equal<InputOf<typeof inferred>, { city: string }>>;

/** The handler's return type flows out to the resource, for the client's `call()` to consume. */
export type _OutputFlowsFromHandler = Expect<
  Equal<
    typeof inferred,
    MovoResource<{ city: string }, { city: string; tempC: number; conditions: string }>
  >
>;

const withOutputSchema = defineResource({
  method: "POST",
  path: "/quote",
  price: "$0.01",
  input: z.object({ symbol: z.string() }),
  output: z.object({ price: z.number() }),
  handler: () => ({ price: 1.5 }),
});

/** When an output schema is present it fixes the output type. */
export type _OutputSchemaFixesOutput = Expect<
  Equal<typeof withOutputSchema, MovoResource<{ symbol: string }, { price: number }>>
>;

const withoutSchemas = defineResource({
  method: "GET",
  path: "/ping",
  price: "$0.001",
  handler: () => "pong",
});

/** With no schemas, the input stays `unknown` and the output still flows from the handler. */
export type _NoSchemas = Expect<Equal<typeof withoutSchemas, MovoResource<unknown, string>>>;

describe("handler type inference", () => {
  it("rejects a handler whose return type contradicts the output schema", () => {
    defineResource({
      method: "GET",
      path: "/broken",
      price: "$0.001",
      output: z.object({ price: z.number() }),
      // @ts-expect-error the handler returns a string where the output schema says number
      handler: () => ({ price: "not a number" }),
    });
    expect(true).toBe(true);
  });

  it("rejects reading a field the input schema does not declare", () => {
    defineResource({
      method: "GET",
      path: "/broken-input",
      price: "$0.001",
      input: z.object({ city: z.string() }),
      // @ts-expect-error `country` is not a field of the input schema
      handler: (ctx) => ({ found: ctx.input.country }),
    });
    expect(true).toBe(true);
  });

  it("carries the inferred types through to a runtime value", async () => {
    const result = await inferred.handler({
      input: { city: "SFO" },
      params: { city: "SFO" },
      headers: {},
      correlationId: "test",
      payment: {
        verified: true,
        network: "stellar:testnet",
        asset: USDC_TESTNET,
        amount: "10000",
        requirements: {
          scheme: "exact",
          network: "stellar:testnet",
          asset: USDC_TESTNET,
          amount: "10000",
          payTo: "GDVA7IPVC6XGY7JSI36AYQ7NSWAXID32PCN4JHMJJLVCXWKIGKDZ5ST3",
          maxTimeoutSeconds: 60,
          extra: {},
        },
      },
      raw: { req: undefined, res: undefined },
    });

    expect(result).toEqual({ city: "SFO", tempC: 14, conditions: "foggy" });
  });
});
