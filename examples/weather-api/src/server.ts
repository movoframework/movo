/**
 * The weather API as a running process.
 *
 * Note what is *not* here: no header handling, no 402 construction, no payment state. Mounting
 * is one call, and the free route below is an ordinary Express route that the payment
 * middleware never touches.
 */

import { mountExpress } from "@movoframework/server";
import express from "express";
import { app, config } from "./app.js";

const server = express();
server.use(express.json());

/**
 * A free route, mounted before the paid ones.
 *
 * It costs nothing and requires no payment header. Only paths declared through
 * `defineResource` are protected — the middleware matches on the compiled route keys, so
 * everything else on this app is untouched.
 */
server.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const mounted = await mountExpress(server, app, { config: { config } });

const port = Number(process.env["PORT"] ?? 4021);
server.listen(port, () => {
  const resolved = mounted.compiled.resolvedConfig;
  process.stdout.write(
    [
      `weather-api listening on http://localhost:${String(port)}`,
      `  network   ${resolved.network.value} (from ${resolved.network.source})`,
      `  payTo     ${resolved.payTo.value ?? "UNSET"} (from ${resolved.payTo.source})`,
      `  facilitator ${resolved.facilitator.url.value} (from ${resolved.facilitator.url.source})`,
      "",
      "  free  GET /health",
      ...[...mounted.compiled.handlers.keys()].map((key) => `  paid  ${key}`),
      "",
    ].join("\n"),
  );
});
