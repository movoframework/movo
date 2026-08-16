/**
 * The Hono application — the HTTP transport, and nothing else.
 *
 * Every route here does the same four things: read the raw body, hand it to a handler in
 * `@movoframework/facilitator`, write the returned status and body, and log the outcome. No
 * route makes a protocol decision, and none constructs a response body of its own.
 *
 * **The route shapes are not a design choice.** `HTTPFacilitatorClient` — the stock client
 * every x402 resource server uses — POSTs to `/verify` and `/settle` with
 * `{ x402Version, paymentPayload, paymentRequirements }` and GETs `/supported`, read from its
 * installed implementation. A facilitator that names them differently is a facilitator no
 * client can reach, which is why §27 says a subtly wrong response shape is worse than an
 * unimplemented endpoint.
 *
 * **Logging.** Structured JSON with a correlation id on every line. No log line may contain a
 * payload, a key, an authorization header or a Stellar secret: the handler returns the caller
 * *id* rather than the credential, the body is never logged, and `redact` is applied to
 * anything structured. `tests/integration/facilitator-log-capture.test.ts` drives a full
 * request with credentials present and asserts zero occurrences of any of them.
 */

import { newCorrelationId, redactRecord } from "@movoframework/core";
import type { FacilitatorRequest, MovoFacilitator } from "@movoframework/facilitator";
import { Hono } from "hono";

/** Where a log line goes. Injected so tests can capture instead of writing to stdout. */
export type LogSink = (record: { readonly [key: string]: unknown }) => void;

/** Options for {@link createFacilitatorApp}. */
export interface FacilitatorAppOptions {
  readonly facilitator: MovoFacilitator;
  /** Defaults to a JSON line on stdout. */
  readonly log?: LogSink;
  /** Service version reported by `/health`. */
  readonly version?: string;
}

/** The Hono app type this module produces. */
export type FacilitatorApp = Hono;

const defaultLog: LogSink = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

/**
 * Build the facilitator HTTP application.
 *
 * @param options - The composed facilitator, a log sink and a version string
 * @returns A Hono application ready to serve
 */
export function createFacilitatorApp(options: FacilitatorAppOptions): FacilitatorApp {
  const { facilitator } = options;
  const log = options.log ?? defaultLog;
  const version = options.version ?? "0.0.0";
  const app = new Hono();

  /** Build the transport-neutral request the handlers expect. */
  async function toRequest(context: {
    req: { text: () => Promise<string>; header: (name: string) => string | undefined };
  }): Promise<FacilitatorRequest> {
    const headers: { [name: string]: string | undefined } = {
      authorization: context.req.header("authorization"),
    };
    return {
      body: await context.req.text(),
      headers,
      ...clientIpOf(context.req.header("x-forwarded-for"), context.req.header("x-real-ip")),
    };
  }

  app.post("/verify", async (context) => {
    const correlationId = newCorrelationId();
    const started = Date.now();
    const result = await facilitator.verify(await toRequest(context));

    log(
      redactRecord({
        level: result.status === 200 ? "info" : "warn",
        event: "facilitator.verify",
        correlationId,
        caller: result.caller,
        status: result.status,
        isValid: result.body.isValid,
        // The reason is upstream's machine-readable token or one of this service's transport
        // reasons. Both are fixed vocabularies with no caller data in them, which is why they
        // are safe to log while the payload they describe is not.
        reason: result.body.invalidReason,
        durationMs: Date.now() - started,
      }),
    );

    return context.json(result.body, result.status as 200, result.headers);
  });

  app.post("/settle", async (context) => {
    const correlationId = newCorrelationId();
    const started = Date.now();
    const result = await facilitator.settle(await toRequest(context));

    log(
      redactRecord({
        level: result.body.success ? "info" : "warn",
        event: "facilitator.settle",
        correlationId,
        caller: result.caller,
        status: result.status,
        success: result.body.success,
        reason: result.body.errorReason,
        // A settled transaction hash is public ledger data the moment it exists, and it is the
        // single most useful field an operator can have when reconciling an incident.
        transaction: result.body.transaction === "" ? undefined : result.body.transaction,
        network: result.body.network,
        durationMs: Date.now() - started,
      }),
    );

    return context.json(result.body, result.status as 200, result.headers);
  });

  app.get("/supported", async (context) => {
    const result = await facilitator.supported(await toRequest(context));
    return context.json(result.body, result.status as 200, result.headers);
  });

  // `/health` is liveness: the process is up and can answer. It must not depend on Horizon,
  // or a network blip restarts a healthy container.
  app.get("/health", (context) =>
    context.json({
      status: "ok",
      version,
      networks: facilitator.networks,
    }),
  );

  // `/ready` is readiness, and it reads real sponsor balances (AC6.9). A facilitator whose
  // sponsors cannot pay a fee must stop receiving traffic rather than accept payments it will
  // fail to settle.
  app.get("/ready", async (context) => {
    const readiness = await facilitator.readiness();
    return context.json(readiness, readiness.ready ? 200 : 503);
  });

  app.get("/metrics", (context) =>
    context.json({
      callers: facilitator.meters(),
      settleFeeStroops: facilitator.config.fees.settleFeeStroops,
      networks: facilitator.networks.map((network) => ({
        network,
        signers: facilitator.poolFor(network)?.addresses ?? [],
        floorXlm: facilitator.poolFor(network)?.floorXlm,
        // Queue depth is the load signal that matters on this service: an account is a mutex,
        // so sustained queueing means the sponsor pool is undersized for the traffic. See
        // docs/operating-a-facilitator/signers-and-channel-accounts.md.
        waiting: facilitator.poolFor(network)?.waitingCount,
      })),
    }),
  );

  app.notFound((context) =>
    context.json({ error: "not_found", message: "No such endpoint on this facilitator." }, 404),
  );

  app.onError((error, context) => {
    log({
      level: "error",
      event: "facilitator.unhandled",
      correlationId: newCorrelationId(),
      // The message only. A stack from a protocol library can contain a serialised payload,
      // and this is a service that handles signed transactions.
      message: error.message,
    });
    return context.json(
      { error: "internal_error", message: "The facilitator failed to process this request." },
      500,
    );
  });

  return app;
}

/**
 * Derive a client address for per-IP rate limiting.
 *
 * `X-Forwarded-For` is trusted here because this service is documented as running behind a
 * proxy that sets it; the runbook says so, and it says what happens if you expose it directly
 * (the header becomes caller-controlled and per-IP limiting becomes decorative, leaving the
 * per-key limit as the real control).
 *
 * @param forwardedFor - The `X-Forwarded-For` header, if any
 * @param realIp - The `X-Real-IP` header, if any
 * @returns A `clientIp` property, or nothing when neither header is present
 */
export function clientIpOf(
  forwardedFor: string | undefined,
  realIp: string | undefined,
): { clientIp?: string } {
  const first = forwardedFor?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") return { clientIp: first };
  if (realIp !== undefined && realIp.trim() !== "") return { clientIp: realIp.trim() };
  return {};
}
