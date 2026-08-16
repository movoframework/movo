/**
 * `@movoframework/facilitator` — the service tier of a Stellar x402 facilitator.
 *
 * Movo owns the service and never the cryptography. Every protocol operation — auth-entry
 * validation, simulation, expiry checking, transaction rebuild, signing, fee bumping,
 * submission, confirmation — belongs to `@x402/stellar`'s `ExactStellarScheme` and
 * `@x402/core`'s `x402Facilitator`. What this package adds is everything a scheme object is
 * not: a signer pool with channel accounts, balance floors and readiness, caller
 * authentication, metering, rate limiting, and the request/response handling that turns those
 * two objects into something an unmodified stock client can pay through.
 *
 * @see docs/adr/0012-facilitator-architecture.md
 * @see docs/operating-a-facilitator/deployment.md
 */

export {
  DEFAULT_BALANCE_CACHE_MS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_REQUESTS_PER_WINDOW_PER_IP,
  DEFAULT_REQUESTS_PER_WINDOW_PER_KEY,
  DEFAULT_SPONSOR_FLOOR_XLM,
  type EnvRecord,
  FACILITATOR_ENV_PREFIX,
  type FacilitatorApiKey,
  type FacilitatorAuthConfig,
  type FacilitatorConfig,
  type FacilitatorConfigInput,
  type FacilitatorFeeConfig,
  type FacilitatorNetworkConfig,
  type FacilitatorNetworkConfigInput,
  type FacilitatorRateLimitConfig,
  facilitatorConfigFromEnv,
  NETWORK_ENV_INFIX,
  parseApiKeys,
  resolveFacilitatorConfig,
} from "./config.js";
export {
  constantTimeEquals,
  createFacilitator,
  type FacilitatorReadiness,
  type FacilitatorRequest,
  type FacilitatorResponse,
  type MovoFacilitator,
  type SignerPoolView,
} from "./facilitator.js";
export {
  ANONYMOUS_CALLER,
  type CallerMeter,
  type MeteredOperation,
  Metering,
} from "./metering.js";
export {
  DEFAULT_MAX_BUCKETS,
  type RateLimitDecision,
  RateLimiter,
  type RateLimiterOptions,
} from "./rate-limit.js";
export {
  TRANSPORT_REASON_MESSAGE,
  TRANSPORT_REASON_STATUS,
  TRANSPORT_REASON_VALUES,
  TRANSPORT_REASONS,
  type TransportReason,
} from "./reasons.js";
export {
  type BalanceReader,
  DEFAULT_ACQUIRE_TIMEOUT_MS,
  DEFAULT_MAX_IN_FLIGHT_PER_SIGNER,
  readNativeBalance,
  type SignerHealth,
  type SignerLease,
  SignerPool,
  type SignerPoolHealth,
  type SignerPoolOptions,
} from "./signer-pool.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
