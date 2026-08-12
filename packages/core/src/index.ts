/**
 * `@movoframework/core` — the configuration system, the resource model, the compiler, the
 * error registry, redaction, and the x402 protocol narrow waist.
 *
 * Everything here is pure. Nothing in this package performs network or filesystem I/O, which
 * is what allows `movo doctor` to analyse a project statically and keeps the unit suite
 * hermetic (spec §10, M1).
 *
 * The protocol types below are re-exported from `./protocol/index.js`, the single directory
 * permitted to import `@x402/*`. They keep their upstream names: `PaymentRequirements` is
 * `PaymentRequirements`, not a Movo synonym for it. A parallel vocabulary for identical wire
 * objects is what ADR-0001 and ADR-0004 exist to prevent.
 */

// ─── Identity ────────────────────────────────────────────────────────────────────────────

export {
  MOVO_ENV_PREFIX,
  MOVO_PRODUCT_NAME,
  MOVO_SCOPE,
  movoPackageName,
  UNSCOPED_PACKAGE_DIRECTORIES,
} from "./identity.js";

// ─── Configuration ───────────────────────────────────────────────────────────────────────

export { defineConfig } from "./config/defineConfig.js";
export {
  ALLOW_PUBNET_ENV_VAR,
  type ConfigLayers,
  type ConfigSource,
  configFromEnv,
  DEFAULT_FACILITATOR_TIMEOUT_MS,
  DEFAULT_FACILITATOR_URL,
  DEFAULT_MAX_TIMEOUT_SECONDS,
  type EnvRecord,
  type Resolved,
  type ResolvedConfig,
  type ResourceConfigOverride,
  resolveConfig,
} from "./config/resolve.js";
export {
  type AuthHeadersProvider,
  type DefaultsConfig,
  type DiscoveryConfig,
  type FacilitatorConfig,
  MOVO_ENVS,
  type MovoConfig,
  type MovoConfigInput,
  type MovoEnv,
  type StellarConfig,
} from "./config/schema.js";

// ─── Resource model and compilation ──────────────────────────────────────────────────────

export {
  type CompiledApp,
  type CompiledHandler,
  compileApp,
  routeKeyFor,
} from "./resource/compile.js";
export { defineApp, type MovoAppInit } from "./resource/defineApp.js";
export { defineResource, type MovoResourceInit } from "./resource/defineResource.js";
export { validatePrice } from "./resource/price.js";
export {
  type InferOutput,
  isStandardSchema,
  type StandardSchemaIssue,
  type StandardSchemaResult,
  type StandardSchemaV1,
} from "./resource/standard-schema.js";
export {
  type AnyMovoResource,
  type DiscoveryDeclaration,
  HTTP_METHODS,
  type HttpMethod,
  isAssetAmount,
  type MoneyString,
  type MovoApp,
  type MovoPaymentContext,
  type MovoPrice,
  type MovoRequestContext,
  type MovoResource,
} from "./resource/types.js";

// ─── Errors and diagnostics ──────────────────────────────────────────────────────────────

export { type Finding, type FindingLevel, findingFromCode } from "./diagnostics.js";
export {
  isMovoError,
  MovoError,
  type MovoErrorOptions,
  type SerializedMovoError,
} from "./errors/MovoError.js";
export {
  DOCS_BASE_URL,
  docsUrlFor,
  type ErrorRegistryEntry,
  MOVO_ERROR_CODES,
  MOVO_ERROR_REGISTRY,
  type MovoErrorCode,
  type MovoSeverity,
  registryEntry,
} from "./errors/registry.js";

// ─── Observability ───────────────────────────────────────────────────────────────────────

export { newCorrelationId } from "./observability/correlation.js";
export {
  createLogger,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogRecord,
  type LogSink,
  parseLogLevel,
} from "./observability/logger.js";
export {
  isSensitiveKey,
  REDACTED,
  REDACTED_PAYMENT_PAYLOAD,
  REDACTED_STELLAR_SECRET,
  redact,
  redactRecord,
  redactText,
} from "./observability/redact.js";

// ─── Hooks ───────────────────────────────────────────────────────────────────────────────

export {
  createHookDispatcher,
  type FailureContext,
  type HookContext,
  type HookDispatcher,
  type MovoHooks,
  type SettledContext,
} from "./hooks.js";

// ─── The protocol narrow waist ───────────────────────────────────────────────────────────
//
// Re-exported so that no other Movo package — and no consumer who prefers not to add a second
// dependency — needs to import `@x402/*` directly. A consumer who wants an unaliased upstream
// type is free to import it from `@x402/core` themselves; that is correct, and documented.

export type {
  AssetAmount,
  FacilitatorClient,
  Money,
  MoneyParser,
  Network,
  PaymentOption,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  Price,
  ResourceInfo,
  RouteConfig,
  RoutesConfig,
  RpcConfig,
  SchemeNetworkServer,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
  VerifyResponse,
} from "./protocol/index.js";
export {
  checkIfBazaarNeeded,
  convertToTokenAmount,
  DEFAULT_ESTIMATED_LEDGER_SECONDS,
  DEFAULT_TOKEN_DECIMALS,
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  EXACT_SCHEME,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  encodePaymentSignatureHeader,
  getEstimatedLedgerCloseTimeSeconds,
  getHorizonClient,
  getNetworkPassphrase,
  getRpcClient,
  getRpcUrl,
  getUsdcAddress,
  isStellarNetwork,
  PAYMENT_HEADERS,
  STELLAR_NETWORK_TO_PASSPHRASE,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  USDC_PUBNET_ADDRESS,
  USDC_TESTNET_ADDRESS,
  validateStellarAssetAddress,
  validateStellarDestinationAddress,
} from "./protocol/index.js";

/** The published version of this package. */
export const VERSION: string = "0.0.0";
