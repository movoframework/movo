/**
 * The Movo error registry — every code, what it means, and how to fix it.
 *
 * Spec §1.5 P4: diagnostics are a feature, not logging. A code that exists only as a string
 * thrown from one call site is a log line with extra steps. A code in this registry has a
 * stated meaning, a fix template, a documentation page generated from this file, and a test
 * asserting the page and the registry cannot diverge.
 *
 * **Codes are permanent.** A code is never reused for a different meaning and never renamed;
 * it is deprecated and superseded, because CI configurations and support threads reference
 * them by string (spec §5.10).
 *
 * **Docs URLs are built here and nowhere else.** `DOCS_BASE_URL` is a single exported constant
 * (Spec Amendment 002 §4) so that acquiring a domain later is a one-line change rather than a
 * sweep across a registry holding dozens of codes. `docs-url-single-source.test.ts` fails if a
 * literal reappears anywhere else in the sources.
 */

/**
 * Base URL for error documentation.
 *
 * GitHub Pages under the organisation, deliberately: it is a URL that actually resolves. An
 * error message pointing at a 404 is worse than one pointing nowhere, because it spends the
 * reader's trust before it spends their time. If `movo.dev` or `movoframework.dev` is
 * acquired, this line changes and nothing else does.
 */
export const DOCS_BASE_URL = "https://movoframework.github.io/movo";

/** Whether a registry entry describes a hard failure or an advisory finding. */
export type MovoSeverity = "error" | "warning";

/** One row of the registry. */
export interface ErrorRegistryEntry {
  /** Stable, screaming-snake code. Equal to the key it is stored under. */
  readonly code: string;
  /** `error` codes are `MOVO_E_*` and throw; `warning` codes are `MOVO_W_*` and surface as findings. */
  readonly severity: MovoSeverity;
  /** One line: what has gone wrong, in the reader's terms. */
  readonly meaning: string;
  /** What to do about it. Concrete enough to act on without opening another page. */
  readonly fix: string;
}

/**
 * Every code Movo can raise at M1.
 *
 * Listed as a union rather than inferred from the object so that the registry can be given an
 * explicit mapped type — `isolatedDeclarations` requires one — while TypeScript still refuses
 * a registry that is missing a code or carries one that is not declared here. The two cannot
 * drift.
 */
export type MovoErrorCode =
  | "MOVO_E_NETWORK_UNSUPPORTED"
  | "MOVO_E_PAYTO_INVALID"
  | "MOVO_E_PAYTO_MISSING"
  | "MOVO_E_ENV_NETWORK_MISMATCH"
  | "MOVO_E_PUBNET_NOT_ENABLED"
  | "MOVO_E_SECRET_IN_CONFIG"
  | "MOVO_E_ENV_INVALID"
  | "MOVO_E_FACILITATOR_URL_INVALID"
  | "MOVO_E_TIMEOUT_INVALID"
  | "MOVO_E_PRICE_ASSET_ALIAS"
  | "MOVO_E_PRICE_INVALID"
  | "MOVO_E_PRICE_MISSING"
  | "MOVO_E_PATH_INVALID"
  | "MOVO_E_PATH_WILDCARD"
  | "MOVO_E_METHOD_INVALID"
  | "MOVO_E_HANDLER_INVALID"
  | "MOVO_E_MAX_TIMEOUT_INVALID"
  | "MOVO_E_ROUTE_DUPLICATE"
  | "MOVO_E_DISCOVERY_DISABLED"
  | "MOVO_E_APP_INVALID"
  | "MOVO_W_PARAM_UNDESCRIBED"
  | "MOVO_W_RESPONSE_NOT_STREAMED";

