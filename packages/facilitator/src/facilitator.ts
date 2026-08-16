/**
 * `createFacilitator` — the composition, and the transport-agnostic handlers over it.
 *
 * ## What this file does and does not contain
 *
 * It contains: request decoding, schema validation against upstream's schemas, caller
 * authentication, rate limiting, metering, signer leasing, and the mapping from an outcome to
 * an HTTP status. That is the service tier.
 *
 * It contains **no** verification or settlement logic. Not one line. Auth-entry structure and
 * credential type, signature-expiration ledger bounds, sub-invocation rejection, simulation,
 * transfer-event matching, the four facilitator-safety checks, transaction rebuild, signing,
 * fee bumping, submission and confirmation polling all live in `ExactStellarScheme` inside
 * `@x402/stellar`. This file constructs that object, registers it on `x402Facilitator`, and
 * calls it. `pnpm check:protocol-purity` scans this package for XDR construction and
 * signature handling and fails the build on either (AC6.10).
 *
 * ## Why the handlers take a raw body string
 *
 * Because the byte cap has to be enforced before parsing, and because a handler that accepts
 * an already-parsed object cannot distinguish "not JSON" from "JSON of the wrong shape" —
 * which are two different reasons under AC6.5. The transport hands over exactly what arrived.
 *
 * ## The lease binding
 *
 * `ExactStellarScheme.settle()` calls its `selectSigner` callback synchronously and offers no
 * way to pass per-call context. So `settle` acquires a lease from the pool, binds it into an
 * `AsyncLocalStorage`, and the `selectSigner` closure reads it. Without this the pool's
 * in-flight accounting would be advisory — it would know what it wanted and upstream would do
 * something else — and AC6.8 would be measuring round-robin.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  FacilitatorClient,
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@movoframework/core";
import {
  FacilitatorExactStellarScheme,
  PaymentPayloadSchema,
  PaymentRequirementsSchema,
  x402Facilitator,
} from "@movoframework/core/facilitator";
import type { FacilitatorConfig, FacilitatorNetworkConfig } from "./config.js";
import { ANONYMOUS_CALLER, type CallerMeter, Metering } from "./metering.js";
import { RateLimiter } from "./rate-limit.js";
import {
  TRANSPORT_REASON_MESSAGE,
  TRANSPORT_REASON_STATUS,
  TRANSPORT_REASONS,
  type TransportReason,
} from "./reasons.js";
import { SignerPool, type SignerPoolHealth } from "./signer-pool.js";

/** What a transport hands the handlers. */
export interface FacilitatorRequest {
  /** The raw, unparsed request body. Empty string for `GET /supported`. */
  readonly body: string;
  /** Request headers, lowercased by the transport. */
  readonly headers: { readonly [name: string]: string | undefined };
  /** Source address, for per-IP rate limiting. */
  readonly clientIp?: string;
}

/** What the handlers hand back. Bodies are the specification's shapes, unextended. */
export interface FacilitatorResponse<T> {
  readonly status: number;
  readonly body: T;
  readonly headers: { readonly [name: string]: string };
  /**
   * The bearer key id that served this request, or `anonymous`.
   *
   * Carried alongside the response rather than in it, so the transport can attach it to a log
   * line without any part of it reaching the wire.
   */
  readonly caller: string;
}

/**
 * A hook invoked after a settlement completes, so a catalog can ingest it.
 *
 * Typed as a port rather than as a dependency on `@movoframework/catalog`, for the same reason
 * `MountOptions.facilitator` takes a `FacilitatorClient` instead of importing the testing
 * package: a facilitator that must load a catalog — and therefore a store driver, and an
 * embedding model — in order to settle a payment has taken on the discovery track's
 * dependencies to do the core track's job. `apps/facilitator` wires the two together.
 *
 * **It cannot change the settlement.** It receives the completed result and returns only what
 * to report in `EXTENSION-RESPONSES`. Cataloguing is a side effect of a payment, never a
 * condition of one: a catalog outage must not stop money moving, so a throwing observer is
 * swallowed and the settlement stands.
 */
export type SettlementObserver = (event: {
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
  readonly settleResponse: SettleResponse;
}) => Promise<ExtensionResponse | undefined>;

/**
 * What an observer reports back, in the `EXTENSION-RESPONSES` vocabulary.
 *
 * The wire format was read from `@x402/core`'s `logExtensionResponsesHeader`: the header is
 * base64 JSON keyed by extension key, carrying `status` and `rejectedReason` among the fields
 * it surfaces. Upstream ships a *reader* for it and no writer, which is why this service
 * encodes it by hand — the same gap `readCatalogOutcome` documents from the client side, seen
 * from the other end, and a candidate upstream contribution.
 */
