/**
 * Configuration resolution with provenance.
 *
 * Five layers, lowest precedence first:
 *
 * | Layer      | Where it comes from                                    |
 * |------------|--------------------------------------------------------|
 * | `default`  | the built-in defaults in this file                     |
 * | `config`   | `movo.config.ts`                                       |
 * | `env`      | `MOVO_*` environment variables                         |
 * | `resource` | a per-resource override on a `defineResource` call     |
 * | `argument` | an explicit argument at the call site                  |
 *
 * **Provenance is not decoration.** Every resolved value carries where it came from, because
 * `movo doctor` prints it and that printout is a headline feature. The single most common
 * support conversation in a configurable payment tool is "it is using the wrong `payTo`" —
 * where the answer is always that some layer nobody was thinking about supplied it. Recording
 * the source at resolution time turns that conversation into one line of output.
 *
 * **The signature deviates from spec §5.1, deliberately.** The spec sketches
 * `resolveConfig(input?: Partial<MovoConfig>)`. A single partial cannot express five layers,
 * and AC1.5 requires asserting the source of a value set in each of them. Discriminating a
 * `Partial<MovoConfig>` from a layered object at runtime is not safely possible either — both
 * are objects of optional keys, and both have a key named `env` meaning entirely different
 * things. Guessing wrong would silently misread a configuration in a money path, so the
 * function takes one unambiguous shape instead. See ADR-0006.
 */

import { MovoError } from "../errors/MovoError.js";
import {
  isStellarNetwork,
  type Network,
  type Price,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
  validateStellarDestinationAddress,
} from "../protocol/index.js";
import {
  type AuthHeadersProvider,
  type MovoConfigInput,
  type MovoEnv,
  validateConfigInput,
} from "./schema.js";

/** Where a resolved value came from. */
export type ConfigSource = "default" | "config" | "env" | "resource" | "argument";

/** A value together with the layer that supplied it. */
export interface Resolved<T> {
  readonly value: T;
  readonly source: ConfigSource;
}

/** The subset of configuration a single resource may override. */
export interface ResourceConfigOverride {
  readonly network?: Network;
  readonly payTo?: string;
  readonly price?: Price;
  readonly maxTimeoutSeconds?: number;
}

/** A read-only view of environment variables. Injected so resolution stays testable. */
export type EnvRecord = Readonly<Record<string, string | undefined>>;

/** The five inputs to resolution. Every one optional. */
export interface ConfigLayers {
  /** `movo.config.ts`. */
  readonly config?: MovoConfigInput;
  /** Environment variables. Defaults to `process.env`. */
  readonly env?: EnvRecord;
  /** A per-resource override. */
  readonly resource?: ResourceConfigOverride;
  /** An explicit call-site argument — the highest precedence. */
  readonly argument?: MovoConfigInput;
}

/** The resolved configuration: the shape of `MovoConfig`, with provenance at every leaf. */
export interface ResolvedConfig {
  readonly env: Resolved<MovoEnv>;
  readonly network: Resolved<Network>;
  readonly payTo: Resolved<string | undefined>;
  readonly facilitator: {
    readonly url: Resolved<string>;
    readonly authHeaders: Resolved<AuthHeadersProvider | undefined>;
    readonly timeoutMs: Resolved<number>;
  };
  readonly defaults: {
    readonly price: Resolved<Price | undefined>;
    readonly maxTimeoutSeconds: Resolved<number>;
  };
  readonly discovery: {
    readonly enabled: Resolved<boolean>;
    readonly serviceName: Resolved<string | undefined>;
    readonly tags: Resolved<readonly string[] | undefined>;
    readonly iconUrl: Resolved<string | undefined>;
  };
  readonly stellar: {
    readonly rpcUrl: Resolved<string | undefined>;
  };
}

/**
 * The free, keyless facilitator that supports `stellar:testnet`.
 *
 * A default rather than a required setting because requiring it would put a URL in every
 * quickstart before the reader has any way to judge which URL is correct.
 */
export const DEFAULT_FACILITATOR_URL = "https://www.x402.org/facilitator";

/** Default facilitator request timeout. */
export const DEFAULT_FACILITATOR_TIMEOUT_MS = 10_000;

/** Default payment authorisation validity window. */
export const DEFAULT_MAX_TIMEOUT_SECONDS = 60;

/** Environment variable enabling `env: "pubnet"`. Deliberate friction (spec §5.13). */
export const ALLOW_PUBNET_ENV_VAR = "MOVO_ALLOW_PUBNET";

/** One candidate value from one layer. */
type Candidate<T> = readonly [ConfigSource, T | undefined];

/**
 * Take the highest-precedence defined candidate, or the default.
 *
 * `undefined` means "this layer said nothing", never "this layer said no". That distinction is
 * why a layer cannot un-set a lower layer's value: allowing it would make the precedence order
 * depend on whether a key was written as absent or as explicitly undefined, which is invisible
 * in a config file.
 *
 * @param fallback - The built-in default
 * @param candidates - Layer candidates, lowest precedence first
 * @returns The winning value with its provenance
 */
