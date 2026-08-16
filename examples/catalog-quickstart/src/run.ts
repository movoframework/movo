/**
 * A paid API that becomes discoverable, and gets paid — with no registration step anywhere.
 *
 * This is the whole M7 thesis in one runnable file. Watch for what is **absent**: there is no
 * call to a registration endpoint, no API key, no catalog SDK, no "publish" step. The seller
 * declares discovery metadata on their resource (see `@movoframework/example-discoverable-api`,
 * which this imports unchanged), somebody pays them once, and the facilitator that settled the
 * payment catalogues it.
 *
 * The four moments, in order:
 *
 *   1. a facilitator starts, with a catalog attached to its settle path
 *   2. the seller's API starts, pointed at that facilitator
 *   3. a buyer pays once — one real testnet transaction
 *   4. the endpoint is in `GET /discovery/resources`, and `GET /discovery/search` finds it by
 *      natural language
 *
 * Step 4 is a consequence of step 3. Nothing between them is a registration.
 *
 * ## Running it
 *
 *   STELLAR_PRIVATE_KEY=S…    a funded testnet buyer holding USDC
 *   MOVO_PAY_TO=G…            the seller's address
 *   MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS=S…,S…   funded sponsor seeds for the facilitator
 *
 *   pnpm --filter @movoframework/example-catalog-quickstart start
 *
 * It moves real testnet value — a tenth of a cent — and refuses to run against pubnet.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { createCatalog, SqliteCatalogStore } from "@movoframework/catalog";
import { createBudget, createMovoClient } from "@movoframework/client";
import { STELLAR_PUBNET_CAIP2 } from "@movoframework/core";
import { createEd25519Signer } from "@movoframework/core/client";
import { app, config, currentWeather } from "@movoframework/example-discoverable-api";
import { createFacilitator, facilitatorConfigFromEnv } from "@movoframework/facilitator";
import { createFacilitatorApp } from "@movoframework/facilitator-service";
import { createCatalogObserver } from "@movoframework/facilitator-service/catalog-wiring";
import { mountExpress } from "@movoframework/server";
import express from "express";

const NETWORK = "stellar:testnet";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required. See the header of this file for what each variable is.`);
  }
  return value;
}

if ((process.env["MOVO_NETWORK"] ?? NETWORK) === STELLAR_PUBNET_CAIP2) {
  throw new Error("this example is testnet-only and refuses to run against pubnet");
}

const buyerSecret = required("STELLAR_PRIVATE_KEY");
const payTo = required("MOVO_PAY_TO");
required("MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS");

const write = (line: string): void => void process.stdout.write(`${line}\n`);

// ── 1. A facilitator, with a catalog on its settle path ───────────────────────────────────
//
// `createCatalogObserver` is the entirety of "automatic cataloguing". The observer cannot abort,
// retry or alter a settlement — it receives a finished result and decides only what to put in
// EXTENSION-RESPONSES. A catalog that could fail a payment would make discovery a liability for
// every seller using the facilitator.

const store = await SqliteCatalogStore.open(":memory:");
const catalog = createCatalog({ store, embedder: undefined });

const facilitator = createFacilitator(facilitatorConfigFromEnv(process.env), [
  createCatalogObserver({ catalog }),
]);
const facilitatorServer = serve({
  fetch: createFacilitatorApp({ facilitator, catalog, log: () => undefined }).fetch,
  port: 0,
});
const facilitatorUrl = `http://127.0.0.1:${String((facilitatorServer.address() as AddressInfo).port)}`;
write(`facilitator  ${facilitatorUrl}`);

// ── 2. The seller's API, pointed at it ────────────────────────────────────────────────────
//
// The resource is imported unmodified from the discoverable-api example. Nothing about it knows
// this catalog exists.

const application = express();
application.use(express.json());
await mountExpress(application as never, app, {
  config: {
    // The example's own defineConfig carries serviceName, tags and iconUrl — the fields a
    // buyer actually reads in a search result. Passing only `env` and `argument` here would
    // mount the same routes with none of that metadata, and the listing would arrive unnamed.
    config,
    env: process.env,
    // Only the facilitator is overridden: this run needs the local one, not the public default.
    argument: { facilitator: { url: facilitatorUrl } },
  },
});
const seller: Server = createServer(application);
await new Promise<void>((resolve) => seller.listen(0, "127.0.0.1", resolve));
const sellerUrl = `http://127.0.0.1:${String((seller.address() as AddressInfo).port)}`;
write(`seller       ${sellerUrl}`);

write("");
write("catalog before any payment:");
write(`  ${String((await catalog.list({})).items.length)} listing(s)`);

// ── 3. One payment ────────────────────────────────────────────────────────────────────────

const budget = createBudget({
  maxAmountPerRequest: "100000",
  maxTotalSpend: "1000000",
  allowedNetworks: [NETWORK],
  allowedPayTo: [payTo],
  onRefusal: (refusal) => write(`REFUSED (${refusal.code}) ${refusal.reason}`),
});

const buyer = createMovoClient({
  signer: createEd25519Signer(buyerSecret, NETWORK),
  network: NETWORK,
  budget,
});

write("");
write("paying once…");
const result = await buyer.call(currentWeather, { city: "SFO" }, sellerUrl);

write(`  status      ${result.payment.status}`);
write(`  transaction ${result.payment.transaction ?? "none"}`);
if (result.payment.transaction !== undefined) {
  write(
    `  verify      https://horizon-testnet.stellar.org/transactions/${result.payment.transaction}`,
  );
}
write(`  spent       ${budget.spent()} base units, ${budget.remaining() ?? "unlimited"} left`);

if (result.payment.status !== "settled") {
  write("");
  write("The payment did not settle, so there is nothing to catalogue. Check the buyer's USDC");
  write("balance and trustline, and the facilitator's sponsor seeds.");
  process.exitCode = 1;
} else {
  // ── 4. Discoverable, as a consequence ───────────────────────────────────────────────────

  write("");
  write("GET /discovery/resources");
  const listed = await catalog.list({ type: "http", network: NETWORK });
  for (const item of listed.items) {
    write(`  ${item.serviceName ?? "(unnamed)"}  ${item.resource}`);
    write(`     ${item.description ?? ""}`);
    write(`     tags: ${(item.tags ?? []).join(", ") || "none"}`);
    write(`     price: ${item.accepts[0]?.amount ?? "?"} of ${item.accepts[0]?.asset ?? "?"}`);
  }

  write("");
  write("GET /discovery/search?query=weather+api");
  const found = await catalog.search({ query: "weather api" });
  found.resources.forEach((item, index) => {
    write(`  ${String(index + 1)}. ${item.serviceName ?? "(unnamed)"}  ${item.resource}`);
  });
  // `partialResults` is true here because this example runs lexical-only, without the embedding
  // model. It is the degraded-retriever signal, reported rather than hidden.
  write(`  partialResults: ${String(found.partialResults)}`);

  write("");
  write("No registration endpoint was called. The listing exists because someone paid.");
}

await new Promise<void>((resolve) => seller.close(() => resolve()));
await new Promise<void>((resolve) => facilitatorServer.close(() => resolve()));
await store.close();
