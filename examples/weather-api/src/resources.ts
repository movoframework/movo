/**
 * The weather API's resources: one paid, one free.
 *
 * The pair is the point. A real service is rarely paid end to end — it has a health endpoint, a
 * catalogue, a landing page. Showing both in one example makes the boundary explicit: a route
 * is paid because it was declared with `defineResource` and mounted behind the payment
 * middleware, and everything else on the same Express app is untouched.
 */

import { defineResource } from "@movoframework/core";
import { z } from "zod";

/**
 * The paid route.
 *
 * `$0.001` is a money string, which upstream's Stellar scheme converts to base units against
 * the asset's real decimals. Movo performs no conversion of its own — see
 * docs/concepts/resources.md.
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
    observedAt: z.string(),
  }),

  discovery: {
    example: { city: "SFO" },
    outputExample: {
      city: "SFO",
      tempC: 14,
      conditions: "foggy",
      observedAt: "2026-08-12T09:00:00.000Z",
    },
  },

  handler: (ctx) => {
    const city = ctx.params["city"] ?? "unknown";
    // A real service would call a weather provider here. What matters for the example is that
    // this function only runs after a payment has been verified, and that its return value is
    // withheld if settlement then fails.
    return {
      city,
      tempC: 14,
      conditions: "foggy",
      observedAt: new Date().toISOString(),
    };
  },
});
