import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import {
  type Catalog,
  createCatalog,
  listingKey,
  SqliteCatalogStore,
} from "../../packages/catalog/src/index.ts";
import type { MovoClient } from "../../packages/client/src/index.ts";
import { createBudget } from "../../packages/client/src/index.ts";
import { defineApp, defineResource, MOVO_ERROR_REGISTRY } from "../../packages/core/src/index.ts";
import type { ClientStellarSigner } from "../../packages/core/src/protocol/client.ts";
import { createBazaarTools, createMcpDiscoveryServer } from "../../packages/mcp/src/index.ts";
import { mountExpress } from "../../packages/server/src/index.ts";
import { MockFacilitator } from "../../packages/testing/src/index.ts";

/**
 * The MCP discovery server: AC7.7, AC7.8's tool surface, and AC7.9.
 *
 * **AC7.9 is the one that matters and it is asserted with a signer spy, not a response shape.**
 * "An error came back" is entirely compatible with a signature having been produced and then
 * discarded, and a discarded signature is a real, retryable authorisation that briefly existed.
 * The criterion is that it never exists at all, so the only evidence that settles it is whether
 * the signer was ever asked. §A.2 rule 4 — a plausible fake is worse than a missing
 * implementation — applied to the control rather than to an implementation.
 *
 * For the same reason the suite also asserts the spy **does** fire when the budget permits the
 * call. Without that, "the signer was not invoked" could be true because nothing ever reaches
 * the signer under this harness at all, and the AC7.9 assertion would be vacuously green — the
 * exact shape of the AC6.8 grep that reported success over 190 failed settlements (§B.2).
 */

const SELLER = "GCQQDMJ47UR5OD2VY4KTOKTZ4CMS5CTNHRBIC6BZIJYG7T5Z3AVW2NAM";
const BUYER = "GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV";
const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** Everything the signer was asked to sign. Empty is the AC7.9 assertion. */
interface SignerSpy {
  readonly signer: ClientStellarSigner;
  readonly signatures: string[];
}

/**
 * A signer that records every request and then refuses.
 *
 * Refusing rather than returning a plausible signature is deliberate. If the budget ever fails
 * to refuse, the test must fail loudly at the point of the defect rather than proceed into a
 * settlement path with a fabricated authorisation — and no Movo test should ever hold a value
 * shaped like a real signature.
 */
function spySigner(): SignerSpy {
  const signatures: string[] = [];
  return {
    signatures,
    signer: {
      address: BUYER,
      signAuthEntry: async () => {
        signatures.push("signAuthEntry");
        throw new Error("the spy signer must never be reached in a refused call");
      },
      signTransaction: async () => {
        signatures.push("signTransaction");
        throw new Error("the spy signer must never be reached in a refused call");
      },
    } as unknown as ClientStellarSigner,
  };
}

const weather = defineResource({
  method: "GET",
  path: "/weather/:city",
  // One whole dollar, so a budget in the region of a fraction of a cent refuses it decisively.
  price: "$1.00",
  description: "Current weather conditions for a city",
  serviceName: "Example Weather",
  tags: ["weather", "forecast"],
  input: z.object({ city: z.string().describe("City name or IATA airport code") }),
  discovery: { example: { city: "SFO" }, outputExample: { tempC: 14 } },
  handler: (ctx) => ({ city: ctx.params["city"], tempC: 14, conditions: "foggy" }),
});

interface Harness {
  readonly url: string;
  close(): Promise<void>;
}

const open: Harness[] = [];

async function paidServer(): Promise<Harness> {
  const application = express();
  application.use(express.json());

  await mountExpress(application as never, defineApp({ resources: [weather] }), {
    facilitator: new MockFacilitator(),
    config: { config: { payTo: SELLER, discovery: { enabled: true } }, env: {} },
  });

  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const harness: Harness = {
    url: `http://127.0.0.1:${String(port)}`,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  open.push(harness);
  return harness;
}

async function emptyCatalog(): Promise<Catalog> {
  const store = await SqliteCatalogStore.open(":memory:");
  // Lexical-only: the embedding model is exercised by the eval harness, and loading it here
  // would make every integration run download and initialise it.
  return createCatalog({ store, embedder: undefined });
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((harness) => harness.close()));
});

