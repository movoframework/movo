import { defineResource } from "@movoframework/core";
// `zod/v4`, not the classic entry. Only the v4 schema shape carries the internals that
// `toJSONSchema` reads, which is what lets Movo derive the listing's `inputSchema` for you. With
// a classic v3 schema Movo raises MOVO_W_DISCOVERY_SCHEMA_UNDERIVED and asks for an explicit
// `inputSchema` instead — it does not guess.
import { z } from "zod/v4";

/**
 * A discoverable paid resource.
 *
 * The thing to notice is what is absent. There is no discovery declaration duplicating the
 * route, no `inputSchema` written twice, no route template maintained by hand. All of it is
 * derived from this one declaration, so the listing cannot advertise a path that no longer
 * exists.
 */
export const currentWeather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  mimeType: "application/json",

  input: z.object({
    // `.describe()` is not decoration. An agent deciding whether to pay for this endpoint reads
    // the parameter descriptions; an undescribed parameter is one it has to guess at, and Movo
    // warns about it (MOVO_W_PARAM_UNDESCRIBED).
    city: z.string().describe("City name or IATA airport code, for example 'SFO'"),
  }),

  output: z.object({
    city: z.string(),
    tempC: z.number(),
    conditions: z.string(),
  }),

  discovery: {
    // Worth supplying rather than omitting. Upstream validates the example against the derived
    // schema, so a schema with required fields and no example produces a declaration that fails
    // its own consistency check — which Movo escalates to an error rather than letting it reach
    // a catalog.
    example: { city: "SFO" },
    outputExample: { city: "SFO", tempC: 14, conditions: "foggy" },
  },

  handler: (ctx) => ({
    city: ctx.params["city"] ?? "unknown",
    tempC: 14,
    conditions: "foggy",
  }),
});

/**
 * A resource deliberately kept out of the catalog.
 *
 * `discovery: false` is not the same as omitting the field. It states the intent, so a reader
 * can tell "we decided not to list this" from "nobody thought about it".
 */
export const internalMetrics = defineResource({
  method: "GET",
  path: "/internal/metrics",
  price: "$0.01",
  discovery: false,
  handler: () => ({ requests: 1024 }),
});
