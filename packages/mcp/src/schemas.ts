/**
 * The tool schemas — the contract an agent reads before it calls anything.
 *
 * These are the whole of "structured, deterministic inputs and outputs" (§25.12). An MCP client
 * shows the agent these schemas and validates against them in both directions, so a description
 * written here is documentation an agent actually reads at decision time, not documentation a
 * human reads at integration time. That is why every field carries a `.describe()`, and why the
 * descriptions say what the field means for the *decision* rather than restating its type.
 *
 * `zod/v4` rather than the classic entry, matching the rest of the repository: it is the shape
 * `toJSONSchema` reads, and it is what the seller-side derivation in `@movoframework/bazaar`
 * already requires.
 *
 * ## The output schemas carry the rejection branch too
 *
 * `ok` is a boolean present on every result, and the rejection fields are optional alongside the
 * success fields rather than living in a separate union. MCP output schemas are a single JSON
 * Schema object per tool, and a client validating a rejection against a success-only schema
 * would reject the very message telling the agent why its call failed.
 */

import { z } from "zod/v4";

/**
 * The shape an MCP tool schema takes.
 *
 * Annotated explicitly on every export because `isolatedDeclarations` cannot infer a Zod type,
 * and because the inferred type is of no use to a caller anyway: the SDK reads these shapes
 * structurally to build the JSON Schema an agent sees, and the tool callbacks validate through
 * that JSON Schema rather than through TypeScript.
 */
export type ToolSchemaShape = Record<string, z.ZodType>;

/** The rejection fields, present on every tool's output schema. */
const REJECTION_SHAPE = {
  ok: z.boolean().describe("false when this call was rejected; true when it succeeded"),
  code: z
    .string()
    .optional()
    .describe(
      "Rejection only. A stable MOVO_E_* code to branch on. Never re-used for another meaning, so it is safe to hard-code.",
    ),
  reason: z
    .string()
    .optional()
    .describe(
      "Rejection only. Why this specific call was rejected. Always populated on a rejection.",
    ),
  fix: z.string().optional().describe("Rejection only. What would make the call succeed."),
};

/** A catalog listing as it appears to an agent. */
const LISTING = z
  .object({
    id: z
      .string()
      .describe("The catalog's key for this listing. Pass to bazaar.get or bazaar.paidCall."),
    resource: z.string().describe("The resource URL. May contain :param segments to substitute."),
    type: z.string().describe("'http' for a paid endpoint, 'mcp' for a paid MCP tool"),
    x402Version: z.number().describe("The x402 protocol version this listing was catalogued at"),
    accepts: z
      .array(z.unknown())
      .describe(
        "The payment options the seller advertised when this listing was last updated: amount, asset, network and payTo. Read the amount here to decide whether calling is worth it before you call.",
      ),
    lastUpdated: z.string().describe("ISO 8601. When a settlement last refreshed this listing."),
    description: z.string().optional().describe("What the resource does, from the seller"),
    mimeType: z.string().optional().describe("What the resource returns"),
    serviceName: z.string().optional().describe("The seller's name for the service"),
    tags: z.array(z.string()).optional().describe("Seller-supplied tags"),
    iconUrl: z.string().optional().describe("An icon for the service"),
    extensions: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "The declared extensions, including the bazaar block with the input schema for this resource's parameters. This is where to look for what to put in bazaar.paidCall's `arguments`.",
      ),
  })
  .describe("A Bazaar listing");

/** `bazaar.search` input. */
export const SEARCH_INPUT_SCHEMA: ToolSchemaShape = {
  query: z
    .string()
    .describe(
      "A natural-language description of what you need, for example 'current weather by airport code'. Matched against service names, descriptions, tags and parameter descriptions.",
    ),
  type: z
    .enum(["http", "mcp"])
    .optional()
    .describe("Restrict to paid HTTP endpoints or paid MCP tools"),
  network: z
    .string()
    .optional()
    .describe("CAIP-2 network, e.g. 'stellar:testnet'. Restrict to what you can actually settle."),
  payTo: z.string().optional().describe("Restrict to one seller's address"),
  limit: z.number().int().optional().describe("Maximum results. Capped by the operator."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque. Pass back the cursor from a previous response; never construct one."),
};

/** `bazaar.search` output. */
export const SEARCH_OUTPUT_SCHEMA: ToolSchemaShape = {
  ...REJECTION_SHAPE,
  resources: z.array(LISTING).optional().describe("Matches, best first"),
  partialResults: z
    .boolean()
    .optional()
    .describe(
      "True when a retriever was degraded or results were truncated — there may be better matches than these. Consider paging or rephrasing.",
    ),
  cursor: z.string().nullable().optional().describe("Pass to the next call, or null at the end"),
};

/** `bazaar.get` input. */
export const GET_INPUT_SCHEMA: ToolSchemaShape = {
  id: z.string().optional().describe("A listing id from bazaar.search"),
  resource: z
    .string()
    .optional()
    .describe("The resource URL, when you do not have an id. Absolute http(s)."),
  toolName: z
    .string()
    .optional()
    .describe(
      "For an MCP listing only. One MCP server exposes many tools at one URL, so (resource, toolName) together identify the listing.",
    ),
};

/** `bazaar.get` output. */
export const GET_OUTPUT_SCHEMA: ToolSchemaShape = {
  ...REJECTION_SHAPE,
  listing: LISTING.optional(),
  settlementCount: z
    .number()
    .optional()
    .describe(
      "Settlements that have counted toward this listing. Settlements below the operator's dust threshold do not count, so this cannot be inflated cheaply.",
    ),
  failureCount: z
    .number()
    .optional()
    .describe(
      "Calls reported as failed against this listing. A high count relative to settlements is a reason to look elsewhere.",
    ),
};

/** `bazaar.paidCall` input. */
export const PAID_CALL_INPUT_SCHEMA: ToolSchemaShape = {
  id: z
    .string()
    .optional()
    .describe(
      "A listing id from bazaar.search. Preferred over `url`: the URL then comes from the catalog rather than from your own reconstruction of it. Mutually exclusive with `url`.",
    ),
  url: z
    .string()
    .optional()
    .describe("An absolute http(s) URL to call directly. Mutually exclusive with `id`."),
  method: z
    .string()
    .optional()
    .describe("Overrides the HTTP method. Defaults to the listing's, or GET."),
  arguments: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The call's parameters. Values matching a :param in the resource URL are substituted into the path; the rest become a query string for GET/HEAD/DELETE, or a JSON body otherwise.",
    ),
};

/** `bazaar.paidCall` output. */
export const PAID_CALL_OUTPUT_SCHEMA: ToolSchemaShape = {
  ...REJECTION_SHAPE,
  data: z.unknown().optional().describe("The resource's response body"),
  url: z.string().optional().describe("The URL actually called, after :param substitution"),
  status: z.number().optional().describe("The resource's HTTP status"),
  payment: z
    .object({
      status: z.string().describe("'settled' on success"),
      transaction: z.string().nullable().describe("The on-chain transaction hash"),
    })
    .optional(),
  budget: z
    .object({
      spent: z.string().describe("Cumulative spend in base units, after this call"),
      remaining: z
        .string()
        .nullable()
        .describe("What is left of the operator's total cap, or null when none was set"),
    })
    .optional()
    .describe(
      "Your remaining allowance. Read it before planning further paid calls — the cap is the operator's, and you cannot raise it.",
    ),
};