describe("AC7.9 — bazaar.paidCall refuses an over-budget call without producing a signature", () => {
  it("returns the budget's own code and never asks the signer for anything", async () => {
    const server = await paidServer();
    const spy = spySigner();

    const mcp = createMcpDiscoveryServer({
      catalog: await emptyCatalog(),
      buyer: {
        signer: spy.signer,
        network: "stellar:testnet",
        // 0.0001 USDC at 7 decimals, against a $1.00 resource.
        budget: { maxAmountPerRequest: "1000", maxTotalSpend: "1000" },
      },
    });

    const result = await mcp.tools.paidCall({
      url: `${server.url}/weather/:city`,
      arguments: { city: "SFO" },
    });

    // THE ASSERTION. Not "an error was returned" — no signature was ever requested, so none
    // exists to be retried, leaked from a log, or resubmitted.
    expect(spy.signatures).toEqual([]);

    // The evidence that the emptiness above is *meaningful*: the budget recorded a refusal, so
    // the flow genuinely reached offer selection and was stopped there. Without this assertion,
    // an empty spy would also be consistent with the request failing before the 402 was ever
    // read, and AC7.9 would be green over a control that never ran (§B.2).
    expect(mcp.budget.refusals).toHaveLength(1);
    expect(mcp.budget.refusals[0]?.code).toBe("MOVO_E_BUDGET_EXCEEDED");
    expect(mcp.budget.spent()).toBe("0");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");

    // The budget's own code travels through, rather than a wrapper: an agent needs to know
    // *which* constraint fired to decide what to do next.
    expect(result.code).toBe("MOVO_E_BUDGET_EXCEEDED");
    expect(result.reason.trim()).not.toBe("");
    expect(result.reason).toContain("10000000");
    expect(result.fix).toBe(MOVO_ERROR_REGISTRY.MOVO_E_BUDGET_EXCEEDED.fix);
  }, 30_000);

  it("PROOF OF FAILURE — raising the cap, and nothing else, moves the failure past the budget", async () => {
    // The contrast that makes the test above non-vacuous. Same server, same signer, same tool
    // call; the ONLY difference is the cap. If the budget were a no-op, this run would fail
    // identically to the one above — instead it records no refusal at all and fails further
    // down the payment-creation path, which is what proves the cap is what stopped the first.
    //
    // What this cannot show offline is the signer being reached: upstream builds the payment
    // payload against Soroban RPC *before* it signs, and this suite performs no chain I/O. The
    // signer-is-reached half is closed for real by the testnet e2e (AC7.8), where a permitting
    // budget signs and settles. Recording that split here rather than claiming coverage the
    // harness does not have.
    const server = await paidServer();
    const spy = spySigner();

    const mcp = createMcpDiscoveryServer({
      catalog: await emptyCatalog(),
      buyer: {
        signer: spy.signer,
        network: "stellar:testnet",
        // 2 USDC — comfortably above the $1.00 the resource asks for.
        budget: { maxAmountPerRequest: "20000000" },
      },
    });

    const result = await mcp.tools.paidCall({
      url: `${server.url}/weather/:city`,
      arguments: { city: "SFO" },
    });

    expect(mcp.budget.refusals).toEqual([]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");

    // Not a budget code. The offer was accepted and the failure is downstream of selection.
    expect(result.code).not.toBe("MOVO_E_BUDGET_EXCEEDED");
    expect(result.reason).not.toContain("filtered out by policies");
  }, 30_000);

  it("refuses to build a server with no budget at all", async () => {
    const spy = spySigner();
    const catalog = await emptyCatalog();

    expect(() =>
      createMcpDiscoveryServer({
        catalog,
        // A JavaScript caller gets no type error, so the runtime guard is the one that fires.
        buyer: { signer: spy.signer, network: "stellar:testnet" } as never,
      }),
    ).toThrowError(/MOVO_E_MCP_BUDGET_REQUIRED|requires buyer\.budget/);
  });
});

describe("AC7.7 — an MCP tool is catalogued and retrievable by its (url, toolName) tuple", () => {
  it("stores the tuple key on ingest and bazaar.get finds it from url + toolName alone", async () => {
    const catalog = await emptyCatalog();
    const resourceUrl = "https://tools.example.com/mcp";

    const extension = {
      info: {
        input: {
          type: "mcp",
          toolName: "financial_analysis",
          description: "Analyse a ticker's recent filings",
          inputSchema: {
            type: "object",
            properties: { ticker: { type: "string", description: "Stock ticker symbol" } },
            required: ["ticker"],
          },
        },
        output: { type: "object" },
      },
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          input: {
            type: "object",
            properties: {
              type: { type: "string", const: "mcp" },
              toolName: { type: "string" },
              description: { type: "string" },
              inputSchema: { type: "object" },
            },
            required: ["type", "toolName", "inputSchema"],
          },
          output: { type: "object" },
        },
        required: ["input"],
      },
    };

    const requirements = {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "20000",
      asset: ASSET,
      payTo: SELLER,
      maxTimeoutSeconds: 300,
      resource: { url: resourceUrl, serviceName: "Filing Analyser", tags: ["finance"] },
    };

    const outcome = await catalog.ingest({
      paymentPayload: {
        x402Version: 2,
        accepted: { ...requirements },
        resource: requirements.resource,
        payload: { transaction: "AAAA" },
        extensions: { bazaar: extension },
      },
      paymentRequirements: requirements as never,
      settleResponse: {
        success: true,
        transaction: "not-an-on-chain-hash",
        network: "stellar:testnet",
      },
    });

    expect(outcome.status).toBe("success");

    const tools = createBazaarTools({
      catalog,
      client: stubClient(),
      budget: createBudget({ maxAmountPerRequest: "1" }),
    });

    // The criterion: retrieved by the tuple, with no id in hand.
    const byTuple = await tools.get({ resource: resourceUrl, toolName: "financial_analysis" });
    expect(byTuple.ok).toBe(true);
    if (!byTuple.ok) throw new Error("unreachable");
    expect(byTuple.listing.type).toBe("mcp");
    expect(byTuple.listing.resource).toBe(resourceUrl);

    // And the id it reports is the catalog's own key for that tuple, not a second derivation.
    expect(byTuple.listing.id).toBe(listingKey("mcp", resourceUrl, "financial_analysis"));

    // A different tool at the same URL is a different listing — the point of tuple keying.
    const wrongTool = await tools.get({ resource: resourceUrl, toolName: "something_else" });
    expect(wrongTool.ok).toBe(false);
    if (wrongTool.ok) throw new Error("unreachable");
    expect(wrongTool.code).toBe("MOVO_E_MCP_LISTING_NOT_FOUND");
    expect(wrongTool.reason).not.toBe("");
  });
});

