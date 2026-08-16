/**
 * `createMovoClient` — a buyer, composed from upstream, with two additions.
 *
 * The composition is `x402Client` + `ExactStellarScheme` (client subpath) + `wrapFetchWithPayment`,
 * all upstream. Movo adds exactly two things and claims nothing else:
 *
 * **A budget**, registered as an upstream `PaymentPolicy` so refusal happens before payment
 * creation. See `./budget.ts`.
 *
 * **`call()`**, which reuses the *server's* `MovoResource` declaration to give end-to-end type
 * safety: the handler's return type becomes the call site's result type, with no cast and no
 * duplicated interface. This is the one genuinely novel thing in the package. It works because a
 * resource is plain, serialisable data that both sides can import — the same property that lets
 * `movo doctor` analyse a project without booting it.
 *
 * **The signer is always supplied by the caller.** No Movo package generates, derives, stores or
 * persists a key, and CI greps for a keypair-generation path. `createMovoClient` takes a signer
 * the caller built; it never builds one (spec §5.8).
 */

import { type CatalogOutcome, readCatalogOutcome } from "@movoframework/bazaar";
import {
  type AnyMovoResource,
  type MovoResource,
  type Network,
  PAYMENT_HEADERS,
  type PaymentRequirements,
  type RpcConfig,
} from "@movoframework/core";
import {
  type ClientStellarSigner,
  decodePaymentResponseHeader,
  ExactStellarScheme,
  wrapFetchWithPayment,
  x402Client,
} from "@movoframework/core/client";
import type { Budget } from "./budget.js";

/**
 * A requirements shell for recording spend.
 *
 * `Budget.record` takes `PaymentRequirements` because that is what the policy sees, but at
 * settlement time the only field that matters is the amount actually settled. Rather than
 * inventing a second recording API, the settled amount is carried in on this shell — the other
 * fields are unused by the accountant and are left empty rather than guessed at.
 */
const EMPTY_REQUIREMENTS: Omit<PaymentRequirements, "amount" | "network"> = {
  scheme: "",
  asset: "",
  payTo: "",
  maxTimeoutSeconds: 0,
  extra: {},
};

/** Options for {@link createMovoClient}. */
export interface MovoClientOptions {
  /** The buyer's signer. Always supplied by the caller; Movo never creates one. */
  readonly signer: ClientStellarSigner;
  /** The network to settle on. */
  readonly network: Network;
  /** A budget, whose policy is registered with the upstream client. */
  readonly budget?: Budget;
  /** RPC overrides, forwarded to the scheme. */
  readonly rpc?: RpcConfig;
}

/** What a payment attempt did. */
export type PaymentStatus = "settled" | "settle_failed" | "payment_required" | "none";

/** The result of a typed `call()`. */
export interface CallResult<TOut> {
  /** The handler's return value, typed from the resource declaration. */
  readonly data: TOut;
  /**
   * The HTTP status of the response the buyer finally received.
   *
   * Present because "did the call work" and "was it paid for" are different questions with
   * different answers, and a caller that has to infer one from the other gets it wrong on the
   * case that matters: a paid route returning 404 settles nothing (§6.2 I6) and would otherwise
   * look identical to a route nobody charged for.
   */
  readonly status: number;
  /** What happened to the payment. */
  readonly payment: {
    readonly status: PaymentStatus;
    readonly transaction?: string;
  };
  /**
   * What the facilitator said about cataloging — including saying nothing.
   *
   * Always present, never undefined, and `unknown` is not a failure. See
   * `@movoframework/bazaar`'s `readCatalogOutcome`.
   */
  readonly catalog: CatalogOutcome;
}

/** A Movo buyer client. */
export interface MovoClient {
  /** A `fetch` that pays 402s automatically, subject to the budget. */
  readonly fetch: typeof globalThis.fetch;
  /**
   * Call a resource by its declaration, with the handler's return type flowing to the result.
   *
   * @param resource - The resource declaration, imported from the server's own source
   * @param input - The input, typed by the resource's input schema
   * @param baseUrl - The origin serving the resource
   * @returns The typed result, the payment outcome and the catalog outcome
   */
  call<TIn, TOut>(
    resource: MovoResource<TIn, TOut>,
    input: TIn,
    baseUrl: string,
  ): Promise<CallResult<TOut>>;
  /**
   * Call a route the caller describes, rather than one a `MovoResource` declares.
   *
   * The same request building, the same payment handling, the same spend accounting — the only
   * thing given up is the return type, which is `unknown` because there is no declaration to
   * read it from. This exists for `@movoframework/mcp`'s `bazaar.paidCall`: an agent that
   * discovered a listing holds a URL and a bag of arguments and has, by construction, no typed
   * declaration to import. That is what "no pre-baked integration" means.
   *
   * It is a method on the client rather than a helper beside it so that spend recording cannot
   * be forgotten. A `paidCall` built on the raw `fetch` would settle real payments that the
   * cumulative accountant never saw, and `maxTotalSpend` — the cap that matters most to an
   * autonomous agent — would never fire.
   *
   * @param route - Path or absolute URL, possibly carrying `:params`, and a method
   * @param input - Values substituted into `:params`, then sent as query or JSON body
   * @param baseUrl - The origin, used when `route.path` is relative
   * @returns The parsed body, the payment outcome and the catalog outcome
   */
  callUrl(route: PaidRoute, input: unknown, baseUrl: string): Promise<CallResult<unknown>>;
}

