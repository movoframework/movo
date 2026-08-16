import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { createFacilitatorApp } from "../../apps/facilitator/src/app.ts";
import { createCatalogObserver } from "../../apps/facilitator/src/catalog-wiring.ts";
import {
  type Catalog,
  createCatalog,
  SqliteCatalogStore,
} from "../../packages/catalog/src/index.ts";
import { createBudget, createMovoClient } from "../../packages/client/src/index.ts";
import { defineApp, defineResource, STELLAR_PUBNET_CAIP2 } from "../../packages/core/src/index.ts";
import { createEd25519Signer } from "../../packages/core/src/protocol/client.ts";
import {
  createFacilitator,
  facilitatorConfigFromEnv,
} from "../../packages/facilitator/src/index.ts";
import { createMcpDiscoveryServer } from "../../packages/mcp/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";

/**
 * AC7.1, AC7.3 and AC7.8 on real Stellar testnet, end to end.
 *
 * The integration suite proves the wiring against a stub chain. This proves the only claim the
 * RFP actually cares about: **an agent that has never heard of a resource finds it, pays for it,
 * and gets it** — with the settlement confirmed from Horizon rather than from the facilitator
 * that reported it (§11.3).
 *
 * ## What "no pre-baked integration" means here, precisely
 *
 * The agent half of this test imports no resource declaration, no URL, no price and no schema.
 * It is handed one thing: an MCP connection. Everything else — that a weather endpoint exists,
 * where it lives, what it costs, that its parameter is called `city` — arrives in the
 * `bazaar.search` result. That is the difference between a catalog and a config file, and it is
 * why the search result is read for the URL rather than the URL being written in this file.
 *
 * ## The chain of custody
 *
 *   1. a real Movo facilitator settles on testnet, with the catalog observer on its settle path
 *   2. a buyer pays the seller once — a real transaction, real USDC
 *   3. the listing appears in `GET /discovery/resources` with no registration step   (AC7.1)
 *   4. `GET /discovery/search?query=weather+api` returns it in the top 3              (AC7.3)
 *   5. an MCP agent searches, selects, and pays through `bazaar.paidCall`             (AC7.8)
 *   6. Horizon confirms the transaction the agent's payment produced
 *
 * Gated behind `MOVO_E2E=1`, refuses pubnet outright, and requires:
 *
 *   STELLAR_PRIVATE_KEY                      a funded testnet buyer holding USDC
 *   MOVO_PAY_TO                              the seller address
 *   MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS    comma-separated funded sponsor seeds
 */

const E2E_ENABLED = process.env["MOVO_E2E"] === "1";
const HORIZON = "https://horizon-testnet.stellar.org";
const NETWORK = "stellar:testnet";

const buyerSecret = process.env["STELLAR_PRIVATE_KEY"];
const payTo = process.env["MOVO_PAY_TO"];

/**
 * The seller's resource. Discovery metadata is **derived** from this declaration.
 *
 * Nothing here registers anything anywhere. The listing that appears later in this test is
 * produced entirely by someone paying for this endpoint once.
 */
const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  price: "$0.001",
  description: "Current weather conditions and forecast for a city",
  serviceName: "Movo Testnet Weather",
  tags: ["weather", "forecast", "meteorology"],
  mimeType: "application/json",
  input: z.object({
    city: z.string().describe("City name or IATA airport code, for example 'SFO'"),
  }),
  output: z.object({ city: z.string(), tempC: z.number(), conditions: z.string() }),
  discovery: {
    example: { city: "SFO" },
    outputExample: { city: "SFO", tempC: 14, conditions: "foggy" },
  },
  handler: (ctx) => ({ city: ctx.params["city"] ?? "unknown", tempC: 14, conditions: "foggy" }),
});

interface Deployment {
  readonly facilitatorUrl: string;
  readonly sellerUrl: string;
  readonly catalog: Catalog;
  close(): Promise<void>;
}

let deployment: Deployment | undefined;

/** Stand up a real facilitator with a catalog on its settle path, and a seller pointed at it. */
async function deploy(): Promise<Deployment> {
  const store = await SqliteCatalogStore.open(":memory:");
  // Lexical-only. The semantic half is measured by `pnpm test:search-eval`, and loading the
  // embedding model here would make an e2e run download ~90MB before it could settle anything.
  // AC7.3 is therefore proven against the *weaker* of the two retrievers, which is the honest
  // direction for the claim to lean.
  const catalog = createCatalog({ store, embedder: undefined });

  const facilitator = createFacilitator(facilitatorConfigFromEnv(process.env), [
    createCatalogObserver({ catalog }),
  ]);
  const app = createFacilitatorApp({ facilitator, catalog, log: () => undefined });
  const facilitatorServer = serve({ fetch: app.fetch, port: 0 });
  const facilitatorPort = (facilitatorServer.address() as AddressInfo).port;
  const facilitatorUrl = `http://127.0.0.1:${String(facilitatorPort)}`;

  const application = express();
  application.use(express.json());
  await mountExpress(application as never, defineApp({ resources: [weather] }), {
    config: {
      env: process.env,
      argument: { facilitator: { url: facilitatorUrl }, discovery: { enabled: true } },
    },
  });

  const seller: Server = createServer(application);
  await new Promise<void>((resolve) => seller.listen(0, "127.0.0.1", resolve));
  const sellerPort = (seller.address() as AddressInfo).port;

  return {
    facilitatorUrl,
    sellerUrl: `http://127.0.0.1:${String(sellerPort)}`,
    catalog,
    close: async () => {
      await new Promise<void>((resolve) => seller.close(() => resolve()));
      await new Promise<void>((resolve) => facilitatorServer.close(() => resolve()));
      await store.close();
    },
  };
}

