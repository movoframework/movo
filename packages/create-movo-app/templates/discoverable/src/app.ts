import { defineApp } from "@movoframework/core";
import { currentWeather, internalMetrics } from "./resources/weather.ts";

/**
 * The application: every resource this API serves.
 *
 * `movo bazaar validate` loads this file and runs upstream's own validators over the derived
 * declarations, so a field a facilitator would silently drop becomes an error you see first.
 */
export const app = defineApp({ resources: [currentWeather, internalMetrics] });

export default app;
