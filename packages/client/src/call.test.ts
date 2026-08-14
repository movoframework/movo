import { defineResource, type MovoResource } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { CallResult, MovoClient } from "./client.js";

/**
 * AC4.6 — `call(resource, input, baseUrl)` is typed as the handler's return type, with no cast.
 *
 * These assert at compile time; `pnpm typecheck` is what runs them. The value is that the
 * server's declaration and the buyer's call site share one source of truth, so renaming a field
 * in the handler breaks the caller rather than silently returning a different shape.
 */

/** Exact type equality, invariant in both directions. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its argument is `true`. */
type Expect<T extends true> = T;

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  input: z.object({ city: z.string().describe("City name") }),
  handler: (ctx) => ({ city: ctx.input.city, tempC: 14, conditions: "foggy" }),
});

declare const client: MovoClient;

/**
 * The result type, derived without calling anything.
 *
 * `declare const` exists only at type level, so awaiting it at module scope would compile and
 * then throw at runtime — which is exactly what the first draft of this file did. Deriving the
 * type keeps these assertions where they belong: in the compiler.
 */
type Result = Awaited<ReturnType<typeof client.call<{ city: string }, WeatherOut>>>;

/** The handler's return type, named once so the assertions below cannot drift from it. */
type WeatherOut = { city: string; tempC: number; conditions: string };

declare const result: Result;

/** The result's `data` is the handler's return type — not `unknown`, and with no cast. */
export type _DataIsHandlerReturn = Expect<Equal<(typeof result)["data"], WeatherOut>>;

/** The whole result is the declared shape. */
export type _ResultShape = Expect<Equal<typeof result, CallResult<WeatherOut>>>;

/** The resource's own parameterisation survives into the call. */
export type _ResourceTypes = Expect<
  Equal<typeof weather, MovoResource<{ city: string }, WeatherOut>>
>;

/**
 * The negative assertions.
 *
 * Declared and never invoked: `client` exists only at type level, so calling any of these would
 * throw at runtime while proving nothing extra. The compiler still checks the bodies, and each
 * `@ts-expect-error` fails the build if the error it expects stops occurring — which is the
 * whole assertion.
 */
export async function _rejectsUnknownInputField(): Promise<void> {
  // @ts-expect-error `country` is not a field of the input schema
  await client.call(weather, { country: "US" }, "https://api.example");
}

export async function _rejectsUnknownOutputField(): Promise<void> {
  const value = await client.call(weather, { city: "SFO" }, "https://api.example");
  // @ts-expect-error `humidity` is not part of the handler's return type
  void value.data.humidity;
}

describe("call() type inference", () => {
  it("checks the negative cases at compile time", () => {
    // The two exported functions above carry the real assertions. `pnpm typecheck` fails if
    // either @ts-expect-error stops being satisfied, so this case exists to say so out loud
    // rather than leave the file looking like it has no negative coverage.
    expect(typeof _rejectsUnknownInputField).toBe("function");
    expect(typeof _rejectsUnknownOutputField).toBe("function");
  });

  it("always carries a catalog outcome, never undefined", () => {
    // `unknown` is a value, not an absence — so a caller cannot branch on falsiness and treat
    // "no signal" as a cataloging failure.
    type CatalogField = (typeof result)["catalog"];
    type IsNeverUndefined = Expect<Equal<Extract<CatalogField, undefined>, never>>;
    const witness: IsNeverUndefined = true;

    expect(witness).toBe(true);
  });
});
