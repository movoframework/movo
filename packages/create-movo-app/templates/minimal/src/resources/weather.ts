import { defineResource } from "@movoframework/core";

/**
 * One paid resource.
 *
 * A `defineResource` call is a single declaration carrying the route, the price and the handler.
 * There is no routes object to keep in sync with the handler, and no price table to keep in sync
 * with either — which is the drift Movo exists to remove.
 *
 * The handler's return type is inferred, and a buyer calling this through `@movoframework/client`
 * gets that exact type at the call site with no cast.
 */
export const currentWeather = defineResource({
  method: "GET",
  path: "/weather/:city",

  // Prices are strings, never numbers. A float in a money field is a rounding bug waiting for a
  // sufficiently large amount; `$0.001` is unambiguous and stays that way.
  price: "$0.001",

  description: "Current weather conditions for a city",
  mimeType: "application/json",

  handler: (ctx) => ({
    city: ctx.params["city"] ?? "unknown",
    tempC: 14,
    conditions: "foggy",
  }),
});
