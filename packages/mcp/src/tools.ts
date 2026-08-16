/**
 * The three Bazaar tools, without a transport.
 *
 * `bazaar.search`, `bazaar.get`, `bazaar.paidCall` — exactly three, per §25.12. No orchestration,
 * no memory, no planning: those belong to the agent runtime that connects to this server, and a
 * discovery server that also plans is a discovery server nobody can reason about.
 *
 * Kept separate from `server.ts` so that the behaviour AC7.9 is about — a refusal that produces
 * no signature — is testable without standing up a transport. A test that had to speak MCP to
 * observe it would be testing the SDK as much as the control.
 *
 * ## `bazaar.paidCall` and the thing it must never do
 *
 * This tool hands an autonomous agent the ability to spend from a wallet. §25.12 calls an
 * agent-facing paid-call tool without a spend cap "a foot-gun attached to a wallet", and AC7.9
 * requires that an over-budget call is refused **without producing a signature**.
 *
 * That property is not implemented here, and deliberately so. It is a property of
 * `@movoframework/client`'s budget, which is registered as an upstream `PaymentPolicy` and
 * therefore filters offers *before* upstream creates a payment — so a refused offer leaves no
 * signed authorisation in existence at all, rather than one that merely went unsubmitted. What
 * this file adds is the guarantee that the budget is **there**: `createBazaarTools` requires it,
 * and `server.ts` builds the client itself so that a caller cannot hand in one whose budget was
 * quietly omitted.
 *
 * `tools.test.ts` asserts the property with a signer spy, not with the shape of the response.
 * "An error was returned" is compatible with a signature having been produced and thrown away,
 * which is the failure this is guarding against.
 */

import type { Catalog, CatalogListing } from "@movoframework/catalog";
import { listingKey, toDiscoveryResource } from "@movoframework/catalog";
import type { Budget, BudgetRefusal, MovoClient } from "@movoframework/client";
import type { DiscoveryResource } from "@movoframework/core/bazaar";
import { rejection, success, type ToolResult } from "./result.js";

/** How many results `bazaar.search` returns when the agent does not say. */
export const DEFAULT_SEARCH_LIMIT = 10;

/** Everything the three tools need. */
export interface BazaarToolsOptions {
  /** The catalog to read. Its store is the source of truth for every listing. */
  readonly catalog: Catalog;
  /** The buyer used by `bazaar.paidCall`. */
  readonly client: MovoClient;
  /**
   * The budget registered with {@link BazaarToolsOptions.client}.
   *
   * Required, not optional — see this module's header. It is taken as a separate field as well
   * as being inside the client because the client captures it in a closure where nothing can
   * check it, and "the caller promised" is not a spend cap.
   */
  readonly budget: Budget;
}

/** A catalog listing as an agent sees it: the wire shape, plus the id it can act on. */
export interface AgentListing extends DiscoveryResource {
  /**
   * The catalog's own key for this listing.
   *
   * Not part of the discovery wire shape, and added here on purpose: an agent that has searched
   * needs a handle it can pass to `bazaar.get` and `bazaar.paidCall` without re-deriving a key
   * from a URL. Keeping it out would mean every agent inventing the same derivation.
   */
  readonly id: string;
}

