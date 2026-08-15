import { mountExpress } from "@movoframework/server";
import express from "express";
import { config } from "../movo.config.ts";
import { app } from "./app.ts";

/**
 * The server, for `npm start` and for production.
 *
 * `movo dev` does **not** run this file — it runs its own runner so that
 * `--facilitator in-process|mock` can be resolved by the CLI, which is the only package allowed
 * to depend on `@movoframework/testing`. Keep this file as the plain production path.
 */
const server = express();
server.use(express.json());

// A free route, mounted before the payment middleware. Health checks should not cost money.
server.get("/health", (_request, response) => {
  response.json({ ok: true });
});

const mounted = await mountExpress(server, app, {
  config: { config },
  onFinding: (finding) => {
    if (finding.level === "ok") return;
    process.stdout.write(`[${finding.level}] ${finding.title}\n`);
    if (finding.fix !== undefined) process.stdout.write(`        fix: ${finding.fix}\n`);
  },
});

const port = Number(process.env["PORT"] ?? 4021);

server.listen(port, () => {
  const resolved = mounted.compiled.resolvedConfig;
  process.stdout.write(
    [
      `listening on http://localhost:${String(port)}`,
      `  network  ${resolved.network.value} (from ${resolved.network.source})`,
      `  payTo    ${resolved.payTo.value ?? "UNSET — set MOVO_PAY_TO"} (from ${resolved.payTo.source})`,
      "",
      "  free  GET /health",
      ...[...mounted.compiled.handlers.keys()].map((key) => `  paid  ${key}`),
      "",
    ].join("\n"),
  );
});
