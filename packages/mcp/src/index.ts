/**
 * `@movoframework/mcp` — an MCP discovery server over the Stellar Bazaar catalog.
 *
 * Three tools, and only three (§25.12): `bazaar.search`, `bazaar.get`, `bazaar.paidCall`. An
 * agent connects, finds a paid resource it has never heard of, and pays for it from inside its
 * own runtime — with no pre-baked integration, because there is nothing to integrate: the
 * resource's URL, price and parameter schema all arrive in the search result.
 *
 * **`bazaar.paidCall` requires a budget.** Not defaults one — requires it. The tool hands an
 * autonomous agent the ability to spend from a wallet, and the refusal path is a security
 * control: an over-budget offer is refused *before* upstream creates a payment, so no signature
 * is ever produced. See `docs/mcp/discovery-server.md` and `docs/security/buyer-budgets.md`.
 *
 * **No orchestration, memory or planning.** Those belong to the agent runtime. This package's
 * whole job is to make a catalog callable.
 *
 * @see docs/mcp/discovery-server.md
 * @see docs/mcp/agent-integration.md
 */

export type {
  ToolRejection,
  ToolResult,
  ToolSuccess,
} from "./result.js";
export {
  GET_INPUT_SCHEMA,
  GET_OUTPUT_SCHEMA,
  PAID_CALL_INPUT_SCHEMA,
  PAID_CALL_OUTPUT_SCHEMA,
  SEARCH_INPUT_SCHEMA,
  SEARCH_OUTPUT_SCHEMA,
} from "./schemas.js";
export {
  createMcpDiscoveryServer,
  MCP_SERVER_NAME,
  type McpBuyerOptions,
  type McpDiscoveryServer,
  type McpDiscoveryServerOptions,
} from "./server.js";
export {
  type AgentListing,
  type BazaarTools,
  type BazaarToolsOptions,
  createBazaarTools,
  DEFAULT_SEARCH_LIMIT,
  type GetInput,
  type GetOutput,
  type PaidCallInput,
  type PaidCallOutput,
  type SearchInput,
  type SearchOutput,
} from "./tools.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