/** `bazaar.search` input. */
export interface SearchInput {
  readonly query: string;
  readonly type?: "http" | "mcp";
  readonly network?: string;
  readonly payTo?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/** `bazaar.search` output. */
export interface SearchOutput {
  readonly resources: readonly AgentListing[];
  /**
   * True when a retriever was unavailable or results were truncated.
   *
   * Reported rather than hidden because an agent deciding whether to widen its query needs to
   * know the difference between "these are the best matches" and "these are the best matches
   * one of two retrievers could find".
   */
  readonly partialResults: boolean;
  /** Opaque; pass back verbatim. `null` at the end of the results. */
  readonly cursor: string | null;
}

/** `bazaar.get` input: an `id`, or the `(resource, toolName)` tuple an MCP listing is keyed on. */
export interface GetInput {
  readonly id?: string;
  readonly resource?: string;
  readonly toolName?: string;
}

/** `bazaar.get` output. */
export interface GetOutput {
  readonly listing: AgentListing;
  /** Settlements that have counted toward this listing, above the dust threshold. */
  readonly settlementCount: number;
  /** Calls reported as failed against it. */
  readonly failureCount: number;
}

/** `bazaar.paidCall` input. */
export interface PaidCallInput {
  /** A listing id from `bazaar.search`. Mutually exclusive with `url`. */
  readonly id?: string;
  /** An absolute http(s) URL. Mutually exclusive with `id`. */
  readonly url?: string;
  /** Overrides the method; defaults to the listing's, or `GET`. */
  readonly method?: string;
  /** Substituted into `:params`, then sent as query string or JSON body. */
  readonly arguments?: Readonly<Record<string, unknown>>;
}

/** `bazaar.paidCall` output. */
export interface PaidCallOutput {
  /** The resource's response body. */
  readonly data: unknown;
  /** The URL that was actually called, after `:param` substitution. */
  readonly url: string;
  /** The resource's HTTP status. */
  readonly status: number;
  readonly payment: {
    /** Always `"settled"` on the success branch — anything else is a rejection. */
    readonly status: string;
    /** The on-chain transaction hash. */
    readonly transaction: string | null;
  };
  readonly budget: {
    /** Cumulative spend, in base units, after this call. */
    readonly spent: string;
    /** Remaining allowance, or `null` when no total was configured. */
    readonly remaining: string | null;
  };
}

/** The three tools. */
export interface BazaarTools {
  search(input: SearchInput): Promise<ToolResult<SearchOutput>>;
  get(input: GetInput): Promise<ToolResult<GetOutput>>;
  paidCall(input: PaidCallInput): Promise<ToolResult<PaidCallOutput>>;
}

/**
 * Render a budget refusal as a tool rejection. AC7.9's response.
 *
 * The code is the budget's own — `MOVO_E_BUDGET_EXCEEDED`, `…_PAYTO_NOT_ALLOWED` or
 * `…_NETWORK_NOT_ALLOWED` — rather than an MCP-shaped wrapper, because which constraint fired is
 * exactly what an agent needs in order to decide whether to give up, look elsewhere, or ask its
 * operator to raise a cap. Wrapping all three in one code would throw that away.
 */
function budgetRejection(refused: BudgetRefusal, url: string): ReturnType<typeof rejection> {
  return rejection(
    refused.code,
    `the paid call to ${url} was refused before any payment was created, so no signature exists: ${refused.reason}`,
  );
}

/** Project a stored listing onto the wire shape, plus the id an agent acts on. */
function asAgentListing(listing: CatalogListing): AgentListing {
  return { ...toDiscoveryResource(listing), id: listing.id };
}

/**
 * Build the three Bazaar tools.
 *
 * @param options - The catalog, the buyer client, and the budget that client enforces
 * @returns The three tools
 */
export function createBazaarTools(options: BazaarToolsOptions): BazaarTools {
  const { catalog, client, budget } = options;

  return {
    search: async (input) => {
      const query = (input.query ?? "").trim();
      if (query === "") {
        return rejection(
          "MOVO_E_MCP_INPUT_INVALID",
          "`query` is required and must not be empty; bazaar.search is a natural-language search rather than a listing endpoint. To enumerate a catalog instead, call GET /discovery/resources on the facilitator.",
        );
      }

      // `searchListings`, not `search`: the same ranker, returning the stored form so each
      // result carries the id the agent needs to act on it. See the catalog's own comment for
      // why re-deriving that id here would be a second copy of ingest's keying rule.
      const page = await catalog.searchListings({
        query,
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.network === undefined ? {} : { network: input.network }),
        ...(input.payTo === undefined ? {} : { payTo: input.payTo }),
        limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      });

      return success<SearchOutput>({
        resources: page.listings.map((listing) => asAgentListing(listing)),
        partialResults: page.partialResults,
        cursor: page.cursor,
      });
    },

    get: async (input) => {
      const identifier = resolveIdentifier(input);
      if (identifier.ok === false) return identifier.error;

      const listing = await catalog.get(identifier.id);
      if (listing === undefined) {
        return rejection(
          "MOVO_E_MCP_LISTING_NOT_FOUND",
          `no listing is catalogued under ${identifier.described}`,
        );
      }

      return success<GetOutput>({
        listing: asAgentListing(listing),
        settlementCount: listing.settlementCount,
        failureCount: listing.failureCount,
      });
    },

    paidCall: async (input) => {
      const target = await resolveTarget(catalog, input);
      if (target.ok === false) return target.error;

      // The refusal watermark. Everything the budget refuses during this call appears after it,
      // and a refusal recorded by an earlier call must not be attributed to this one.
      const refusalsBefore = budget.refusals.length;

      let result: Awaited<ReturnType<MovoClient["callUrl"]>>;
      try {
        result = await client.callUrl(
          { path: target.url, method: input.method ?? target.method },
          input.arguments ?? {},
          new URL(target.url).origin,
        );
      } catch (cause) {
        // `[FACT — observed]` When the budget's policy filters every offer, upstream's
        // `wrapFetchWithPayment` does **not** return the original 402: it throws
        // "Failed to create payment payload: All payment requirements were filtered out by
        // policies". That message is upstream's own evidence for AC7.9 — it aborted *before*
        // building a payload, so there was nothing to sign. The refusal is recovered from the
        // budget rather than from the message, because §B.2's lesson is not to make a control's
        // correctness depend on an upstream string that may be collapsed or reworded.
        const refused = budget.refusals.slice(refusalsBefore)[0];
        if (refused !== undefined) return budgetRejection(refused, target.url);

        return rejection(
          "MOVO_E_MCP_CALL_FAILED",
          `the request to ${target.url} did not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (result.payment.status === "payment_required") {
        // The other shape the same refusal can take: a 402 that survives the paying fetch. Both
        // are handled because which one upstream produces is upstream's choice, not a contract.
        const refused = budget.refusals.slice(refusalsBefore)[0];
        if (refused !== undefined) return budgetRejection(refused, target.url);

        return rejection(
          "MOVO_E_MCP_NO_ACCEPTABLE_OFFER",
          `${target.url} answered 402 but named no offer this buyer can settle; the budget refused nothing, so the mismatch is in network or scheme rather than price`,
        );
      }

      if (result.payment.status === "settle_failed") {
        if (target.id !== undefined) await catalog.reportFailure(target.id);
        return rejection(
          "MOVO_E_MCP_SETTLE_FAILED",
          `the payment for ${target.url} was created and submitted but settlement did not succeed${
            result.payment.transaction === undefined
              ? ""
              : ` (transaction ${result.payment.transaction})`
          }; the resource's output was withheld`,
        );
      }

      if (result.status >= 400) {
        // Failure-rate demotion is fed here, at the only place that knows a call through a
        // listing failed. A paid route returning 4xx costs nothing (§6.2 I6), so this is a
        // quality signal rather than a loss.
        if (target.id !== undefined) await catalog.reportFailure(target.id);
        return rejection(
          "MOVO_E_MCP_CALL_FAILED",
          `${target.url} returned HTTP ${String(result.status)} after payment handling; upstream cancels settlement on status 400 and above, so nothing was charged`,
        );
      }

      return success<PaidCallOutput>({
        data: result.data,
        url: target.url,
        status: result.status,
        payment: {
          status: result.payment.status,
          transaction: result.payment.transaction ?? null,
        },
        budget: { spent: budget.spent(), remaining: budget.remaining() ?? null },
      });
    },
  };
}