/** A route to call: a path or absolute URL that may carry `:param` segments, and a method. */
export interface PaidRoute {
  readonly path: string;
  readonly method: string;
}

/**
 * Build the request URL and init for a route and an input.
 *
 * Path parameters are substituted from the input; whatever remains becomes a query string for
 * body-less methods, or the JSON body for the rest. This mirrors what `@movoframework/server`'s
 * handler adapter reads on the other side, which is the whole point of both sides sharing one
 * declaration.
 *
 * `path` is widened to accept an absolute URL so that `callUrl` — which is handed a resource
 * URL out of a catalog listing rather than a relative path out of a declaration — shares this
 * one copy of the substitution rule. Two copies would be two chances for the buyer to address a
 * different URL than the seller published.
 *
 * @param route - The path or absolute URL, and the HTTP method
 * @param input - Values to substitute into `:params`, then to send
 * @param baseUrl - The origin, used when `route.path` is relative
 * @returns The resolved URL and a `fetch` init
 */
function buildPaidRequest(
  route: PaidRoute,
  input: unknown,
  baseUrl: string,
): { url: string; init: RequestInit } {
  const values: Record<string, unknown> =
    typeof input === "object" && input !== null ? { ...(input as Record<string, unknown>) } : {};

  let path = route.path;
  for (const [key, value] of Object.entries(values)) {
    const token = `:${key}`;
    if (path.includes(token)) {
      path = path.replace(token, encodeURIComponent(String(value)));
      delete values[key];
    }
  }

  const url = new URL(path, baseUrl);
  const carriesBody = !["GET", "HEAD", "DELETE"].includes(route.method);

  if (!carriesBody) {
    for (const [key, value] of Object.entries(values)) {
      url.searchParams.set(key, String(value));
    }
    return { url: url.toString(), init: { method: route.method } };
  }

  return {
    url: url.toString(),
    init: {
      method: route.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    },
  };
}

/**
 * Create a buyer client.
 *
 * @param options - Signer, network, optional budget and RPC overrides
 * @returns A client with a paying `fetch` and a typed `call`
 */
export function createMovoClient(options: MovoClientOptions): MovoClient {
  const client = new x402Client().register(
    options.network,
    new ExactStellarScheme(options.signer, options.rpc),
  );

  // The budget is an upstream policy. Registering it here means every offer passes through it
  // before upstream creates a payment — so a refusal happens with no signature in existence.
  if (options.budget !== undefined) client.registerPolicy(options.budget.policy);

  const payingFetch = wrapFetchWithPayment(globalThis.fetch, client);

  const callUrl = async (
    route: PaidRoute,
    input: unknown,
    baseUrl: string,
  ): Promise<CallResult<unknown>> => {
    const { url, init } = buildPaidRequest(route, input, baseUrl);
    const response = await payingFetch(url, init);

    const catalog = readCatalogOutcome(response.headers.get("EXTENSION-RESPONSES"));

    // A 402 that survives the paying fetch means no payment was made — either the budget
    // refused, or no acceptable offer was found. Reporting it as `payment_required` rather
    // than throwing lets a caller inspect `budget.refusals` and decide.
    if (response.status === 402) {
      return {
        data: undefined,
        status: response.status,
        payment: { status: "payment_required" },
        catalog,
      };
    }

    const header = response.headers.get(PAYMENT_HEADERS.response);

    let status: PaymentStatus = "none";
    let transaction: string | undefined;

    if (header !== null) {
      const settle = decodePaymentResponseHeader(header);
      status = settle.success ? "settled" : "settle_failed";
      if (typeof settle.transaction === "string" && settle.transaction.length > 0) {
        transaction = settle.transaction;
      }

      // Spend is recorded only on a settled payment. Counting at offer-selection time would
      // charge the buyer for payments that failed verification.
      //
      // `SettleResponse.amount` is **optional** and the `exact` scheme does not populate it —
      // upstream reserves it for schemes like `upto` where the settled amount can differ from
      // the authorised one. Before this fallback existed, every real Stellar settlement took the
      // absent branch, `spent()` never moved, and `maxTotalSpend` was a cap that could not fire.
      // See `Budget.recordAuthorized`.
      if (status === "settled" && options.budget !== undefined) {
        const amount = (settle as { amount?: unknown }).amount;
        if (typeof amount === "string" && amount.length > 0) {
          options.budget.record({ ...EMPTY_REQUIREMENTS, amount, network: options.network });
        } else {
          options.budget.recordAuthorized();
        }
      }
    }

    // A non-2xx body is still read and returned. The caller needs it to explain the failure,
    // and upstream has already cancelled settlement for status >= 400, so there is no payment
    // to protect by withholding it. A body that is not JSON yields `undefined` rather than
    // throwing, because a paid route returning HTML is a bad server, not a client bug.
    const data: unknown = await response.json().catch(() => undefined);

    return {
      data,
      status: response.status,
      payment: transaction === undefined ? { status } : { status, transaction },
      catalog,
    };
  };

  return {
    fetch: payingFetch,
    callUrl,

    call: async <TIn, TOut>(
      resource: MovoResource<TIn, TOut>,
      input: TIn,
      baseUrl: string,
    ): Promise<CallResult<TOut>> => {
      const declaration = resource as unknown as AnyMovoResource;
      const result = await callUrl(
        { path: declaration.path, method: declaration.method },
        input,
        baseUrl,
      );
      return result as CallResult<TOut>;
    },
  };
}
