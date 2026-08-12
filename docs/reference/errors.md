# Error reference

<!-- GENERATED FILE — DO NOT EDIT BY HAND. Regenerate with `pnpm generate:errors`. -->

Every failure Movo raises carries a stable code, a one-line meaning and a fix. Codes are
permanent: a code is never reused for a different meaning and never renamed, because CI
configurations and support threads reference them by string. A code that is withdrawn is
marked deprecated and superseded, not deleted.

Each code resolves to `https://movoframework.github.io/movo/errors/<CODE>`.

## Errors

| Code | Meaning | Fix |
|---|---|---|
| [`MOVO_E_NETWORK_UNSUPPORTED`](https://movoframework.github.io/movo/errors/MOVO_E_NETWORK_UNSUPPORTED) | The configured network is not a Stellar network that Movo settles on. | Set network to "stellar:testnet" or "stellar:pubnet". These are CAIP-2 identifiers; "testnet", "stellar" and "stellar:mainnet" are not valid values. |
| [`MOVO_E_PAYTO_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_PAYTO_INVALID) | payTo is not a valid Stellar destination address. | Use a Stellar account address (G…), contract address (C…) or muxed address (M…). Movo validates with validateStellarDestinationAddress from @x402/stellar; check for a truncated copy-paste or a stray whitespace character. |
| [`MOVO_E_PAYTO_MISSING`](https://movoframework.github.io/movo/errors/MOVO_E_PAYTO_MISSING) | No payTo address is available for a resource, from the resource or from config. | Set payTo in movo.config.ts, or MOVO_PAY_TO in the environment, or on the resource itself. Without it there is no account to be paid. |
| [`MOVO_E_ENV_NETWORK_MISMATCH`](https://movoframework.github.io/movo/errors/MOVO_E_ENV_NETWORK_MISMATCH) | env and network disagree about which Stellar network this project targets. | Pair env "pubnet" with network "stellar:pubnet", and env "testnet" or "local" with network "stellar:testnet". Movo never coerces one to match the other, because guessing which one the author meant is guessing about real money. |
| [`MOVO_E_PUBNET_NOT_ENABLED`](https://movoframework.github.io/movo/errors/MOVO_E_PUBNET_NOT_ENABLED) | env is pubnet but MOVO_ALLOW_PUBNET=1 is not set in the environment. | Set MOVO_ALLOW_PUBNET=1 in the process environment to confirm you intend to move real value. This friction is deliberate: it makes a mainnet run an explicit act rather than the result of one edited line. |
| [`MOVO_E_SECRET_IN_CONFIG`](https://movoframework.github.io/movo/errors/MOVO_E_SECRET_IN_CONFIG) | A facilitator credential was supplied as a literal value in configuration. | Supply facilitator.authHeaders as a function that reads the credential when it is needed, for example an async function returning { verify: { Authorization: "Bearer " + process.env.MOVO_FACILITATOR_API_KEY } }. A literal is rejected at definition time rather than risked in a log later. |
| [`MOVO_E_ENV_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_ENV_INVALID) | env is not one of local, testnet or pubnet. | Set env to "local", "testnet" or "pubnet", or set MOVO_ENV to one of those values. |
| [`MOVO_E_FACILITATOR_URL_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_FACILITATOR_URL_INVALID) | The facilitator URL is not a parseable http or https URL. | Give facilitator.url an absolute http(s) URL, or set MOVO_FACILITATOR_URL. The default is the free keyless testnet facilitator at https://www.x402.org/facilitator. |
| [`MOVO_E_TIMEOUT_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_TIMEOUT_INVALID) | facilitator.timeoutMs is not a positive, finite number of milliseconds. | Set facilitator.timeoutMs to a positive integer, for example 10000. |
| [`MOVO_E_PRICE_ASSET_ALIAS`](https://movoframework.github.io/movo/errors/MOVO_E_PRICE_ASSET_ALIAS) | A price named an asset by ticker rather than by SEP-41 contract address. | Stellar SEP-41 assets are contract addresses beginning with C, not tickers. Use getUsdcAddress(network) from @x402/stellar to obtain the USDC contract address for your network. Stellar USDC has 7 decimals, so 1 USDC is "10000000" base units. |
| [`MOVO_E_PRICE_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_PRICE_INVALID) | A price is neither a $-prefixed money string nor a well-formed asset amount. | Use a money string such as "$0.001", or an asset amount such as { asset: "C…", amount: "10000000" } where amount is in base units and is a string. Never compute base units yourself — convertToTokenAmount from @x402/stellar does it against the asset's real decimals. |
| [`MOVO_E_PRICE_MISSING`](https://movoframework.github.io/movo/errors/MOVO_E_PRICE_MISSING) | No price is available for a resource, from the resource or from config defaults. | Set price on the resource, or defaults.price in movo.config.ts. A paid route with no price cannot produce payment requirements. |
| [`MOVO_E_PATH_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_PATH_INVALID) | A resource path does not begin with / or is not a string. | Write the path as an absolute Express-style path, for example "/weather/:city". |
| [`MOVO_E_PATH_WILDCARD`](https://movoframework.github.io/movo/errors/MOVO_E_PATH_WILDCARD) | A resource path contains a wildcard segment. | Replace the wildcard with a named parameter, for example "/files/:name" instead of "/files/*". A wildcard collapses distinct resources onto one Bazaar catalog key, so a buyer cannot tell them apart. |
| [`MOVO_E_METHOD_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_METHOD_INVALID) | A resource declares an HTTP method Movo does not compile. | Use GET, POST, PUT, PATCH, DELETE or HEAD. |
| [`MOVO_E_HANDLER_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_HANDLER_INVALID) | A resource has no handler function. | Give the resource a handler. Movo resources are plain data plus exactly one handler; there is no separate registration step that could supply it later. |
| [`MOVO_E_MAX_TIMEOUT_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_MAX_TIMEOUT_INVALID) | maxTimeoutSeconds is not a positive, finite number of seconds. | Set maxTimeoutSeconds to a positive integer. It bounds how long a signed payment authorisation stays valid, so very large values widen the replay window and very small ones make slow clients fail. |
| [`MOVO_E_ROUTE_DUPLICATE`](https://movoframework.github.io/movo/errors/MOVO_E_ROUTE_DUPLICATE) | Two resources compile to the same method and path. | Give the resources distinct paths, or remove the duplicate registration. Route keys are the identity of a paid resource, and silently keeping the last one would make which handler runs depend on array order. |
| [`MOVO_E_DISCOVERY_DISABLED`](https://movoframework.github.io/movo/errors/MOVO_E_DISCOVERY_DISABLED) | A resource declares discovery metadata while discovery is disabled in config. | Either set discovery.enabled to true in movo.config.ts, or set discovery: false on the resource to state that it is deliberately not discoverable. |
| [`MOVO_E_APP_INVALID`](https://movoframework.github.io/movo/errors/MOVO_E_APP_INVALID) | defineApp was given something other than an array of resources. | Pass { resources: [ … ] } with each entry produced by defineResource. |

## Warnings

Warnings surface as `Finding`s rather than exceptions. Whether a warning fails a build is
policy, and policy belongs to the caller — `movo doctor --fail-on warn` is a flag for
exactly that reason.

| Code | Meaning | Fix |
|---|---|---|
| [`MOVO_W_PARAM_UNDESCRIBED`](https://movoframework.github.io/movo/errors/MOVO_W_PARAM_UNDESCRIBED) | An input schema field carries no description. | Add .describe("…") to the field. An agent choosing whether to pay for this endpoint reads the parameter descriptions; an undescribed parameter is one it has to guess at. |
| [`MOVO_W_RESPONSE_NOT_STREAMED`](https://movoframework.github.io/movo/errors/MOVO_W_RESPONSE_NOT_STREAMED) | A paid route cannot stream its response. | Return a complete body rather than streaming. The upstream middleware buffers the entire response until settlement resolves, so chunked and SSE responses behind a paid route do not reach the buyer incrementally. See docs/concepts/payment-lifecycle.md. |