function pick<T>(fallback: T, ...candidates: readonly Candidate<T>[]): Resolved<T> {
  let winner: Resolved<T> = { value: fallback, source: "default" };
  for (const [source, value] of candidates) {
    if (value !== undefined) winner = { value, source };
  }
  return winner;
}

/**
 * Build a configuration input from environment variables.
 *
 * `MOVO_FACILITATOR_API_KEY` is deliberately not read here. It is read only inside an
 * `authHeaders` provider at the moment a request needs it, so it never lands on the
 * configuration object and cannot be reached by anything that walks it (spec §5.13).
 *
 * @param env - Environment variables
 * @returns The environment layer as a configuration input
 */
export function configFromEnv(env: EnvRecord): MovoConfigInput {
  const input: {
    env?: MovoEnv;
    network?: Network;
    payTo?: string;
    facilitator?: { url?: string };
    stellar?: { rpcUrl?: string };
  } = {};

  const rawEnv = env["MOVO_ENV"];
  // Cast, then validate: `validateConfigInput` rejects anything outside the three environments
  // with MOVO_E_ENV_INVALID, so an unchecked value cannot survive resolution.
  if (rawEnv !== undefined) input.env = rawEnv as MovoEnv;

  const rawNetwork = env["MOVO_NETWORK"];
  if (rawNetwork !== undefined) input.network = rawNetwork as Network;

  const payTo = env["MOVO_PAY_TO"];
  if (payTo !== undefined) input.payTo = payTo;

  const facilitatorUrl = env["MOVO_FACILITATOR_URL"];
  if (facilitatorUrl !== undefined) input.facilitator = { url: facilitatorUrl };

  const rpcUrl = env["MOVO_STELLAR_RPC_URL"];
  if (rpcUrl !== undefined) input.stellar = { rpcUrl };

  return input;
}

function assertPubnetEnabled(env: Resolved<MovoEnv>, environment: EnvRecord): void {
  if (env.value !== "pubnet") return;
  if (environment[ALLOW_PUBNET_ENV_VAR] === "1") return;

  throw new MovoError(
    "MOVO_E_PUBNET_NOT_ENABLED",
    `env is "pubnet" (from the ${env.source} layer) but ${ALLOW_PUBNET_ENV_VAR}=1 is not set. ` +
      "Set it to confirm you intend to move real value on the public network.",
    { context: { env: env.value, envSource: env.source } },
  );
}

function assertNetworkSupported(network: Resolved<Network>): void {
  // `isStellarNetwork` is upstream's definition of the family; the equality check then pins it
  // to a concrete network, because the wildcard `stellar:*` passes the family test and is not
  // something a resource server can be configured with.
  const supported =
    isStellarNetwork(network.value) &&
    (network.value === STELLAR_TESTNET_CAIP2 || network.value === STELLAR_PUBNET_CAIP2);
  if (supported) return;

  throw new MovoError(
    "MOVO_E_NETWORK_UNSUPPORTED",
    `network ${JSON.stringify(network.value)} (from the ${network.source} layer) is not a Stellar network Movo settles on. ` +
      `Use ${JSON.stringify(STELLAR_TESTNET_CAIP2)} or ${JSON.stringify(STELLAR_PUBNET_CAIP2)}.`,
    {
      context: {
        network: network.value,
        networkSource: network.source,
        supported: [STELLAR_TESTNET_CAIP2, STELLAR_PUBNET_CAIP2],
      },
    },
  );
}

function assertEnvNetworkAgreement(env: Resolved<MovoEnv>, network: Resolved<Network>): void {
  const expected: Network = env.value === "pubnet" ? STELLAR_PUBNET_CAIP2 : STELLAR_TESTNET_CAIP2;
  if (network.value === expected) return;

  throw new MovoError(
    "MOVO_E_ENV_NETWORK_MISMATCH",
    `env ${JSON.stringify(env.value)} (from the ${env.source} layer) requires network ${JSON.stringify(expected)}, ` +
      `but network is ${JSON.stringify(network.value)} (from the ${network.source} layer). Movo never coerces one to match the other.`,
    {
      context: {
        env: env.value,
        envSource: env.source,
        network: network.value,
        networkSource: network.source,
        expectedNetwork: expected,
      },
    },
  );
}

function assertPayToValid(payTo: Resolved<string | undefined>): void {
  if (payTo.value === undefined) return;
  if (validateStellarDestinationAddress(payTo.value)) return;

  throw new MovoError(
    "MOVO_E_PAYTO_INVALID",
    `payTo (from the ${payTo.source} layer) is not a valid Stellar destination address.`,
    { context: { payToSource: payTo.source, payToLength: payTo.value.length } },
  );
}