/**
 * Resolve `bazaar.get`'s three input forms to one catalog key.
 *
 * AC7.7 requires an MCP tool to be retrievable **by its `(url, toolName)` tuple**, so the tuple
 * form is not a convenience — it is the criterion. The key is derived through the catalog's own
 * `listingKey`, never by a second copy of the derivation here, so a change to how listings are
 * keyed cannot silently make this lookup miss.
 */
function resolveIdentifier(
  input: GetInput,
):
  | { ok: true; id: string; described: string }
  | { ok: false; error: ReturnType<typeof rejection> } {
  if (input.id !== undefined && input.id !== "") {
    return { ok: true, id: input.id, described: `id ${input.id}` };
  }

  if (input.resource !== undefined && input.resource !== "") {
    if (input.toolName !== undefined && input.toolName !== "") {
      return {
        ok: true,
        id: listingKey("mcp", input.resource, input.toolName),
        described: `the MCP tuple (${input.resource}, ${input.toolName})`,
      };
    }

    let pathname: string;
    try {
      pathname = new URL(input.resource).pathname;
    } catch {
      return {
        ok: false,
        error: rejection(
          "MOVO_E_MCP_INPUT_INVALID",
          `\`resource\` must be an absolute URL; received ${JSON.stringify(input.resource)}`,
        ),
      };
    }
    return {
      ok: true,
      id: listingKey("http", pathname),
      described: `the HTTP resource ${input.resource}`,
    };
  }

  return {
    ok: false,
    error: rejection(
      "MOVO_E_MCP_INPUT_INVALID",
      "supply either `id`, or `resource` (with `toolName` for an MCP listing). bazaar.search returns the id for every result.",
    ),
  };
}

