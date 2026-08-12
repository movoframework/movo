/**
 * The mount — composition, not implementation.
 *
 * Everything this module does is assemble objects upstream already provides and hand them to
 * upstream's middleware. It contains no header construction, no 402 body construction, no
 * lifecycle state machine, no XDR, and no signature verification. `x402ResourceServer` owns
 * verify → handler → settle, with its own abort and recover hooks; reimplementing any part of
 * that would duplicate code that is far better tested than a new implementation could be, and
 * would risk diverging on exactly the ordering semantics that matter most (spec §1.8 D2).
 *
 * The sequence:
 *
 *   1. `compileApp` — pure, produces the raw upstream `RoutesConfig`
 *   2. a `FacilitatorClient` from configuration, or the caller's own
 *   3. `x402ResourceServer` with `ExactStellarScheme` registered for the configured network
 *   4. `x402HTTPResourceServer` wrapping the server and the routes
 *   5. `paymentMiddlewareFromHTTPServer`
 *   6. the plain route handlers, mounted after the middleware
 *
 * Step 5 is `paymentMiddlewareFromHTTPServer` rather than `paymentMiddlewareFromConfig`, and
 * that choice is load-bearing. `FromConfig` constructs the `x402ResourceServer` internally and
 * never exposes it, which makes all seven lifecycle hooks unreachable — and those hooks are
 * where Movo's diagnostics, error translation and correlation IDs are designed to live. The
 * object Movo needs to expose is the object Movo must construct (Spec Amendment 001 §2,
 * docs/SPIKE_REPORT.md Q3, ADR-0008).
 */

import {
  type CompiledApp,
  type ConfigLayers,
  compileApp,
  createHookDispatcher,
  decodePaymentSignatureHeader,
  type Finding,
  type MovoApp,
  type MovoHooks,
  type MovoRequestContext,
  newCorrelationId,
  PAYMENT_HEADERS,
  type PaymentPayload,
} from "@movoframework/core";
import {
  ExactStellarScheme,
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer,
} from "@movoframework/core/server";
import { createFacilitatorClient, type FacilitatorOption } from "./facilitator.js";

/** Options accepted by both mount functions. */
export interface MountOptions {
  /**
   * `"config"` builds an `HTTPFacilitatorClient` from configuration; a `FacilitatorClient`
   * instance is used as given.
   *
   * `"in-process"` and `"mock"` are deliberately absent at M2 — they belong to the testing
   * toolkit, and offering the names before the implementations exist would be a promise.
   */
  readonly facilitator?: FacilitatorOption;
  /** Configuration layers, forwarded to `compileApp`. */
  readonly config?: ConfigLayers;
  /** Observer hooks. Cannot abort or recover; use `MountResult.server` for that. */
  readonly hooks?: MovoHooks;
  /** Receives every static finding produced by compilation. */
  readonly onFinding?: (finding: Finding) => void;
}

/** What a mount returns. */
export interface MountResult {
  /** The compiled application: routes, handlers, provenance and diagnostics. */
  readonly compiled: CompiledApp;
  /**
   * The raw `x402ResourceServer`.
   *
   * Exposed so consumers can attach the upstream hooks Movo does not surface —
   * `onBeforeVerify` can abort, `onVerifyFailure` can recover. This is a stability promise
   * (spec §5.4), and it is the reason the mount point had to change.
   */
  readonly server: x402ResourceServer;
  /** The HTTP resource server, for `onProtectedRequest`. */
  readonly httpServer: x402HTTPResourceServer;
}

/** The subset of Express's app that mounting needs. */
export interface ExpressLike {
  use(handler: unknown): unknown;
  get(path: string, handler: unknown): unknown;
  post(path: string, handler: unknown): unknown;
  put(path: string, handler: unknown): unknown;
  patch(path: string, handler: unknown): unknown;
  delete(path: string, handler: unknown): unknown;
  head(path: string, handler: unknown): unknown;
}

/** Minimal Express request shape the handler adapter reads. */
interface RequestLike {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
  readonly headers?: Record<string, string | string[] | undefined>;
}

/** Minimal Express response shape the handler adapter writes. */
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}

