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
  | "MOVO_E_DISCOVERY_SERVICE_NAME_INVALID"
  | "MOVO_E_DISCOVERY_TAGS_INVALID"
  | "MOVO_E_DISCOVERY_ICON_URL_INVALID"
  | "MOVO_E_DISCOVERY_ROUTE_TEMPLATE_INVALID"
  | "MOVO_E_DISCOVERY_EXTENSION_INVALID"
  | "MOVO_E_BUDGET_EXCEEDED"
  | "MOVO_E_BUDGET_PAYTO_NOT_ALLOWED"
  | "MOVO_E_BUDGET_NETWORK_NOT_ALLOWED"
  | "MOVO_W_PARAM_UNDESCRIBED"
  | "MOVO_W_DISCOVERY_SCHEMA_UNDERIVED"
  | "MOVO_W_RESPONSE_NOT_STREAMED"
  | "MOVO_W_NODE_VERSION_UNSUPPORTED"
  | "MOVO_W_X402_PIN_DRIFT"
  | "MOVO_E_FACILITATOR_PUBNET_REFUSED"
  | "MOVO_E_FACILITATOR_CONFIG_INVALID"
  | "MOVO_E_FACILITATOR_SIGNER_UNAVAILABLE"
  | "MOVO_E_MCP_BUDGET_REQUIRED"
  | "MOVO_E_MCP_INPUT_INVALID"
  | "MOVO_E_MCP_LISTING_NOT_FOUND"
  | "MOVO_E_MCP_NO_ACCEPTABLE_OFFER"
  | "MOVO_E_MCP_CALL_FAILED"
  | "MOVO_E_MCP_SETTLE_FAILED";

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
  MOVO_E_DISCOVERY_SERVICE_NAME_INVALID: {
    code: "MOVO_E_DISCOVERY_SERVICE_NAME_INVALID",
    severity: "error",
    meaning:
      "serviceName would be silently dropped from the Bazaar declaration by upstream validation.",
    fix: "Use at most 32 printable ASCII characters (U+0020–U+007E). Upstream drops an invalid serviceName without complaint at runtime, so your listing would appear unnamed and you would not be told why — which is why Movo raises it here instead.",
  },
  MOVO_E_DISCOVERY_TAGS_INVALID: {
    code: "MOVO_E_DISCOVERY_TAGS_INVALID",
    severity: "error",
    meaning: "One or more tags would be silently dropped by upstream validation.",
    fix: "Use at most 5 tags, each at most 32 printable ASCII characters. Upstream truncates and drops silently, so a tag you rely on for discovery can vanish without any signal.",
  },
  MOVO_E_DISCOVERY_ICON_URL_INVALID: {
    code: "MOVO_E_DISCOVERY_ICON_URL_INVALID",
    severity: "error",
    meaning: "iconUrl would be silently dropped by upstream validation.",
    fix: "Use an absolute https URL with a public hostname. Loopback addresses, private IP ranges and IP literals are rejected as an SSRF control — a catalog fetches this URL, so it must not point at anything inside your network.",
  },
  MOVO_E_DISCOVERY_ROUTE_TEMPLATE_INVALID: {
    code: "MOVO_E_DISCOVERY_ROUTE_TEMPLATE_INVALID",
    severity: "error",
    meaning: "The resource path is not a valid Bazaar route template.",
    fix: "Use an absolute path with :name parameters and no traversal segments. This is the catalog key a buyer finds your resource under; if it is invalid the resource cannot be catalogued at all.",
  },
  MOVO_E_DISCOVERY_EXTENSION_INVALID: {
    code: "MOVO_E_DISCOVERY_EXTENSION_INVALID",
    severity: "error",
    meaning: "The derived Bazaar declaration failed upstream specification validation.",
    fix: "Read the accompanying detail — it carries upstream's own error text verbatim. The declaration is derived from your resource, so the fix is usually in the resource's discovery block, input schema or method.",
  },
  MOVO_E_BUDGET_EXCEEDED: {
    code: "MOVO_E_BUDGET_EXCEEDED",
    severity: "error",
    meaning: "A payment offer exceeds the configured budget and was refused before signing.",
    fix: "Raise maxAmountPerRequest or maxTotalSpend if the offer is legitimate. A hostile server can name any amount in a 402, so this refusal is a security control rather than a convenience — no signature was produced.",
  },
  MOVO_E_BUDGET_PAYTO_NOT_ALLOWED: {
    code: "MOVO_E_BUDGET_PAYTO_NOT_ALLOWED",
    severity: "error",
    meaning:
      "A payment offer names a payTo address outside the allowed list; refused before signing.",
    fix: "Add the address to allowedPayTo if you intend to pay it. A server can name any recipient in a 402, and the buyer is the only party able to refuse.",
  },
  MOVO_E_BUDGET_NETWORK_NOT_ALLOWED: {
    code: "MOVO_E_BUDGET_NETWORK_NOT_ALLOWED",
    severity: "error",
    meaning: "A payment offer names a network outside the allowed list; refused before signing.",
    fix: "Add the network to allowedNetworks if you intend to settle there. This is what stops a testnet-only buyer being talked onto mainnet by a 402.",
  },
  MOVO_W_DISCOVERY_SCHEMA_UNDERIVED: {
    code: "MOVO_W_DISCOVERY_SCHEMA_UNDERIVED",
    severity: "warning",
    meaning:
      "An input schema could not be converted to JSON Schema, so the declaration carries none.",
    fix: "Pass an explicit inputSchema in the resource's discovery block. Standard Schema describes validation but not JSON Schema conversion, so Movo can only derive automatically for vendors that expose a converter — currently Zod. An agent reading your listing has no parameter documentation without it.",
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
  MOVO_E_FACILITATOR_PUBNET_REFUSED: {
    code: "MOVO_E_FACILITATOR_PUBNET_REFUSED",
    severity: "error",
    // Distinct from MOVO_E_PUBNET_NOT_ENABLED on purpose. That code means "you have not
    // confirmed you intend mainnet", and its fix is to set MOVO_ALLOW_PUBNET=1. This one fires
    // *after* that confirmation, and setting the variable again does nothing — reusing the code
    // here would hand the reader a remedy they have already applied, which is worse than no
    // remedy at all.
    meaning:
      "The in-process development facilitator was asked to run against stellar:pubnet, which it refuses regardless of MOVO_ALLOW_PUBNET.",
    fix: "Run `movo dev` against a real facilitator instead — omit --facilitator, or pass --facilitator config. The in-process facilitator signs and submits real transactions itself, so on mainnet it would move real funds from a development command; MOVO_ALLOW_PUBNET does not unlock it, because no development scenario wants it.",
  },
  MOVO_W_NODE_VERSION_UNSUPPORTED: {
    code: "MOVO_W_NODE_VERSION_UNSUPPORTED",
    severity: "warning",
    meaning: "The running Node.js version is below the minimum Movo is tested against.",
    fix: "Upgrade to Node 22 or later. Movo's CI matrix covers 22, 24 and 26; older releases are untested and Node's native TypeScript stripping — which the scaffolded project relies on to run src/server.ts directly — is unavailable before 22.",
  },
  MOVO_W_X402_PIN_DRIFT: {
    code: "MOVO_W_X402_PIN_DRIFT",
    severity: "warning",
    meaning: "An installed @x402/* version differs from the one recorded in docs/COMPATIBILITY.md.",
    fix: "Either regenerate the matrix with `pnpm generate:compat` after deliberately bumping the pin, or reinstall to match it. @x402/* versions are exact-pinned (spec §1.13) because upstream ships roughly weekly with `~`-tight cross-package pins: a drifted install is running against a protocol surface no conformance run has covered.",
  },
  // ─── SCF track: the facilitator service (M6) ───────────────────────────────────────────
  //
  // These live in the one MOVO_E_* registry rather than a MOVO_FAC_E_* namespace of their own,
  // for the reason spec v2 §A.1 gives for refusing a BAZAAR_E_* namespace: a second registry
  // means a second docs generator, a second lookup table, and a code whose prefix tells the
  // reader which package threw rather than what went wrong.
  MOVO_E_FACILITATOR_CONFIG_INVALID: {
    code: "MOVO_E_FACILITATOR_CONFIG_INVALID",
    severity: "error",
    meaning: "The facilitator service configuration cannot be served as written.",
    fix: "Read the message: it names the specific field. The usual causes are an empty MOVO_FACILITATOR_<NET>_SIGNER_SEEDS (a facilitator with no sponsor can verify but never settle), stellar:pubnet configured without an explicit Soroban RPC URL (there is no public mainnet default), or bearer auth enabled with no keys, which would reject every request. See docs/operating-a-facilitator/deployment.md.",
  },
  MOVO_E_FACILITATOR_SIGNER_UNAVAILABLE: {
    code: "MOVO_E_FACILITATOR_SIGNER_UNAVAILABLE",
    severity: "error",
    meaning: "No sponsoring signer was available to settle a payment.",
    fix: "Check /ready. Either every signer in the pool is below its XLM floor — top them up, see docs/operating-a-facilitator/runbook.md — or the requested network has no pool configured at all, which is a configuration error rather than an operational one.",
  },

  // The MCP discovery server's agent-facing codes. They are here, in the one registry, rather
  // than in a `MCP_E_*` namespace of their own — §A's ruling against `BAZAAR_E_*` applies for
  // the same reason: a code prefix that names the package a failure came from tells the reader
  // where the throw is, which they did not ask, instead of what went wrong, which they did.
  //
  // A budget refusal is deliberately NOT among them. It reports the buyer-side
  // `MOVO_E_BUDGET_*` code verbatim, because "the call was refused" is less useful to an agent
  // than "the offer exceeded the per-request cap", and wrapping the real code in an MCP-shaped
  // one would lose exactly the distinction the agent needs to decide what to do next.
  MOVO_E_MCP_BUDGET_REQUIRED: {
    code: "MOVO_E_MCP_BUDGET_REQUIRED",
    severity: "error",
    meaning: "An MCP discovery server was constructed without a budget for bazaar.paidCall.",
    fix: "Pass buyer.budget to createMcpDiscoveryServer. bazaar.paidCall hands an autonomous agent the ability to spend from a wallet, and a spend cap is the only thing standing between a bad plan and an empty account — so it is required rather than defaulted. Set maxAmountPerRequest and maxTotalSpend, and allowedPayTo if you know who you intend to pay.",
  },
  MOVO_E_MCP_INPUT_INVALID: {
    code: "MOVO_E_MCP_INPUT_INVALID",
    severity: "error",
    meaning: "An MCP tool was called with arguments it cannot act on.",
    fix: "Read the reason — it names the field. The usual causes are supplying neither `id` nor `url` to bazaar.paidCall, supplying both, or a url that is not absolute http(s).",
  },
  MOVO_E_MCP_LISTING_NOT_FOUND: {
    code: "MOVO_E_MCP_LISTING_NOT_FOUND",
    severity: "error",
    meaning: "No catalog listing matches the identifier bazaar.get or bazaar.paidCall was given.",
    fix: "Use an `id` returned by bazaar.search, or the exact (resource, toolName) tuple an MCP listing was catalogued under. A catalog only holds resources that have been paid for at least once through this facilitator, so an endpoint that has never settled here is absent rather than hidden.",
  },
  MOVO_E_MCP_NO_ACCEPTABLE_OFFER: {
    code: "MOVO_E_MCP_NO_ACCEPTABLE_OFFER",
    severity: "error",
    meaning:
      "A paid call ended at 402: the server's offers were not refused by the budget, but none could be paid.",
    fix: "The server advertised no offer this buyer can settle — usually a different network or a scheme this client has no signer for. Check the resource's `accepts` in the catalog listing against the network the client was constructed with. No payment was created.",
  },
  MOVO_E_MCP_CALL_FAILED: {
    code: "MOVO_E_MCP_CALL_FAILED",
    severity: "error",
    meaning: "A paid call reached the resource but the resource did not return a success status.",
    fix: "Read the reason for the status and body. A paid route that returns 4xx costs the buyer nothing — upstream cancels settlement on status >= 400 — so this is a failed call rather than a lost payment.",
  },
  MOVO_E_MCP_SETTLE_FAILED: {
    code: "MOVO_E_MCP_SETTLE_FAILED",
    severity: "error",
    meaning: "A payment was created and submitted for a paid call, but settlement did not succeed.",
    fix: "Read the reason for the facilitator's own text. The buyer's output is withheld when settlement fails, so there is nothing to retry against — re-issue the call. Repeated failures against one resource are worth reporting with bazaar.get's listing id.",
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