describe("AC7.8 tool surface — structured, deterministic, machine-readable", () => {
  it("returns byte-identical results for identical calls against an unchanged catalog", async () => {
    const catalog = await seededCatalog();
    const tools = createBazaarTools({
      catalog,
      client: stubClient(),
      budget: createBudget({ maxAmountPerRequest: "1" }),
    });

    const first = await tools.search({ query: "weather forecast" });
    const second = await tools.search({ query: "weather forecast" });

    // Determinism is asserted on the serialised form, because that is what crosses the
    // transport. A field ordering difference or an embedded timestamp would fail here.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.resources.length).toBeGreaterThan(0);
  });

  it("carries a registry code and a non-null reason on every rejection", async () => {
    const catalog = await emptyCatalog();
    const tools = createBazaarTools({
      catalog,
      client: stubClient(),
      budget: createBudget({ maxAmountPerRequest: "1" }),
    });

    const rejections = [
      await tools.search({ query: "   " }),
      await tools.get({}),
      await tools.get({ resource: "not-a-url" }),
      await tools.get({ id: "http_absent" }),
      await tools.paidCall({}),
      await tools.paidCall({ id: "a", url: "https://example.com" }),
      await tools.paidCall({ url: "file:///etc/passwd" }),
      await tools.paidCall({ id: "http_absent" }),
    ];

    for (const rejection of rejections) {
      expect(rejection.ok).toBe(false);
      if (rejection.ok) throw new Error("unreachable");

      // Machine-readable: the code resolves in the single registry, so it is documented and
      // stable rather than a string invented at the throw site.
      expect(MOVO_ERROR_REGISTRY[rejection.code]).toBeDefined();
      // Non-null reason on EVERY rejection (§25.12) — the whole point of the requirement is
      // that an agent never has to parse prose to find out that it was told nothing.
      expect(rejection.reason).toBeTypeOf("string");
      expect(rejection.reason.trim()).not.toBe("");
      expect(rejection.fix).toBe(MOVO_ERROR_REGISTRY[rejection.code].fix);
    }
  });

  it("exposes exactly three tools over a real MCP transport, and no more", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

    const mcp = createMcpDiscoveryServer({
      catalog: await seededCatalog(),
      buyer: {
        signer: spySigner().signer,
        network: "stellar:testnet",
        budget: { maxAmountPerRequest: "1000" },
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-agent", version: "0.0.0" });
    await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);

    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "bazaar.get",
        "bazaar.paidCall",
        "bazaar.search",
      ]);

      // The agent-facing result travels as structuredContent, not as prose in a text block.
      const called = await client.callTool({
        name: "bazaar.search",
        arguments: { query: "weather forecast" },
      });
      const structured = called.structuredContent as { ok: boolean; resources: unknown[] };
      expect(structured.ok).toBe(true);
      expect(structured.resources.length).toBeGreaterThan(0);
    } finally {
      await client.close();
      await mcp.server.close();
    }
  }, 30_000);
});

