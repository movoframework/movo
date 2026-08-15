import { defineApp } from "@movoframework/core";
import { currentWeather } from "./resources/weather.ts";

/**
 * The application: every resource this API serves.
 *
 * `movo dev` and `movo doctor` both load this file, which is how they can list your routes and
 * validate your discovery metadata without a build step or a running server.
 */
export const app = defineApp({ resources: [currentWeather] });

export default app;