/**
 * Build the shared pieces: compile, construct the resource server, register the scheme.
 *
 * @param app - The Movo application
 * @param options - Mount options
 * @returns The compiled app and both upstream server objects
 */
function assemble(app: MovoApp, options?: MountOptions): MountResult {
  const compiled = compileApp(app, options?.config);

  const dispatcher = createHookDispatcher(options?.hooks);
  dispatcher.compiled(compiled);
  for (const finding of compiled.diagnostics) {
    options?.onFinding?.(finding);
    dispatcher.finding(finding);
  }

  const facilitatorClient = createFacilitatorClient(
    compiled.resolvedConfig,
    options?.facilitator ?? "config",
  );

  const network = compiled.resolvedConfig.network.value;
  const server = new x402ResourceServer(facilitatorClient).register(
    network,
    new ExactStellarScheme(),
  );

  const httpServer = new x402HTTPResourceServer(server, compiled.routes);

  return { compiled, server, httpServer };
}

/**
 * Translate an Express request into a Movo handler context.
 *
 * **The payment context is decoded from the request, not invented.** The buyer's
 * `PAYMENT-SIGNATURE` header carries the payload it signed, and that payload's `accepted` field
 * is the exact `PaymentRequirements` the payment was made against — the same object the
 * facilitator verified. Decoding it with upstream's own codec is composition; filling the
 * context with placeholder strings would be a lie told in the type system, since a handler
 * reading `ctx.payment.amount` would get `""` while the type promised a base-unit amount.
 *
 * `verified: true` is asserted rather than computed, and that is sound: this adapter is mounted
 * *after* the payment middleware, so reaching it means verification already succeeded. Upstream's
 * `SkipHandlerDirective` skips the handler rather than running it unverified
 * (docs/concepts/payment-lifecycle.md).
 *
 * @param request - The Express request
 * @param response - The Express response
 * @returns The handler context, or undefined when no payment payload is present
 */
function toContext(
  request: RequestLike,
  response: ResponseLike,
): MovoRequestContext<unknown> | undefined {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }

  // Express lowercases incoming header names; the constant is the wire spelling.
  const encoded = headers[PAYMENT_HEADERS.signature.toLowerCase()];
  if (encoded === undefined) return undefined;

  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(encoded);
  } catch {
    return undefined;
  }

  const requirements = payload.accepted;
  const payer = typeof payload.payload["from"] === "string" ? payload.payload["from"] : undefined;

  return {
    input: request.body !== undefined && request.body !== null ? request.body : request.query,
    params: request.params ?? {},
    headers,
    correlationId: newCorrelationId(),
    payment: {
      verified: true,
      network: requirements.network,
      asset: requirements.asset,
      amount: requirements.amount,
      requirements,
      ...(payer === undefined ? {} : { payer }),
    },
    raw: { req: request, res: response },
  };
}

/**
 * Mount a Movo application onto an Express app.
 *
 * @param express - The Express application
 * @param app - The Movo application
 * @param options - Facilitator, configuration and hooks
 * @returns The compiled app and the raw upstream servers
 */
export async function mountExpress(
  express: ExpressLike,
  app: MovoApp,
  options?: MountOptions,
): Promise<MountResult> {
  const result = assemble(app, options);

  express.use(paymentMiddlewareFromHTTPServer(result.httpServer));

  for (const [routeKey, handler] of result.compiled.handlers) {
    const method = handler.method.toLowerCase() as
      | "get"
      | "post"
      | "put"
      | "patch"
      | "delete"
      | "head";
    void routeKey;

    express[method](handler.path, async (request: RequestLike, response: ResponseLike) => {
      const context = toContext(request, response);
      if (context === undefined) {
        // Unreachable through the middleware, which returns 402 before a handler is mounted.
        // Reached only if someone mounts these handlers without the middleware, and in that
        // case refusing is the only honest answer: there is no verified payment to describe.
        response.status(500).json({
          error:
            "Movo handler invoked without a verified payment context. This route must be mounted behind the x402 payment middleware.",
        });
        return;
      }
      const body = await handler.resource.handler(context as never);
      response.json(body);
    });
  }

  return result;
}

export { createFacilitatorClient, type FacilitatorOption } from "./facilitator.js";
