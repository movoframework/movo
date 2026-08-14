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
}

/**
 * Build the request URL for a resource and input.
 *
 * Path parameters are substituted from the input; whatever remains becomes a query string for
 * body-less methods, or the JSON body for the rest. This mirrors what `@movoframework/server`'s
 * handler adapter reads on the other side, which is the whole point of both sides sharing one
 * declaration.
 */
function buildRequest(
  resource: AnyMovoResource,
  input: unknown,
  baseUrl: string,
): { url: string; init: RequestInit } {
  const values: Record<string, unknown> =
    typeof input === "object" && input !== null ? { ...(input as Record<string, unknown>) } : {};

  let path = resource.path;
  for (const [key, value] of Object.entries(values)) {
    const token = `:${key}`;
    if (path.includes(token)) {
      path = path.replace(token, encodeURIComponent(String(value)));
      delete values[key];
    }
  }

  const url = new URL(path, baseUrl);
  const carriesBody = !["GET", "HEAD", "DELETE"].includes(resource.method);

  if (!carriesBody) {
    for (const [key, value] of Object.entries(values)) {
      url.searchParams.set(key, String(value));
    }
    return { url: url.toString(), init: { method: resource.method } };
  }

  return {
    url: url.toString(),
    init: {
      method: resource.method,
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

  return {
    fetch: payingFetch,

    call: async <TIn, TOut>(
      resource: MovoResource<TIn, TOut>,
      input: TIn,
      baseUrl: string,
    ): Promise<CallResult<TOut>> => {
      const { url, init } = buildRequest(resource as unknown as AnyMovoResource, input, baseUrl);
      const response = await payingFetch(url, init);

      const catalog = readCatalogOutcome(response.headers.get("EXTENSION-RESPONSES"));

      // A 402 that survives the paying fetch means no payment was made — either the budget
      // refused, or no acceptable offer was found. Reporting it as `payment_required` rather
      // than throwing lets a caller inspect `budget.refusals` and decide.
      if (response.status === 402) {
        return {
          data: undefined as TOut,
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

        // Spend is recorded only on a settled payment, and only from the amount the facilitator
        // reports settling. Counting at offer-selection time would charge the buyer for payments
        // that failed verification; counting the advertised amount rather than the settled one
        // would drift from reality the first time a scheme supports partial settlement.
        if (status === "settled" && options.budget !== undefined) {
          const amount = (settle as { amount?: unknown }).amount;
          if (typeof amount === "string" && amount.length > 0) {
            options.budget.record({ ...EMPTY_REQUIREMENTS, amount, network: options.network });
          }
        }
      }

      const data = (await response.json()) as TOut;

      return {
        data,
        payment: transaction === undefined ? { status } : { status, transaction },
        catalog,
      };
    },
  };
}