/** Fetch a transaction from Horizon — not from the seller, not from the facilitator. */
async function confirmOnChain(hash: string): Promise<{ successful: boolean; ledger: number }> {
  const response = await fetch(`${HORIZON}/transactions/${hash}`);
  if (!response.ok) throw new Error(`Horizon returned ${String(response.status)} for ${hash}`);
  return (await response.json()) as { successful: boolean; ledger: number };
}

describe.skipIf(!E2E_ENABLED)("M7 on testnet — discovery, search and an MCP agent", () => {
  beforeAll(async () => {
    // The pubnet guard runs before anything funded, as in every other e2e file. A suite that
    // could be pointed at mainnet by an environment variable eventually is.
    const network = process.env["MOVO_NETWORK"] ?? NETWORK;
    if (network === STELLAR_PUBNET_CAIP2) {
      throw new Error("the e2e suite must never run against pubnet");
    }
    if (buyerSecret === undefined || payTo === undefined) {
      throw new Error(
        "MOVO_E2E=1 requires STELLAR_PRIVATE_KEY (a funded testnet buyer with a USDC trustline) and MOVO_PAY_TO.",
      );
    }
    deployment = await deploy();
  }, 120_000);

  afterAll(async () => {
    await deployment?.close();
    deployment = undefined;
  });

  it("AC7.1 / AC7.3 — one real payment makes the endpoint findable, with no registration step", async () => {
    const live = deployment as Deployment;

    const budget = createBudget({
      maxAmountPerRequest: "100000",
      allowedNetworks: [NETWORK],
      allowedPayTo: [payTo as string],
    });
    const buyer = createMovoClient({
      signer: createEd25519Signer(buyerSecret as string, NETWORK),
      network: NETWORK,
      budget,
    });

    const result = await buyer.call(weather, { city: "SFO" }, live.sellerUrl);

    expect(result.payment.status).toBe("settled");
    const hash = result.payment.transaction as string;
    expect(hash).toBeTypeOf("string");

    const confirmed = await confirmOnChain(hash);
    expect(confirmed.successful).toBe(true);
    process.stdout.write(
      `\nAC7.1 SELLER SETTLEMENT: ${hash}\n  ledger: ${String(confirmed.ledger)}\n  verify: ${HORIZON}/transactions/${hash}\n`,
    );

    // `[FACT — upstream source, confirmed on testnet]` The buyer's catalog outcome is
    // `unknown`, and that is correct rather than a defect. Upstream's resource server reads the
    // facilitator's `EXTENSION-RESPONSES` and *logs* it — `logExtensionResponsesHeader` in
    // `@x402/core` — but does not forward the header to the buyer. So through any x402 resource
    // server the buyer-side outcome is `unknown` today, which is precisely why §A ruled that
    // `unknown` must be load-bearing rather than collapsed into a failure.
    //
    // Asserting `"success"` here would be asserting on a header nothing sends. AC7.1's claim is
    // about the catalog, so the catalog is what is asserted below. Forwarding the header to the
    // buyer is logged as an upstream contribution in docs/discovery/running-a-catalog.md.
    expect(["success", "processing", "rejected", "unknown"]).toContain(result.catalog.status);

    // AC7.1 — the listing is there, and nothing registered it.
    const listed = await live.catalog.list({});
    expect(listed.items.length).toBeGreaterThan(0);
    const listing = listed.items.find((item) => item.serviceName === "Movo Testnet Weather");
    expect(listing).toBeDefined();
    expect(listing?.resource).toContain("/weather/:city");
    process.stdout.write(`\nAC7.1 LISTING:\n${JSON.stringify(listing, null, 2)}\n`);

    // AC7.3 — findable by natural language, in the top 3.
    const found = await live.catalog.search({ query: "weather api" });
    const top3 = found.resources.slice(0, 3).map((item) => item.serviceName);
    expect(top3).toContain("Movo Testnet Weather");
    process.stdout.write(`\nAC7.3 SEARCH "weather api" TOP 3: ${JSON.stringify(top3)}\n`);
  }, 180_000);

  it("AC7.8 — an MCP agent searches, selects and pays with no pre-baked integration", async () => {
    const live = deployment as Deployment;

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

    const mcp = createMcpDiscoveryServer({
      catalog: live.catalog,
      buyer: {
        signer: createEd25519Signer(buyerSecret as string, NETWORK),
        network: NETWORK,
        // 0.01 USDC per call, 0.1 USDC in total for this agent's lifetime.
        budget: {
          maxAmountPerRequest: "100000",
          maxTotalSpend: "1000000",
          allowedNetworks: [NETWORK],
        },
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const agent = new Client({ name: "movo-e2e-agent", version: "0.0.0" });
    await Promise.all([mcp.server.connect(serverTransport), agent.connect(clientTransport)]);

    try {
      // ── The agent knows nothing but its own goal ──────────────────────────────────────────
      const searched = await agent.callTool({
        name: "bazaar.search",
        arguments: { query: "current weather for an airport code", network: NETWORK },
      });
      const searchResult = searched.structuredContent as {
        ok: boolean;
        resources: { id: string; resource: string; serviceName?: string }[];
      };
      expect(searchResult.ok).toBe(true);
      expect(searchResult.resources.length).toBeGreaterThan(0);

      // The agent picks from the catalog. Nothing in this file told it the URL.
      const chosen = searchResult.resources[0] as { id: string; resource: string };
      process.stdout.write(`\nAC7.8 AGENT SELECTED: ${chosen.resource} (id ${chosen.id})\n`);

      const paid = await agent.callTool({
        name: "bazaar.paidCall",
        arguments: { id: chosen.id, arguments: { city: "SFO" } },
      });
      const payment = paid.structuredContent as {
        ok: boolean;
        code?: string;
        reason?: string;
        data?: { city?: string; tempC?: number };
        status?: number;
        payment?: { status: string; transaction: string | null };
        budget?: { spent: string; remaining: string | null };
      };

      if (!payment.ok) {
        throw new Error(
          `AC7.8 paid call was rejected: ${payment.code ?? "?"} — ${payment.reason ?? "?"}`,
        );
      }

      // The agent received the resource it paid for.
      expect(payment.status).toBe(200);
      expect(payment.data?.city).toBe("SFO");
      expect(payment.data?.tempC).toBeTypeOf("number");

      // And a real settlement happened, confirmed from a third source.
      const hash = payment.payment?.transaction as string;
      expect(hash).toBeTypeOf("string");
      const confirmed = await confirmOnChain(hash);
      expect(confirmed.successful).toBe(true);

      // The budget accounted for it, which is what makes maxTotalSpend meaningful across calls.
      expect(BigInt(payment.budget?.spent ?? "0")).toBeGreaterThan(0n);
      expect(mcp.budget.refusals).toEqual([]);

      process.stdout.write(
        [
          "",
          "AC7.8 MCP AGENT SETTLEMENT",
          `  transaction ${hash}`,
          `  ledger      ${String(confirmed.ledger)}`,
          `  verify      ${HORIZON}/transactions/${hash}`,
          `  received    ${JSON.stringify(payment.data)}`,
          `  spent       ${payment.budget?.spent ?? "?"} of budget, ${payment.budget?.remaining ?? "unlimited"} remaining`,
          "",
        ].join("\n"),
      );
    } finally {
      await agent.close();
      await mcp.server.close();
    }
  }, 240_000);

  it("AC7.9 on testnet — an over-budget agent call is refused with no transaction at all", async () => {
    const live = deployment as Deployment;

    const mcp = createMcpDiscoveryServer({
      catalog: live.catalog,
      buyer: {
        signer: createEd25519Signer(buyerSecret as string, NETWORK),
        network: NETWORK,
        // One stroop. The resource asks for 10,000.
        budget: { maxAmountPerRequest: "1" },
      },
    });

    const listed = await live.catalog.list({});
    const target = listed.items.find((item) => item.serviceName === "Movo Testnet Weather");
    expect(target).toBeDefined();

    const before = await countTransactions(payTo as string);

    const search = await mcp.tools.search({ query: "weather api" });
    expect(search.ok).toBe(true);
    if (!search.ok) throw new Error("unreachable");

    const result = await mcp.tools.paidCall({
      id: search.resources[0]?.id as string,
      arguments: { city: "SFO" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("MOVO_E_BUDGET_EXCEEDED");
    expect(result.reason.trim()).not.toBe("");

    expect(mcp.budget.refusals).toHaveLength(1);
    expect(mcp.budget.spent()).toBe("0");

    // The on-chain half of "no signature was produced": with a real funded signer, a real
    // network and a real facilitator standing by, the seller's account gained no transaction.
    // A refusal that leaked a signature would be visible here as a settlement.
    const after = await countTransactions(payTo as string);
    expect(after).toBe(before);

    process.stdout.write(
      `\nAC7.9 ON TESTNET: refused with ${result.code}; seller transaction count unchanged at ${String(after)}\n`,
    );
  }, 180_000);
});

/** How many transactions Horizon has recorded for an account. */
async function countTransactions(account: string): Promise<number> {
  const response = await fetch(`${HORIZON}/accounts/${account}/transactions?order=desc&limit=200`);
  if (!response.ok) throw new Error(`Horizon returned ${String(response.status)}`);
  const body = (await response.json()) as { _embedded: { records: unknown[] } };
  return body._embedded.records.length;
}