export interface ExtensionResponse {
  readonly key: string;
  readonly status: "success" | "processing" | "rejected";
  readonly rejectedReason?: string;
}

/**
 * Encode an `EXTENSION-RESPONSES` header value.
 *
 * @param responses - One entry per extension that reported
 * @returns The base64 header value, or undefined when nothing reported
 */
export function encodeExtensionResponses(
  responses: readonly ExtensionResponse[],
): string | undefined {
  if (responses.length === 0) return undefined;
  const body: { [key: string]: { status: string; rejectedReason?: string } } = {};
  for (const response of responses) {
    body[response.key] = {
      status: response.status,
      // AC7.6: a rejection ALWAYS carries a populated reason. A `rejected` with no reason is
      // the shape that teaches an integrator to stop reading the header.
      ...(response.status === "rejected"
        ? { rejectedReason: response.rejectedReason ?? "unspecified" }
        : {}),
    };
  }
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

/**
 * The read-only view of a signer pool that operational surfaces are given.
 *
 * `/metrics`, a runbook script and a test all want to *see* the pool. None of them should be
 * able to lease from it: an acquisition that is never released leaks in-flight load and
 * quietly biases every subsequent selection.
 */
export interface SignerPoolView {
  readonly addresses: readonly string[];
  readonly floorXlm: number;
  /** Settlements queued for a free account. The operator signal that the pool is undersized. */
  readonly waitingCount: number;
  loadOf(address: string): number;
  health(): Promise<SignerPoolHealth>;
  invalidateBalances(): void;
}

/** Aggregate readiness across every configured network. */
export interface FacilitatorReadiness {
  readonly ready: boolean;
  readonly networks: readonly SignerPoolHealth[];
}

/** The service object `createFacilitator` returns. */
export interface MovoFacilitator {
  /** `POST /verify`. */
  verify(request: FacilitatorRequest): Promise<FacilitatorResponse<VerifyResponse>>;
  /** `POST /settle`. */
  settle(request: FacilitatorRequest): Promise<FacilitatorResponse<SettleResponse>>;
  /** `GET /supported`. */
  supported(request: FacilitatorRequest): Promise<FacilitatorResponse<SupportedResponse>>;
  /** Sponsor balances and in-flight load, per network. Backs `/ready`. */
  readiness(): Promise<FacilitatorReadiness>;
  /** Per-caller counters. Backs `/metrics`. */
  meters(): readonly CallerMeter[];
  /** The configured networks, in configuration order. */
  readonly networks: readonly Network[];
  /**
   * The signer pool for a network, for operational tooling and tests.
   *
   * Typed as {@link SignerPoolView} rather than as the `SignerPool` class on purpose. A
   * service contract that names a class makes every consumer nominally dependent on that
   * class's private fields, which breaks the moment a test reaches the same package through
   * two module paths — and more importantly, a `/metrics` endpoint has no business holding a
   * handle it could call `acquire()` on.
   */
  poolFor(network: Network): SignerPoolView | undefined;
  /**
   * The same facilitator as an in-process {@link FacilitatorClient}, with no HTTP hop.
   *
   * This is the **self-facilitation** entry point (AC6.12): a resource server passes the
   * returned object to `mountExpress({ facilitator })` and settles its own payments in the
   * same process, with the same signer pool, metering and readiness as the standalone
   * service. Going through `localhost` HTTP to reach a facilitator in your own process would
   * add a serialisation round trip and a listening socket for no benefit.
   */
  asFacilitatorClient(): FacilitatorClient;
  /** The resolved configuration, for `/health` and for tests. */
  readonly config: FacilitatorConfig;
}

interface NetworkRuntime {
  readonly config: FacilitatorNetworkConfig;
  readonly pool: SignerPool;
}

interface Lease {
  readonly address: string;
}

/**
 * Compose a facilitator service over `x402Facilitator` + `ExactStellarScheme`.
 *
 * @param config - A resolved service configuration
 * @returns The service handlers, readiness, metering and in-process client
 */
export function createFacilitator(
  config: FacilitatorConfig,
  observers: readonly SettlementObserver[] = [],
): MovoFacilitator {
  const leases = new AsyncLocalStorage<Lease>();
  const runtimes = new Map<Network, NetworkRuntime>();
  const engine = new x402Facilitator();

  for (const network of config.networks) {
    const pool = new SignerPool({
      network: network.network,
      signers: network.signers,
      floorXlm: network.sponsorFloorXlm,
      balanceCacheMs: config.balanceCacheMs,
    });

    // Everything protocol-shaped about this registration is upstream's: the scheme object,
    // its options, the network key, and the `getSupported()` entry it produces. Movo supplies
    // the signer list and the selection callback, which are operations, not protocol.
    const scheme = new FacilitatorExactStellarScheme([...network.signers], {
      areFeesSponsored: network.areFeesSponsored,
      maxTransactionFeeStroops: network.maxTransactionFeeStroops,
      selectSigner: (offered) => pool.select(leases.getStore()?.address, offered),
      ...(network.rpcUrl === undefined ? {} : { rpcConfig: { url: network.rpcUrl } }),
      ...(network.feeBumpSigner === undefined ? {} : { feeBumpSigner: network.feeBumpSigner }),
    });

    engine.register(network.network, scheme);
    runtimes.set(network.network, { config: network, pool });
  }

  const metering = new Metering(config.fees.settleFeeStroops);
  const limiter = new RateLimiter({ windowMs: config.rateLimit.windowMs });

  /** Resolve the caller from the Authorization header, or reject. */
  function authenticate(request: FacilitatorRequest): { caller: string } | TransportReason {
    if (config.auth.mode === "open") return { caller: ANONYMOUS_CALLER };

    const header = request.headers["authorization"] ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (presented === "") return TRANSPORT_REASONS.unauthorized;

    // Linear scan with a full comparison of every candidate, so the loop's duration does not
    // depend on which key matched. Key counts here are small; a map lookup keyed by the
    // secret would be faster and would leak match position through timing.
    let matched: string | undefined;
    for (const key of config.auth.keys) {
      if (constantTimeEquals(key.secret, presented)) matched = key.id;
    }
    if (matched === undefined) return TRANSPORT_REASONS.unauthorized;
    return { caller: matched };
  }

  /** Apply the per-key and per-IP budgets. */
  function rateLimit(caller: string, request: FacilitatorRequest): TransportReason | undefined {
    if (!config.rateLimit.enabled) return undefined;

    const keyLimit =
      config.auth.keys.find((key) => key.id === caller)?.requestsPerWindow ??
      config.rateLimit.requestsPerWindowPerKey;

    if (!limiter.consume(`key:${caller}`, keyLimit).allowed) return TRANSPORT_REASONS.rateLimited;

    const ip = request.clientIp;
    if (ip !== undefined && ip !== "") {
      if (!limiter.consume(`ip:${ip}`, config.rateLimit.requestsPerWindowPerIp).allowed) {
        return TRANSPORT_REASONS.rateLimited;
      }
    }
    return undefined;
  }

  /**
   * Decode and validate a verify/settle envelope.
   *
   * Every field-level judgement here is upstream's. `PaymentPayloadSchema` and
   * `PaymentRequirementsSchema` are the same schemas `HTTPFacilitatorClient` parses facilitator
   * responses with, so this service accepts exactly what upstream considers well-formed —
   * rather than a Movo opinion about it that could diverge on the day upstream changes.
   */
  function decode(
    request: FacilitatorRequest,
  ):
    | { payload: PaymentPayload; requirements: PaymentRequirements; network: Network }
    | TransportReason {
    if (Buffer.byteLength(request.body, "utf8") > config.maxBodyBytes) {
      return TRANSPORT_REASONS.payloadTooLarge;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      return TRANSPORT_REASONS.invalidRequestBody;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return TRANSPORT_REASONS.invalidRequestBody;
    }

    const envelope = parsed as { [key: string]: unknown };
    if (envelope["paymentPayload"] === undefined || envelope["paymentRequirements"] === undefined) {
      return TRANSPORT_REASONS.invalidRequestShape;
    }

    const payload = PaymentPayloadSchema.safeParse(envelope["paymentPayload"]);
    if (!payload.success) return TRANSPORT_REASONS.invalidPaymentPayload;

    const requirements = PaymentRequirementsSchema.safeParse(envelope["paymentRequirements"]);
    if (!requirements.success) return TRANSPORT_REASONS.invalidPaymentRequirements;

    // `network` is taken from the requirements rather than the payload on purpose: the
    // requirements are what the *seller* asked for. Upstream separately rejects a payload
    // whose network disagrees (`network_mismatch`), and that check stays upstream's.
    const network = requirements.data.network as Network;
    if (!runtimes.has(network)) return TRANSPORT_REASONS.unsupportedNetwork;

    return {
      payload: payload.data as unknown as PaymentPayload,
      requirements: requirements.data as unknown as PaymentRequirements,
      network,
    };
  }

  function verifyRejection(
    reason: TransportReason,
    caller: string,
  ): FacilitatorResponse<VerifyResponse> {
    metering.recordRejection(caller);
    return {
      status: TRANSPORT_REASON_STATUS[reason],
      // The specification's own verify shape, even on a 4xx. `HTTPFacilitatorClient` turns a
      // non-2xx body containing `isValid` into a typed `VerifyError` carrying `invalidReason`;
      // a bespoke error envelope would instead give the caller a string to regex. AC6.5 is
      // about a machine-readable reason, and this is what makes it one.
      body: {
        isValid: false,
        invalidReason: reason,
        invalidMessage: TRANSPORT_REASON_MESSAGE[reason],
      },
      headers: retryHeaders(reason),
      caller,
    };
  }

  function settleRejection(
    reason: TransportReason,
    caller: string,
    network: Network | undefined,
  ): FacilitatorResponse<SettleResponse> {
    metering.recordRejection(caller);
    return {
      status: TRANSPORT_REASON_STATUS[reason],
      body: {
        success: false,
        errorReason: reason,
        errorMessage: TRANSPORT_REASON_MESSAGE[reason],
        // `transaction` and `network` are required by the settle shape. An empty transaction
        // reference is what upstream itself returns on a failed settle, read from
        // `ExactStellarScheme.settle`; inventing a placeholder hash would be a fabricated
        // settlement reference, which this repository does not do under any circumstance.
        transaction: "",
        network: network ?? (config.networks[0]?.network as Network),
      },
      headers: retryHeaders(reason),
      caller,
    };
  }

  function retryHeaders(reason: TransportReason): { readonly [name: string]: string } {
    if (reason === TRANSPORT_REASONS.rateLimited) {
      return { "Retry-After": String(Math.ceil(config.rateLimit.windowMs / 1000)) };
    }
    return {};
  }

  async function guard(
    request: FacilitatorRequest,
  ): Promise<{ caller: string } | { caller: string; reason: TransportReason }> {
    const authenticated = authenticate(request);
    if (typeof authenticated === "string") {
      return { caller: ANONYMOUS_CALLER, reason: authenticated };
    }
    const limited = rateLimit(authenticated.caller, request);
    if (limited !== undefined) return { caller: authenticated.caller, reason: limited };
    return authenticated;
  }

  async function runVerify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const result = await engine.verify(payload, requirements);
    // Upstream returns `isValid: false` with a reason on every rejection path read from its
    // source. The `??` is the belt to that braces: AC6.5 is a hard invariant and a null reason
    // reaching a caller is worse than a slightly less specific one.
    if (result.isValid) return result;
    return { ...result, invalidReason: result.invalidReason ?? "verification_failed" };
  }

  async function runSettle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    network: Network,
  ): Promise<SettleResponse> {
    const runtime = runtimes.get(network);
    if (runtime === undefined) {
      return {
        success: false,
        errorReason: TRANSPORT_REASONS.unsupportedNetwork,
        transaction: "",
        network,
      };
    }

    const lease = await runtime.pool.acquire();
    if (lease === undefined) {
      return {
        success: false,
        errorReason: TRANSPORT_REASONS.signerPoolExhausted,
        transaction: "",
        network,
      };
    }

    try {
      const result = await leases.run({ address: lease.address }, () =>
        engine.settle(payload, requirements),
      );
      if (result.success) return result;
      return { ...result, errorReason: result.errorReason ?? "settlement_failed" };
    } finally {
      lease.release();
    }
  }

  return {
    config,
    networks: config.networks.map((entry) => entry.network),

    poolFor: (network) => runtimes.get(network)?.pool,

    verify: async (request) => {
      const guarded = await guard(request);
      if ("reason" in guarded) return verifyRejection(guarded.reason, guarded.caller);

      const decoded = decode(request);
      if (typeof decoded === "string") return verifyRejection(decoded, guarded.caller);

      const body = await runVerify(decoded.payload, decoded.requirements);
      metering.record(guarded.caller, "verify", body.isValid);
      return { status: 200, body, headers: {}, caller: guarded.caller };
    },

    settle: async (request) => {
      const guarded = await guard(request);
      if ("reason" in guarded) return settleRejection(guarded.reason, guarded.caller, undefined);

      const decoded = decode(request);
      if (typeof decoded === "string") {
        return settleRejection(decoded, guarded.caller, undefined);
      }

      const body = await runSettle(decoded.payload, decoded.requirements, decoded.network);
      metering.record(guarded.caller, "settle", body.success);

      // Observers run after the settlement is final and cannot alter it. Each is isolated:
      // a catalog that throws must not turn a completed payment into an error response, so a
      // failure here is dropped rather than propagated. The buyer's money moved either way.
      const extensionResponses: ExtensionResponse[] = [];
      for (const observe of observers) {
        try {
          const reported = await observe({
            paymentPayload: decoded.payload,
            paymentRequirements: decoded.requirements,
            settleResponse: body,
          });
          if (reported !== undefined) extensionResponses.push(reported);
        } catch {
          // Deliberately swallowed. See above.
        }
      }

      const encoded = encodeExtensionResponses(extensionResponses);

      // 200 with `success: false` rather than a 4xx: a settlement that was correctly refused
      // is a completed protocol exchange, not a failed HTTP request, and the stock resource
      // server reads the reason out of the body either way. Reserving non-2xx for transport
      // failures keeps the two classes distinguishable to an operator reading access logs.
      return {
        status: 200,
        body,
        headers: encoded === undefined ? {} : { "EXTENSION-RESPONSES": encoded },
        caller: guarded.caller,
      };
    },

    supported: async (request) => {
      const guarded = await guard(request);
      if ("reason" in guarded) {
        metering.recordRejection(guarded.caller);
        return {
          status: TRANSPORT_REASON_STATUS[guarded.reason],
          // `/supported` has no failure shape in the specification, so a rejection here
          // returns an empty-but-valid supported response rather than an invented error body.
          // A caller cannot mistake it for capability: `kinds` is empty.
          body: { kinds: [], extensions: [], signers: {} },
          headers: retryHeaders(guarded.reason),
          caller: guarded.caller,
        };
      }

      // `x402Facilitator.getSupported()` is synchronous and produces the whole response,
      // including each scheme's `extra` (for Stellar: `areFeesSponsored`) and the `signers`
      // block keyed by CAIP-family. Movo does not assemble this; assembling it by hand is
      // exactly how a facilitator ends up with a subtly wrong shape that no client accepts.
      const upstream = engine.getSupported();
      metering.record(guarded.caller, "supported", true);
      return {
        status: 200,
        body: {
          ...upstream,
          kinds: upstream.kinds.map((kind) => ({
            x402Version: kind.x402Version,
            scheme: kind.scheme,
            network: kind.network as Network,
            ...(kind.extra === undefined ? {} : { extra: kind.extra }),
          })),
        },
        headers: {},
        caller: guarded.caller,
      };
    },

    readiness: async () => {
      const networks = await Promise.all(
        [...runtimes.values()].map((runtime) => runtime.pool.health()),
      );
      return { ready: networks.every((network) => network.healthy), networks };
    },

    meters: () => metering.snapshot(),

    asFacilitatorClient: (): FacilitatorClient => ({
      verify: (payload, requirements) => runVerify(payload, requirements),
      settle: (payload, requirements) =>
        runSettle(payload, requirements, requirements.network as Network),
      getSupported: async (): Promise<SupportedResponse> => {
        const upstream = engine.getSupported();
        return {
          ...upstream,
          kinds: upstream.kinds.map((kind) => ({
            x402Version: kind.x402Version,
            scheme: kind.scheme,
            network: kind.network as Network,
            ...(kind.extra === undefined ? {} : { extra: kind.extra }),
          })),
        };
      },
    }),
  };
}

/**
 * Compare two strings without leaking their common prefix length through timing.
 *
 * Bearer secrets are compared with this rather than `===`. The attack it forecloses is
 * narrow and the mitigation is cheap; the reason it is written out rather than imported is
 * that `crypto.timingSafeEqual` throws on unequal lengths, which reintroduces a length oracle
 * unless the caller pads — and the padding is the part people get wrong.
 *
 * @param expected - The configured secret
 * @param presented - The credential from the request
 * @returns True when the two are identical
 */
export function constantTimeEquals(expected: string, presented: string): boolean {
  const length = Math.max(expected.length, presented.length);
  let difference = expected.length ^ presented.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (expected.charCodeAt(index) || 0) ^ (presented.charCodeAt(index) || 0);
  }
  return difference === 0;
}