/** The registry itself. */
export const MOVO_ERROR_REGISTRY: { readonly [K in MovoErrorCode]: ErrorRegistryEntry } = {
  MOVO_E_NETWORK_UNSUPPORTED: {
    code: "MOVO_E_NETWORK_UNSUPPORTED",
    severity: "error",
    meaning: "The configured network is not a Stellar network that Movo settles on.",
    fix: 'Set network to "stellar:testnet" or "stellar:pubnet". These are CAIP-2 identifiers; "testnet", "stellar" and "stellar:mainnet" are not valid values.',
  },
  MOVO_E_PAYTO_INVALID: {
    code: "MOVO_E_PAYTO_INVALID",
    severity: "error",
    meaning: "payTo is not a valid Stellar destination address.",
    fix: "Use a Stellar account address (G…), contract address (C…) or muxed address (M…). Movo validates with validateStellarDestinationAddress from @x402/stellar; check for a truncated copy-paste or a stray whitespace character.",
  },
  MOVO_E_PAYTO_MISSING: {
    code: "MOVO_E_PAYTO_MISSING",
    severity: "error",
    meaning: "No payTo address is available for a resource, from the resource or from config.",
    fix: "Set payTo in movo.config.ts, or MOVO_PAY_TO in the environment, or on the resource itself. Without it there is no account to be paid.",
  },
  MOVO_E_ENV_NETWORK_MISMATCH: {
    code: "MOVO_E_ENV_NETWORK_MISMATCH",
    severity: "error",
    meaning: "env and network disagree about which Stellar network this project targets.",
    fix: 'Pair env "pubnet" with network "stellar:pubnet", and env "testnet" or "local" with network "stellar:testnet". Movo never coerces one to match the other, because guessing which one the author meant is guessing about real money.',
  },
  MOVO_E_PUBNET_NOT_ENABLED: {
    code: "MOVO_E_PUBNET_NOT_ENABLED",
    severity: "error",
    meaning: "env is pubnet but MOVO_ALLOW_PUBNET=1 is not set in the environment.",
    fix: "Set MOVO_ALLOW_PUBNET=1 in the process environment to confirm you intend to move real value. This friction is deliberate: it makes a mainnet run an explicit act rather than the result of one edited line.",
  },
  MOVO_E_SECRET_IN_CONFIG: {
    code: "MOVO_E_SECRET_IN_CONFIG",
    severity: "error",
    meaning: "A facilitator credential was supplied as a literal value in configuration.",
    fix: 'Supply facilitator.authHeaders as a function that reads the credential when it is needed, for example an async function returning { verify: { Authorization: "Bearer " + process.env.MOVO_FACILITATOR_API_KEY } }. A literal is rejected at definition time rather than risked in a log later.',
  },
  MOVO_E_ENV_INVALID: {
    code: "MOVO_E_ENV_INVALID",
    severity: "error",
    meaning: "env is not one of local, testnet or pubnet.",
    fix: 'Set env to "local", "testnet" or "pubnet", or set MOVO_ENV to one of those values.',
  },
  MOVO_E_FACILITATOR_URL_INVALID: {
    code: "MOVO_E_FACILITATOR_URL_INVALID",
    severity: "error",
    meaning: "The facilitator URL is not a parseable http or https URL.",
    fix: "Give facilitator.url an absolute http(s) URL, or set MOVO_FACILITATOR_URL. The default is the free keyless testnet facilitator at https://www.x402.org/facilitator.",
  },
  MOVO_E_TIMEOUT_INVALID: {
    code: "MOVO_E_TIMEOUT_INVALID",
    severity: "error",
    meaning: "facilitator.timeoutMs is not a positive, finite number of milliseconds.",
    fix: "Set facilitator.timeoutMs to a positive integer, for example 10000.",
  },
  MOVO_E_PRICE_ASSET_ALIAS: {
    code: "MOVO_E_PRICE_ASSET_ALIAS",
    severity: "error",
    meaning: "A price named an asset by ticker rather than by SEP-41 contract address.",
    fix: 'Stellar SEP-41 assets are contract addresses beginning with C, not tickers. Use getUsdcAddress(network) from @x402/stellar to obtain the USDC contract address for your network. Stellar USDC has 7 decimals, so 1 USDC is "10000000" base units.',
  },
  MOVO_E_PRICE_INVALID: {
    code: "MOVO_E_PRICE_INVALID",
    severity: "error",
    meaning: "A price is neither a $-prefixed money string nor a well-formed asset amount.",
    fix: 'Use a money string such as "$0.001", or an asset amount such as { asset: "C…", amount: "10000000" } where amount is in base units and is a string. Never compute base units yourself — convertToTokenAmount from @x402/stellar does it against the asset\'s real decimals.',
  },
  MOVO_E_PRICE_MISSING: {
    code: "MOVO_E_PRICE_MISSING",
    severity: "error",
    meaning: "No price is available for a resource, from the resource or from config defaults.",
    fix: "Set price on the resource, or defaults.price in movo.config.ts. A paid route with no price cannot produce payment requirements.",
  },
  MOVO_E_PATH_INVALID: {
    code: "MOVO_E_PATH_INVALID",
    severity: "error",
    meaning: "A resource path does not begin with / or is not a string.",
    fix: 'Write the path as an absolute Express-style path, for example "/weather/:city".',
  },
  MOVO_E_PATH_WILDCARD: {
    code: "MOVO_E_PATH_WILDCARD",
    severity: "error",
    meaning: "A resource path contains a wildcard segment.",
    fix: 'Replace the wildcard with a named parameter, for example "/files/:name" instead of "/files/*". A wildcard collapses distinct resources onto one Bazaar catalog key, so a buyer cannot tell them apart.',
  },
  MOVO_E_METHOD_INVALID: {
    code: "MOVO_E_METHOD_INVALID",
    severity: "error",
    meaning: "A resource declares an HTTP method Movo does not compile.",
    fix: "Use GET, POST, PUT, PATCH, DELETE or HEAD.",
  },
  MOVO_E_HANDLER_INVALID: {
    code: "MOVO_E_HANDLER_INVALID",
    severity: "error",
    meaning: "A resource has no handler function.",
    fix: "Give the resource a handler. Movo resources are plain data plus exactly one handler; there is no separate registration step that could supply it later.",
  },
  MOVO_E_MAX_TIMEOUT_INVALID: {
    code: "MOVO_E_MAX_TIMEOUT_INVALID",
    severity: "error",
    meaning: "maxTimeoutSeconds is not a positive, finite number of seconds.",
    fix: "Set maxTimeoutSeconds to a positive integer. It bounds how long a signed payment authorisation stays valid, so very large values widen the replay window and very small ones make slow clients fail.",
  },
  MOVO_E_ROUTE_DUPLICATE: {
    code: "MOVO_E_ROUTE_DUPLICATE",
    severity: "error",
    meaning: "Two resources compile to the same method and path.",
    fix: "Give the resources distinct paths, or remove the duplicate registration. Route keys are the identity of a paid resource, and silently keeping the last one would make which handler runs depend on array order.",
  },
  MOVO_E_DISCOVERY_DISABLED: {
    code: "MOVO_E_DISCOVERY_DISABLED",
    severity: "error",
    meaning: "A resource declares discovery metadata while discovery is disabled in config.",
    fix: "Either set discovery.enabled to true in movo.config.ts, or set discovery: false on the resource to state that it is deliberately not discoverable.",
  },
  MOVO_E_APP_INVALID: {
    code: "MOVO_E_APP_INVALID",
    severity: "error",
    meaning: "defineApp was given something other than an array of resources.",
    fix: "Pass { resources: [ … ] } with each entry produced by defineResource.",
  },
  MOVO_W_PARAM_UNDESCRIBED: {
    code: "MOVO_W_PARAM_UNDESCRIBED",
    severity: "warning",
    meaning: "An input schema field carries no description.",
    fix: 'Add .describe("…") to the field. An agent choosing whether to pay for this endpoint reads the parameter descriptions; an undescribed parameter is one it has to guess at.',
  },
  MOVO_W_RESPONSE_NOT_STREAMED: {
    code: "MOVO_W_RESPONSE_NOT_STREAMED",
    severity: "warning",
    meaning: "A paid route cannot stream its response.",
    fix: "Return a complete body rather than streaming. The upstream middleware buffers the entire response until settlement resolves, so chunked and SSE responses behind a paid route do not reach the buyer incrementally. See docs/concepts/payment-lifecycle.md.",
  },
};

/** Every code in the registry, in declaration order. */
export const MOVO_ERROR_CODES: readonly MovoErrorCode[] = Object.keys(
  MOVO_ERROR_REGISTRY,
) as MovoErrorCode[];

/**
 * The documentation URL for a code.
 *
 * @param code - A registry code
 * @returns The absolute docs URL, always built from {@link DOCS_BASE_URL}
 */
export function docsUrlFor(code: MovoErrorCode): string {
  return `${DOCS_BASE_URL}/errors/${code}`;
}

/**
 * Look up a registry entry.
 *
 * @param code - A registry code
 * @returns The entry for that code
 */
export function registryEntry(code: MovoErrorCode): ErrorRegistryEntry {
  return MOVO_ERROR_REGISTRY[code];
}