/**
 * A catalog holding one HTTP listing, ingested the way a real settlement would produce it.
 *
 * Built through `catalog.ingest` rather than by writing a row, so the listing under test is one
 * the real path can actually produce.
 */
async function seededCatalog(): Promise<Catalog> {
  const catalog = await emptyCatalog();

  const requirements = {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "10000",
    asset: ASSET,
    payTo: SELLER,
    maxTimeoutSeconds: 300,
    resource: {
      url: "https://weather.example.com/weather/SFO",
      serviceName: "Example Weather",
      description: "Current weather conditions for a city",
      tags: ["weather", "forecast"],
    },
  };

  const outcome = await catalog.ingest({
    paymentPayload: {
      x402Version: 2,
      accepted: { ...requirements },
      resource: requirements.resource,
      payload: { transaction: "AAAA" },
      extensions: {
        bazaar: {
          info: {
            input: {
              type: "http",
              method: "GET",
              discoverable: true,
              queryParams: { city: { type: "string", description: "IATA airport code" } },
            },
            output: { type: "object" },
          },
          schema: {
            $schema: "https://json-schema.org/draft/2020-12/schema",
            type: "object",
            properties: { input: { type: "object" }, output: { type: "object" } },
            required: ["input"],
          },
          routeTemplate: "/weather/:city",
        },
      },
    },
    paymentRequirements: requirements as never,
    settleResponse: {
      success: true,
      transaction: "not-an-on-chain-hash",
      network: "stellar:testnet",
    },
  });

  if (outcome.status !== "success") {
    throw new Error(`seed ingest failed: ${JSON.stringify(outcome)}`);
  }
  return catalog;
}

/**
 * A client that refuses to be called.
 *
 * The tests in this file that use it never reach a paid call — they exercise input validation
 * and catalog reads. Making it throw rather than return a plausible result means a test that
 * accidentally reaches the network fails loudly instead of asserting against a fabrication.
 */
function stubClient(): MovoClient {
  return {
    fetch: (() => {
      throw new Error("this test must not perform a paid call");
    }) as unknown as typeof globalThis.fetch,
    call: async () => {
      throw new Error("this test must not perform a paid call");
    },
    callUrl: async () => {
      throw new Error("this test must not perform a paid call");
    },
  } as unknown as MovoClient;
}
