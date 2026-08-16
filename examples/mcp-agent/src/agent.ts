/**
 * An agent that discovers and pays for an API it has never heard of.
 *
 * **The thing to check in this file is what the agent is told.** It is handed one MCP
 * connection. It is not given a URL, a price, a parameter name, a schema, an SDK or an import of
 * the seller's resource declaration. Everything it needs to make a paid call arrives inside the
 * `bazaar.search` result:
 *
 *   - that a weather endpoint exists at all
 *   - where it lives
 *   - what it costs, and in which asset on which network
 *   - that its parameter is called `city` and takes an IATA code
 *
 * That is the difference between a catalog and a configuration file, and it is why this file
 * reads the URL out of the search result rather than writing it down. Compare
 * `examples/agent-buyer`, which imports the seller's `MovoResource` directly: that is the
 * *pre-baked* integration, and it is a perfectly good pattern when the buyer knows the seller in
 * advance. This one is for when it does not.
 *
 * ## The budget is not optional, and that is the point
 *
 * `createMcpDiscoveryServer` refuses to build without one. `bazaar.paidCall` hands an autonomous
 * agent the ability to spend from a wallet, and the cap is the only thing between a bad plan and
 * an empty account. The last section of this example proves the refusal: it asks for the same
 * resource under a one-stroop cap and shows the call refused **before any payment is created**,
 * so no signature ever exists to be retried or leaked.
 *
 * Note that the cap belongs to the server's operator, not to the agent. There is no tool
 * argument that raises it.
 *
 * ## Running it
 *
 *   STELLAR_PRIVATE_KEY=S…    a funded testnet buyer holding USDC
 *   MOVO_PAY_TO=G…            the seller's address
 *   MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS=S…,S…   funded sponsor seeds
 *
 *   pnpm --filter @movoframework/example-mcp-agent start
 *
 * It moves real testnet value and refuses to run against pubnet.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCatalog, SqliteCatalogStore } from "@movoframework/catalog";
import { createBudget, createMovoClient } from "@movoframework/client";
import { STELLAR_PUBNET_CAIP2 } from "@movoframework/core";
import { createEd25519Signer } from "@movoframework/core/client";
import { app, config, currentWeather } from "@movoframework/example-discoverable-api";
import { createFacilitator, facilitatorConfigFromEnv } from "@movoframework/facilitator";
import { createFacilitatorApp } from "@movoframework/facilitator-service";
import { createCatalogObserver } from "@movoframework/facilitator-service/catalog-wiring";
import { createMcpDiscoveryServer } from "@movoframework/mcp";
import { mountExpress } from "@movoframework/server";
import express from "express";

const NETWORK = "stellar:testnet";
const write = (line: string): void => void process.stdout.write(`${line}\n`);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required. See the header of this file.`);
  }
  return value;
}

if ((process.env["MOVO_NETWORK"] ?? NETWORK) === STELLAR_PUBNET_CAIP2) {
  throw new Error("this example is testnet-only and refuses to run against pubnet");
}

const buyerSecret = required("STELLAR_PRIVATE_KEY");
const payTo = required("MOVO_PAY_TO");
required("MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS");

// ── The world the agent will wake up in ───────────────────────────────────────────────────
//
// A facilitator with a catalog, a seller, and one prior payment so the catalog is not empty.
// In a real deployment none of this is the agent's concern — it connects to somebody else's
// running MCP server. It is here so the example is one command rather than four.

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

write("seeding the catalog with one ordinary payment…");
const seedBudget = createBudget({ maxAmountPerRequest: "100000", allowedPayTo: [payTo] });
const seedBuyer = createMovoClient({
  signer: createEd25519Signer(buyerSecret, NETWORK),
  network: NETWORK,
  budget: seedBudget,
});
const seeded = await seedBuyer.call(currentWeather, { city: "LHR" }, sellerUrl);
write(`  ${seeded.payment.status}  ${seeded.payment.transaction ?? ""}`);

if (seeded.payment.status !== "settled") {
  write("The seed payment did not settle, so the catalog is empty and there is nothing to find.");
  process.exitCode = 1;
} else {
  // ── The MCP discovery server ────────────────────────────────────────────────────────────

  const mcp = createMcpDiscoveryServer({
    catalog,
    buyer: {
      signer: createEd25519Signer(buyerSecret, NETWORK),
      network: NETWORK,
      // The operator's cap. 0.01 USDC per call, 0.1 USDC for this agent's whole lifetime.
      budget: {
        maxAmountPerRequest: "100000",
        maxTotalSpend: "1000000",
        allowedNetworks: [NETWORK],
      },
    },
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const agent = new Client({ name: "example-mcp-agent", version: "0.0.0" });
  await Promise.all([mcp.server.connect(serverTransport), agent.connect(clientTransport)]);

  // ── From here down, the agent knows only its goal ───────────────────────────────────────

  write("");
  write("tools the agent can see:");
  for (const tool of (await agent.listTools()).tools) {
    write(`  ${tool.name}  — ${tool.description ?? ""}`.slice(0, 110));
  }

  write("");
  write('bazaar.search "what is the weather at an airport"');
  const searched = await agent.callTool({
    name: "bazaar.search",
    arguments: { query: "what is the weather at an airport", network: NETWORK },
  });
  const search = searched.structuredContent as {
    ok: boolean;
    reason?: string;
    partialResults?: boolean;
    resources?: {
      id: string;
      resource: string;
      serviceName?: string;
      description?: string;
      accepts: { amount?: string; asset?: string }[];
    }[];
  };

  if (!search.ok || search.resources === undefined || search.resources.length === 0) {
    write(`  nothing found: ${search.reason ?? "empty catalog"}`);
    process.exitCode = 1;
  } else {
    for (const [index, item] of search.resources.entries()) {
      write(`  ${String(index + 1)}. ${item.serviceName ?? "(unnamed)"}`);
      write(`     ${item.resource}`);
      write(`     ${item.description ?? ""}`);
      write(`     price ${item.accepts[0]?.amount ?? "?"} base units`);
    }
    write(`  partialResults: ${String(search.partialResults ?? false)}`);

    const chosen = search.resources[0] as { id: string; resource: string };

    // `bazaar.get` for the full record before committing money: the parameter schema lives in
    // the extensions block, and so do the settlement and failure counts — this listing's track
    // record. An agent that reads them can prefer a resource that works.
    const detail = await agent.callTool({ name: "bazaar.get", arguments: { id: chosen.id } });
    const record = detail.structuredContent as {
      settlementCount?: number;
      failureCount?: number;
    };
    write("");
    write(
      `bazaar.get — settlements ${String(record.settlementCount ?? 0)}, failures ${String(record.failureCount ?? 0)}`,
    );

    write("");
    write("bazaar.paidCall");
    const paid = await agent.callTool({
      name: "bazaar.paidCall",
      // The URL is never named here. Only the id the search returned.
      arguments: { id: chosen.id, arguments: { city: "SFO" } },
    });
    const payment = paid.structuredContent as {
      ok: boolean;
      code?: string;
      reason?: string;
      data?: unknown;
      payment?: { transaction: string | null };
      budget?: { spent: string; remaining: string | null };
    };

    if (payment.ok) {
      write(`  received    ${JSON.stringify(payment.data)}`);
      write(`  transaction ${payment.payment?.transaction ?? "none"}`);
      if (payment.payment?.transaction != null) {
        write(
          `  verify      https://horizon-testnet.stellar.org/transactions/${payment.payment.transaction}`,
        );
      }
      write(
        `  budget      ${payment.budget?.spent ?? "?"} spent, ${payment.budget?.remaining ?? "unlimited"} remaining`,
      );
    } else {
      write(`  REJECTED ${payment.code ?? "?"}`);
      write(`  ${payment.reason ?? ""}`);
      process.exitCode = 1;
    }

    // ── The refusal, shown rather than described ─────────────────────────────────────────

    write("");
    write("the same call, under an operator cap of one stroop:");
    const capped = createMcpDiscoveryServer({
      catalog,
      buyer: {
        signer: createEd25519Signer(buyerSecret, NETWORK),
        network: NETWORK,
        budget: { maxAmountPerRequest: "1" },
      },
    });
    const refused = await capped.tools.paidCall({
      id: chosen.id,
      arguments: { city: "SFO" },
    });
    if (refused.ok) {
      write("  UNEXPECTED: the capped call was not refused. This is a defect, not a demo.");
      process.exitCode = 1;
    } else {
      write(`  ${refused.code}`);
      write(`  ${refused.reason}`);
      write(`  fix: ${refused.fix}`);
      write("");
      write(`  spent after refusal: ${capped.budget.spent()} — nothing was signed or submitted.`);
    }
  }

  await agent.close();
  await mcp.server.close();
}

await new Promise<void>((resolve) => seller.close(() => resolve()));
await new Promise<void>((resolve) => facilitatorServer.close(() => resolve()));
await store.close();
