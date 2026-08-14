/**
 * The discoverable API as a running process.
 *
 * `strictDiscovery` is on, which is the posture worth defaulting to in an example: a listing
 * that will silently lose fields should stop the server rather than ship quietly. Turn it off
 * if you would rather boot with a warning.
 */

import { mountExpress } from "@movoframework/server";
import express from "express";
import { app, config } from "./app.js";

const server = express();
server.use(express.json());

server.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const mounted = await mountExpress(server, app, {
  config: { config },
  strictDiscovery: true,
  onFinding: (finding) => {
    process.stdout.write(`[${finding.level}] ${finding.title}\n`);
    if (finding.fix !== undefined) process.stdout.write(`        fix: ${finding.fix}\n`);
  },
});

const port = Number(process.env["PORT"] ?? 4022);
server.listen(port, () => {
  const resolved = mounted.compiled.resolvedConfig;
  process.stdout.write(
    [
      `discoverable-api listening on http://localhost:${String(port)}`,
      `  network     ${resolved.network.value} (from ${resolved.network.source})`,
      `  payTo       ${resolved.payTo.value ?? "UNSET"} (from ${resolved.payTo.source})`,
      `  serviceName ${resolved.discovery.serviceName.value ?? "unset"}`,
      "",
      "  free  GET /health",
      ...[...mounted.compiled.handlers.keys()].map((key) => `  paid  ${key}`),
      "",
      `  declaring discovery: ${mounted.compiled.discoveryDeclared.join(", ") || "none"}`,
      "",
      "Declaring metadata does NOT create a Bazaar listing. A listing is created by the",
      "facilitator you configured, when a buyer pays and echoes your declaration, and only if",
      "that facilitator operates a catalog. See docs/bazaar/overview.md.",
      "",
    ].join("\n"),
  );
});