/** Where a paid call is going, and which listing it belongs to. */
interface PaidTarget {
  readonly ok: true;
  readonly url: string;
  readonly method: string;
  /** The listing id, when the call was addressed by one. Failures are reported against it. */
  readonly id?: string;
}

/**
 * Resolve `bazaar.paidCall`'s target.
 *
 * `id` and `url` are mutually exclusive rather than "id wins". An agent that supplies both has
 * two different intentions and picking one for it silently pays a URL it did not mean to.
 */
async function resolveTarget(
  catalog: Catalog,
  input: PaidCallInput,
): Promise<PaidTarget | { ok: false; error: ReturnType<typeof rejection> }> {
  const hasId = input.id !== undefined && input.id !== "";
  const hasUrl = input.url !== undefined && input.url !== "";

  if (hasId === hasUrl) {
    return {
      ok: false,
      error: rejection(
        "MOVO_E_MCP_INPUT_INVALID",
        hasId
          ? "supply `id` or `url`, not both — they can name different resources and there is no safe way to guess which was meant"
          : "supply either `id` (from bazaar.search) or an absolute `url`",
      ),
    };
  }

  if (hasId) {
    const listing = await catalog.get(input.id as string);
    if (listing === undefined) {
      return {
        ok: false,
        error: rejection(
          "MOVO_E_MCP_LISTING_NOT_FOUND",
          `no listing is catalogued under id ${input.id as string}, so there is no URL to call`,
        ),
      };
    }
    return { ok: true, url: listing.resource, method: listing.method ?? "GET", id: listing.id };
  }

  const url = input.url as string;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      error: rejection(
        "MOVO_E_MCP_INPUT_INVALID",
        `\`url\` must be an absolute URL; received ${JSON.stringify(url)}`,
      ),
    };
  }

  // http(s) only. The budget caps what an agent may spend; this caps what it may address, and
  // without it `file:` and `data:` are reachable from a tool call an LLM composed.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: rejection(
        "MOVO_E_MCP_INPUT_INVALID",
        `\`url\` must be http or https; received the ${parsed.protocol} scheme`,
      ),
    };
  }

  return { ok: true, url, method: input.method ?? "GET" };
}
