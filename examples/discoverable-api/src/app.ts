/**
 * A paid API that is discoverable — with the metadata derived from the resource, not written
 * alongside it.
 *
 * The thing to notice is what is absent. There is no discovery declaration to keep in sync with
 * the route, no `inputSchema` written twice, no route template maintained by hand. The listing
 * is derived from this one declaration, so it cannot advertise a path that no longer exists.
 */

import { defineApp, defineConfig, defineResource } from "@movoframework/core";
// `zod/v4` rather than the classic entry: only the v4 schema shape carries the internals
// `toJSONSchema` reads, so this is what lets Movo derive the listing's inputSchema for you.
// With a classic v3 schema Movo raises MOVO_W_DISCOVERY_SCHEMA_UNDERIVED and asks for an
// explicit `inputSchema` instead — it does not guess.
import { z } from "zod/v4";

export const config = defineConfig({
  env: "testnet",
  network: "stellar:testnet",
  payTo: process.env["MOVO_PAY_TO"],
  facilitator: { url: process.env["MOVO_FACILITATOR_URL"] ?? "https://www.x402.org/facilitator" },
  discovery: {
    enabled: true,
    serviceName: "Example Weather",
    tags: ["weather", "forecast"],
    iconUrl: "https://raw.githubusercontent.com/movoframework/movo/main/docs/icon.png",
  },
});

/**
 * The discoverable resource.
 *
 * `discovery.example` is worth supplying rather than omitting. Upstream validates the example
 * against the derived schema, so a schema with required fields and no example produces a
 * declaration that fails its own consistency check — Movo escalates that to an error rather than
 * letting it reach a catalog.
 */
export const currentWeather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions for a city",
  mimeType: "application/json",

  input: z.object({
    city: z.string().describe("City name or IATA airport code, for example 'SFO'"),
  }),
  output: z.object({
    city: z.string(),
    tempC: z.number(),
    conditions: z.string(),
  }),

  discovery: {
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
 * `discovery: false` is not the same as omitting the field. It states the intent explicitly, so
 * a reader can tell "we decided not to list this" from "nobody thought about it".
 */
export const internalMetrics = defineResource({
  method: "GET",
  path: "/internal/metrics",
  price: "$0.01",
  discovery: false,
  handler: () => ({ requests: 1024 }),
});

export const app = defineApp({ resources: [currentWeather, internalMetrics] });