function assertFacilitatorUrlValid(url: Resolved<string>): void {
  let parsed: URL;
  try {
    parsed = new URL(url.value);
  } catch {
    throw new MovoError(
      "MOVO_E_FACILITATOR_URL_INVALID",
      `facilitator.url ${JSON.stringify(url.value)} (from the ${url.source} layer) is not a parseable URL.`,
      { context: { url: url.value, urlSource: url.source } },
    );
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") return;

  throw new MovoError(
    "MOVO_E_FACILITATOR_URL_INVALID",
    `facilitator.url ${JSON.stringify(url.value)} (from the ${url.source} layer) must use http or https, not ${parsed.protocol}.`,
    { context: { url: url.value, urlSource: url.source, protocol: parsed.protocol } },
  );
}

/**
 * Resolve configuration across all five layers, with provenance and eager validation.
 *
 * Every validation failure throws here rather than at request time. A payment server that
 * starts with an invalid `payTo` and only discovers it when a buyer tries to pay has converted
 * a startup error into a customer-facing one.
 *
 * @param layers - The five input layers; all optional
 * @returns The resolved configuration, every leaf carrying its source
 */
export function resolveConfig(layers?: ConfigLayers): ResolvedConfig {
  const environment: EnvRecord = layers?.env ?? process.env;
  const configLayer: MovoConfigInput = layers?.config ?? {};
  const envLayer: MovoConfigInput = configFromEnv(environment);
  const resourceLayer: ResourceConfigOverride = layers?.resource ?? {};
  const argumentLayer: MovoConfigInput = layers?.argument ?? {};

  validateConfigInput(configLayer, "config");
  validateConfigInput(envLayer, "env");
  validateConfigInput(argumentLayer, "argument");

  const env = pick<MovoEnv>(
    "testnet",
    ["config", configLayer.env],
    ["env", envLayer.env],
    ["argument", argumentLayer.env],
  );

  const network = pick<Network>(
    STELLAR_TESTNET_CAIP2,
    ["config", configLayer.network],
    ["env", envLayer.network],
    ["resource", resourceLayer.network],
    ["argument", argumentLayer.network],
  );

  const payTo = pick<string | undefined>(
    undefined,
    ["config", configLayer.payTo],
    ["env", envLayer.payTo],
    ["resource", resourceLayer.payTo],
    ["argument", argumentLayer.payTo],
  );

  const resolved: ResolvedConfig = {
    env,
    network,
    payTo,
    facilitator: {
      url: pick<string>(
        DEFAULT_FACILITATOR_URL,
        ["config", configLayer.facilitator?.url],
        ["env", envLayer.facilitator?.url],
        ["argument", argumentLayer.facilitator?.url],
      ),
      authHeaders: pick<AuthHeadersProvider | undefined>(
        undefined,
        ["config", configLayer.facilitator?.authHeaders],
        ["argument", argumentLayer.facilitator?.authHeaders],
      ),
      timeoutMs: pick<number>(
        DEFAULT_FACILITATOR_TIMEOUT_MS,
        ["config", configLayer.facilitator?.timeoutMs],
        ["argument", argumentLayer.facilitator?.timeoutMs],
      ),
    },
    defaults: {
      price: pick<Price | undefined>(
        undefined,
        ["config", configLayer.defaults?.price],
        ["resource", resourceLayer.price],
        ["argument", argumentLayer.defaults?.price],
      ),
      maxTimeoutSeconds: pick<number>(
        DEFAULT_MAX_TIMEOUT_SECONDS,
        ["config", configLayer.defaults?.maxTimeoutSeconds],
        ["resource", resourceLayer.maxTimeoutSeconds],
        ["argument", argumentLayer.defaults?.maxTimeoutSeconds],
      ),
    },
    discovery: {
      enabled: pick<boolean>(
        true,
        ["config", configLayer.discovery?.enabled],
        ["argument", argumentLayer.discovery?.enabled],
      ),
      serviceName: pick<string | undefined>(
        undefined,
        ["config", configLayer.discovery?.serviceName],
        ["argument", argumentLayer.discovery?.serviceName],
      ),
      tags: pick<readonly string[] | undefined>(
        undefined,
        ["config", configLayer.discovery?.tags],
        ["argument", argumentLayer.discovery?.tags],
      ),
      iconUrl: pick<string | undefined>(
        undefined,
        ["config", configLayer.discovery?.iconUrl],
        ["argument", argumentLayer.discovery?.iconUrl],
      ),
    },
    stellar: {
      rpcUrl: pick<string | undefined>(
        undefined,
        ["config", configLayer.stellar?.rpcUrl],
        ["env", envLayer.stellar?.rpcUrl],
        ["argument", argumentLayer.stellar?.rpcUrl],
      ),
    },
  };

  // Order matters. The pubnet interlock runs first because it is a safety gate rather than a
  // consistency check: a developer who has not declared an intent to touch real money should
  // be told that before being told anything else about their configuration.
  assertPubnetEnabled(resolved.env, environment);
  assertNetworkSupported(resolved.network);
  assertEnvNetworkAgreement(resolved.env, resolved.network);
  assertPayToValid(resolved.payTo);
  assertFacilitatorUrlValid(resolved.facilitator.url);

  return resolved;
}
