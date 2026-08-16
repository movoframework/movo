/**
 * The service-tier rejection reasons, defined exactly once.
 *
 * AC6.5 requires every rejection to carry a non-null, machine-readable reason so that an
 * agent can branch on failure rather than parse prose. Two families of reason reach a caller
 * of this service, and only one of them is Movo's:
 *
 *  1. **Protocol reasons.** Anything the payment itself is wrong about — a tampered amount, a
 *     wrong asset, an expired auth entry, a replayed payload, a facilitator address where it
 *     must not appear. Every one of these is produced by `@x402/stellar`'s
 *     `ExactStellarScheme` and passed through this service unaltered. Movo neither authors
 *     nor rewrites them. They are `invalid_exact_stellar_payload_*`,
 *     `invalid_exact_stellar_signature_*`, `settle_exact_stellar_*`, `network_mismatch`,
 *     `unsupported_scheme`, `invalid_network` and `invalid_x402_version`, and they are listed
 *     in `docs/operating-a-facilitator/runbook.md` for operators, read from the installed
 *     package rather than from memory.
 *
 *  2. **Transport reasons — this file.** A request that never reaches the scheme at all,
 *     because it was unparseable, oversized, unauthenticated, rate limited, or named a
 *     network this deployment does not serve. Upstream cannot produce a reason for a request
 *     it never saw, so these are Movo's to define, and they are the complete set.
 *
 * They are snake_case, matching upstream's convention, because a client that already
 * branches on `invalidReason` should not need a second parser for this service's half of the
 * vocabulary.
 *
 * **Why they live in one exported constant.** `tests/unit/facilitator-reasons.test.ts` and
 * the AC6.5 enumeration test derive their expectations from this object rather than from
 * copies. That is spec v2 §A.2 rule 2 applied: a gate and its fixtures that each spell the
 * same string out independently drift apart silently, and a renamed reason then leaves a
 * green test asserting nothing.
 */

/** A rejection this service produced before the payment scheme was reached. */
export const TRANSPORT_REASONS = {
  /** The request body was not JSON, or not an object. */
  invalidRequestBody: "invalid_request_body",
  /** The body parsed but did not match the x402 verify/settle envelope. */
  invalidRequestShape: "invalid_request_shape",
  /** `paymentPayload` failed upstream's `PaymentPayloadSchema`. */
  invalidPaymentPayload: "invalid_payment_payload",
  /** `paymentRequirements` failed upstream's `PaymentRequirementsSchema`. */
  invalidPaymentRequirements: "invalid_payment_requirements",
  /** The request body exceeded the configured byte cap. */
  payloadTooLarge: "payload_too_large",
  /** The requirements named a network this deployment has no signer for. */
  unsupportedNetwork: "unsupported_network",
  /** Bearer authentication is enabled and the presented key was absent or unknown. */
  unauthorized: "unauthorized",
  /** The caller exceeded its configured request rate. */
  rateLimited: "rate_limited",
  /** No signer in the pool was available to settle. */
  signerPoolExhausted: "signer_pool_exhausted",
  /** The service is not ready — a sponsor is below its balance floor, or health is unknown. */
  serviceNotReady: "service_not_ready",
} as const;

/** One of the service-tier rejection reasons. */
export type TransportReason = (typeof TRANSPORT_REASONS)[keyof typeof TRANSPORT_REASONS];

/** Every transport reason, for the AC6.5 enumeration test and the operator runbook. */
export const TRANSPORT_REASON_VALUES: readonly TransportReason[] = Object.values(TRANSPORT_REASONS);

/**
 * The HTTP status each transport reason maps to.
 *
 * The status codes matter more than they look. `HTTPFacilitatorClient` — the stock client a
 * resource server uses — treats a non-2xx response with an `isValid` or `success` field as a
 * typed `VerifyError` / `SettleError` carrying `invalidReason` / `errorReason`, and anything
 * else as an opaque `Error` with a text excerpt. So a 4xx that keeps the protocol response
 * shape gives the caller a machine-readable reason, and a 4xx that invents its own body shape
 * gives them a string to regex. That is why every rejection here is emitted in the
 * specification's own response shape regardless of status (see `handlers.ts`).
 */
export const TRANSPORT_REASON_STATUS: { readonly [K in TransportReason]: number } = {
  [TRANSPORT_REASONS.invalidRequestBody]: 400,
  [TRANSPORT_REASONS.invalidRequestShape]: 400,
  [TRANSPORT_REASONS.invalidPaymentPayload]: 400,
  [TRANSPORT_REASONS.invalidPaymentRequirements]: 400,
  [TRANSPORT_REASONS.payloadTooLarge]: 413,
  [TRANSPORT_REASONS.unsupportedNetwork]: 400,
  [TRANSPORT_REASONS.unauthorized]: 401,
  [TRANSPORT_REASONS.rateLimited]: 429,
  [TRANSPORT_REASONS.signerPoolExhausted]: 503,
  [TRANSPORT_REASONS.serviceNotReady]: 503,
};

/**
 * A short human message for each reason.
 *
 * Carried in `invalidMessage` / `errorMessage`, which are the specification's own optional
 * prose fields. The machine-readable half is always the reason; this is for the operator
 * reading a log, never for a client to branch on.
 */
export const TRANSPORT_REASON_MESSAGE: { readonly [K in TransportReason]: string } = {
  [TRANSPORT_REASONS.invalidRequestBody]: "Request body was not valid JSON.",
  [TRANSPORT_REASONS.invalidRequestShape]:
    "Request body did not carry x402Version, paymentPayload and paymentRequirements.",
  [TRANSPORT_REASONS.invalidPaymentPayload]:
    "paymentPayload did not match the x402 payment payload schema.",
  [TRANSPORT_REASONS.invalidPaymentRequirements]:
    "paymentRequirements did not match the x402 payment requirements schema.",
  [TRANSPORT_REASONS.payloadTooLarge]: "Request body exceeded the configured size limit.",
  [TRANSPORT_REASONS.unsupportedNetwork]:
    "This facilitator has no signer configured for the requested network.",
  [TRANSPORT_REASONS.unauthorized]: "A valid bearer key is required for this endpoint.",
  [TRANSPORT_REASONS.rateLimited]: "Request rate exceeded for this caller.",
  [TRANSPORT_REASONS.signerPoolExhausted]:
    "No sponsoring signer was available to settle this payment.",
  [TRANSPORT_REASONS.serviceNotReady]:
    "The facilitator is not ready to settle; check /ready for the failing condition.",
};
