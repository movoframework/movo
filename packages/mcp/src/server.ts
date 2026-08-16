/**
 * `createMcpDiscoveryServer` — the three Bazaar tools, on an MCP transport.
 *
 * Thin by design. Everything an agent can do lives in `tools.ts`; this file registers those
 * three functions with `@modelcontextprotocol/sdk` and translates the `ToolResult` union into
 * MCP's `structuredContent`. No behaviour is added on the way through, so the tests in
 * `tools.test.ts` are testing what a connected agent actually gets.
 *
 * ## Why this constructs the buyer rather than accepting one
 *
 * §25.5 sketched the signature as `createMcpDiscoveryServer({ catalog, client })`. Taking a
 * ready-made client cannot satisfy §25.12's stronger requirement that `bazaar.paidCall`
 * **requires** a budget policy: a `MovoClient` captures its budget in a closure, so a client
 * built without one is indistinguishable from a client built with one, and the check degrades
 * into a comment asking the caller to have been careful.
 *
 * So this takes the buyer's *parts* — signer, network, budget options — and builds the client
 * itself. The budget is then registered by construction rather than by convention, and there is
 * no argument a caller can pass that yields a paid-call tool with no spend cap. The runtime
 * guard below is belt-and-braces for JavaScript callers, who do not get the type error.
 *
 * The signer is still always supplied by the caller. No Movo package generates, derives or
 * stores a key, and this one is no exception (§5.8).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "@movoframework/catalog";
import {
  type Budget,
  type BudgetOptions,
  createBudget,
  createMovoClient,
  type MovoClient,
} from "@movoframework/client";
import { MovoError, type Network, type RpcConfig } from "@movoframework/core";
import type { ClientStellarSigner } from "@movoframework/core/client";
import {
  GET_INPUT_SCHEMA,
  GET_OUTPUT_SCHEMA,
  PAID_CALL_INPUT_SCHEMA,
  PAID_CALL_OUTPUT_SCHEMA,
  SEARCH_INPUT_SCHEMA,
  SEARCH_OUTPUT_SCHEMA,
} from "./schemas.js";
import { type BazaarTools, createBazaarTools } from "./tools.js";

/** The MCP server's package identity, as an agent sees it in `initialize`. */
export const MCP_SERVER_NAME = "movo-bazaar";

/** The buyer `bazaar.paidCall` uses. */
export interface McpBuyerOptions {
  /** The buyer's signer. Always supplied by the caller; Movo never creates one. */
  readonly signer: ClientStellarSigner;
  /** The network to settle on. */
  readonly network: Network;
  /**
   * The spend cap. **Required.**
   *
   * Not optional and not defaulted. A default cap would be a number this package invented for
   * someone else's wallet, and an absent one would be no cap at all — so the only honest option
   * is to make the operator state it.
   */
  readonly budget: BudgetOptions;
  /** RPC overrides, forwarded to the scheme. */
  readonly rpc?: RpcConfig;
}

/** Options for {@link createMcpDiscoveryServer}. */
export interface McpDiscoveryServerOptions {
  /** The catalog the three tools read. */
  readonly catalog: Catalog;
  /** The buyer's parts. See {@link McpBuyerOptions}. */
  readonly buyer: McpBuyerOptions;
}

/** A built MCP discovery server, plus the pieces a caller may want to observe. */
export interface McpDiscoveryServer {
  /** Connect this to a transport — stdio, streamable HTTP, or an in-memory pair in tests. */
  readonly server: McpServer;
  /** The three tools, callable directly. The same functions the transport exposes. */
  readonly tools: BazaarTools;
  /** The budget, for reading cumulative spend and the refusals it has issued. */
  readonly budget: Budget;
  /** The buyer client the paid-call tool uses. */
  readonly client: MovoClient;
}

/**
 * Build the MCP discovery server.
 *
 * @param options - The catalog to expose and the buyer to pay with
 * @returns The MCP server, the tools, the budget and the client
 * @throws MovoError `MOVO_E_MCP_BUDGET_REQUIRED` when no budget is supplied
 */
export function createMcpDiscoveryServer(options: McpDiscoveryServerOptions): McpDiscoveryServer {
  const budgetOptions = options.buyer?.budget;
  if (budgetOptions === undefined || budgetOptions === null) {
    throw new MovoError(
      "MOVO_E_MCP_BUDGET_REQUIRED",
      "createMcpDiscoveryServer requires buyer.budget. bazaar.paidCall lets an agent spend from this signer's account, and a cap is the only control that stands between a bad plan and an empty wallet.",
    );
  }

  const budget = createBudget(budgetOptions);
  const client = createMovoClient({
    signer: options.buyer.signer,
    network: options.buyer.network,
    budget,
    ...(options.buyer.rpc === undefined ? {} : { rpc: options.buyer.rpc }),
  });

  const tools = createBazaarTools({ catalog: options.catalog, client, budget });

  const server = new McpServer({ name: MCP_SERVER_NAME, version: VERSION });

  server.registerTool(
    "bazaar.search",
    {
      title: "Search the Bazaar catalog",
      description:
        "Find paid HTTP resources and MCP tools by natural-language query. Returns each match with an `id` you pass to bazaar.get or bazaar.paidCall. `partialResults: true` means one retriever was degraded or the results were truncated.",
      inputSchema: SEARCH_INPUT_SCHEMA,
      outputSchema: SEARCH_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => structured(await tools.search(input as never)),
  );

  server.registerTool(
    "bazaar.get",
    {
      title: "Read one Bazaar listing",
      description:
        "Fetch a single listing by the `id` bazaar.search returned, or by the (resource, toolName) tuple an MCP tool is catalogued under. Carries the settlement and failure counts, which are the listing's track record.",
      inputSchema: GET_INPUT_SCHEMA,
      outputSchema: GET_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => structured(await tools.get(input as never)),
  );

  server.registerTool(
    "bazaar.paidCall",
    {
      title: "Call a paid resource, within a budget",
      description:
        "Pay for and call a discovered resource. Subject to a spend cap configured by this server's operator, not by the caller: an offer over the cap is refused before any payment is signed, and the rejection names which constraint fired. Returns the resource's response and the settled transaction hash.",
      inputSchema: PAID_CALL_INPUT_SCHEMA,
      outputSchema: PAID_CALL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (input) => structured(await tools.paidCall(input as never)),
  );

  return { server, tools, budget, client };
}

/**
 * Render a tool result as an MCP tool response.
 *
 * A rejection is **not** `isError: true`. `isError` is the SDK's channel for "the tool blew up",
 * and an agent reading it learns only that something went wrong. A budget refusal is a
 * well-formed answer to a well-formed question, and the agent needs its code to decide what to
 * do — so it travels in `structuredContent` like any other result, with `ok: false`.
 *
 * The text block carries the same JSON. Some clients render only text, and one that did would
 * otherwise show the agent an empty response.
 */
function structured(result: object): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
  };
}

/** The published version of this package. */
const VERSION = "0.0.0";
