/**
 * The facilitator service configuration, and its resolution from an environment.
 *
 * Two entry points, deliberately unequal in status:
 *
 *  - {@link resolveFacilitatorConfig} takes signer *objects*. This is the production path.
 *    A `FacilitatorStellarSigner` is structural — `{ address, signAuthEntry, signTransaction }`
 *    — so a KMS, an HSM, a remote signing service or a hardware wallet satisfies it without
 *    Movo knowing anything about it, and no raw seed need ever exist in this process.
 *
 *  - {@link facilitatorConfigFromEnv} takes seeds out of environment variables and derives
 *    signers with upstream's `createEd25519Signer`. This is the *development* path. It is
 *    convenient, it is what testnet uses, and it is exactly what spec §24.8 says production
 *    must not require. The runbook says so in the same words.
 *
 * The sponsor key is the highest-value secret in the system: it pays every fee, it is the
 * source account of every settled transaction, and an attacker holding it can drain the
 * sponsor accounts through transaction fees. Nothing in this module writes a seed to a log,
 * stores one on the resolved configuration, or keeps one after the signer is built.
 */

import {
  type FacilitatorStellarSigner,
  isStellarNetwork,
  MovoError,
  type Network,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
} from "@movoframework/core";
import { createEd25519Signer } from "@movoframework/core/facilitator";

/** Environment variables are read as a plain record so tests need no `process.env` mutation. */
export type EnvRecord = { readonly [key: string]: string | undefined };

/**
 * One network this deployment serves, with the signers that sponsor it.
 *
 * `signers` is the channel-account pool. On Stellar, sequence numbers serialise per source
 * account, so a single sponsor caps settlement throughput at one in-flight transaction no
 * matter how much traffic arrives. Several independent accounts is the mechanism that lifts
 * that cap, and `SignerPool` is what spreads load across them (see `signer-pool.ts`).
 */
export interface FacilitatorNetworkConfig {
  /** The CAIP-2 network, e.g. `stellar:testnet`. */
  readonly network: Network;
  /** One or more sponsoring signers. Order is not significant; selection is by in-flight load. */
  readonly signers: readonly FacilitatorStellarSigner[];
  /**
   * Optional fee-bump signer.
   *
   * When present, upstream wraps the settled transaction in a `FeeBumpTransaction` whose fee
   * source is this signer, which decouples *paying* the fee from *holding the sequence number*.
   * That is the sharper form of the channel-account pattern: the pool accounts advance
   * sequence numbers, one funded account pays. Verified from the installed
   * `ExactStellarScheme` declaration, which documents exactly this behaviour.
   */
  readonly feeBumpSigner?: FacilitatorStellarSigner;
  /** Custom Soroban RPC URL. Required for pubnet, which has no public default upstream. */
  readonly rpcUrl?: string;
  /** Advertised on `/supported` as `extra.areFeesSponsored`. Upstream defaults this to true. */
  readonly areFeesSponsored: boolean;
  /** Safety ceiling; upstream rejects a payment whose simulated fee exceeds it. */
  readonly maxTransactionFeeStroops: number;
  /**
   * Readiness floor in whole XLM. `/ready` reports not-ready when any signer in this
   * network's pool holds less (AC6.9). A sponsor that cannot pay a fee is a facilitator that
   * accepts payments it will fail to settle, which is worse than one that declines them.
   */
  readonly sponsorFloorXlm: number;
}

/** A bearer key this deployment accepts, and the limits attached to it. */
export interface FacilitatorApiKey {
  /** Opaque identifier used in logs and metrics. Never the secret. */
  readonly id: string;
  /** The bearer token presented as `Authorization: Bearer <secret>`. */
  readonly secret: string;
  /** Requests per window for this key. Falls back to the service default when absent. */
  readonly requestsPerWindow?: number;
}

/** Caller authentication posture. */
export interface FacilitatorAuthConfig {
  /**
   * `open` — no credential required. The default, and mandatory for the testnet deployment
   * the RFP requires to be free and keyless.
   *
   * `bearer` — `Authorization: Bearer <secret>` matched against {@link keys}.
   */
  readonly mode: "open" | "bearer";
  readonly keys: readonly FacilitatorApiKey[];
}

/** Fixed-window rate limiting, applied per key and per source address. */
export interface FacilitatorRateLimitConfig {
  readonly enabled: boolean;
  readonly windowMs: number;
  readonly requestsPerWindowPerKey: number;
  readonly requestsPerWindowPerIp: number;
}

/**
 * The operator's fee schedule.
 *
 * RFP §3.1 requires that any mainnet fee be a configuration value rather than a hard-coded
 * one, so that a self-hoster can change or remove it. It is expressed in stroops per settled
 * payment, it defaults to **zero**, and it is recorded by the metering layer and exposed on
 * `/metrics` as an accrued amount per key.
 *
 * What it deliberately is *not*: a field on any protocol response. The x402 verify, settle
 * and supported shapes are upstream's and this service adds nothing to them. Collecting an
 * operator fee is a billing concern between an operator and their callers, and v0.1.0 ships
 * the accounting for it, not a collection mechanism.
 */
export interface FacilitatorFeeConfig {
  readonly settleFeeStroops: number;
}

/** The resolved service configuration. */
export interface FacilitatorConfig {
  readonly networks: readonly FacilitatorNetworkConfig[];
  readonly auth: FacilitatorAuthConfig;
  readonly rateLimit: FacilitatorRateLimitConfig;
  readonly fees: FacilitatorFeeConfig;
  /** Hard cap on a request body, in bytes, before parsing is attempted. */
  readonly maxBodyBytes: number;
  /** How long a cached signer-balance reading stays fresh, in milliseconds. */
  readonly balanceCacheMs: number;
}

/** What a caller may leave out; every field below has a documented default. */
export interface FacilitatorConfigInput {
  readonly networks: readonly FacilitatorNetworkConfigInput[];
  readonly auth?: Partial<FacilitatorAuthConfig>;
  readonly rateLimit?: Partial<FacilitatorRateLimitConfig>;
  readonly fees?: Partial<FacilitatorFeeConfig>;
  readonly maxBodyBytes?: number;
  readonly balanceCacheMs?: number;
}

/** A network entry before defaults are applied. */
export interface FacilitatorNetworkConfigInput {
  readonly network: Network;
  readonly signers: readonly FacilitatorStellarSigner[];
  readonly feeBumpSigner?: FacilitatorStellarSigner;
  readonly rpcUrl?: string;
  readonly areFeesSponsored?: boolean;
  readonly maxTransactionFeeStroops?: number;
  readonly sponsorFloorXlm?: number;
}

/**
 * Upstream's own default fee ceiling, restated here as a named constant.
 *
 * Read from the installed `ExactStellarScheme` declaration (`maxTransactionFeeStroops`,
 * default 50_000). Movo passes it explicitly rather than relying on the default so that the
 * value an operator sees on `/metrics` and in the runbook is the value actually in force.
 */
export const DEFAULT_MAX_TRANSACTION_FEE_STROOPS: number = 50_000;

/** Default readiness floor: enough XLM for a large number of sponsored settlements. */
export const DEFAULT_SPONSOR_FLOOR_XLM: number = 5;

/** Default body cap. A verify/settle envelope carrying a Soroban transaction fits easily. */
export const DEFAULT_MAX_BODY_BYTES: number = 128 * 1024;

/** Default rate-limit window. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS: number = 60_000;

/** Default per-key and per-IP request budgets within a window. */
export const DEFAULT_REQUESTS_PER_WINDOW_PER_KEY: number = 600;
export const DEFAULT_REQUESTS_PER_WINDOW_PER_IP: number = 120;

/** Default balance-reading freshness. Readiness must be current without hammering Horizon. */
export const DEFAULT_BALANCE_CACHE_MS: number = 30_000;

/**
 * Apply defaults and validate a facilitator configuration.
 *
 * @param input - Networks and any service-tier overrides
 * @returns The resolved configuration
 * @throws {MovoError} MOVO_E_FACILITATOR_CONFIG_INVALID when the shape cannot be served
 */
export function resolveFacilitatorConfig(input: FacilitatorConfigInput): FacilitatorConfig {
  if (input.networks.length === 0) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      "At least one network must be configured; a facilitator with none serves nothing.",
    );
  }

  const seen = new Set<string>();
  const networks = input.networks.map((entry) => resolveNetwork(entry, seen));

  const auth: FacilitatorAuthConfig = {
    mode: input.auth?.mode ?? "open",
    keys: input.auth?.keys ?? [],
  };
  if (auth.mode === "bearer" && auth.keys.length === 0) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      'Bearer authentication is enabled but no keys are configured, so every request would be rejected. Configure at least one key, or set the auth mode to "open".',
    );
  }
  for (const key of auth.keys) {
    if (key.secret.trim() === "") {
      throw new MovoError(
        "MOVO_E_FACILITATOR_CONFIG_INVALID",
        `Bearer key "${key.id}" has an empty secret.`,
      );
    }
  }

  return {
    networks,
    auth,
    rateLimit: {
      enabled: input.rateLimit?.enabled ?? true,
      windowMs: input.rateLimit?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
      requestsPerWindowPerKey:
        input.rateLimit?.requestsPerWindowPerKey ?? DEFAULT_REQUESTS_PER_WINDOW_PER_KEY,
      requestsPerWindowPerIp:
        input.rateLimit?.requestsPerWindowPerIp ?? DEFAULT_REQUESTS_PER_WINDOW_PER_IP,
    },
    fees: { settleFeeStroops: input.fees?.settleFeeStroops ?? 0 },
    maxBodyBytes: input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    balanceCacheMs: input.balanceCacheMs ?? DEFAULT_BALANCE_CACHE_MS,
  };
}

function resolveNetwork(
  entry: FacilitatorNetworkConfigInput,
  seen: Set<string>,
): FacilitatorNetworkConfig {
  if (!isStellarNetwork(entry.network)) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      `"${entry.network}" is not a Stellar network. This facilitator registers the Stellar exact scheme only.`,
    );
  }
  if (seen.has(entry.network)) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      `Network "${entry.network}" is configured more than once.`,
    );
  }
  seen.add(entry.network);

  if (entry.signers.length === 0) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      `Network "${entry.network}" has no sponsoring signer, so it could verify payments but never settle one.`,
    );
  }

  const addresses = new Set<string>();
  for (const signer of entry.signers) {
    if (addresses.has(signer.address)) {
      throw new MovoError(
        "MOVO_E_FACILITATOR_CONFIG_INVALID",
        `Signer ${signer.address} is configured twice on "${entry.network}". Duplicate pool entries do not add throughput — they share one sequence number — and they make the in-flight accounting wrong.`,
      );
    }
    addresses.add(signer.address);
  }

  // Pubnet has no public Soroban RPC default upstream, and a facilitator that discovers this
  // at the first settlement has already accepted a payment it cannot complete.
  if (entry.network === STELLAR_PUBNET_CAIP2 && (entry.rpcUrl ?? "") === "") {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      "stellar:pubnet requires an explicit Soroban RPC URL. There is no public mainnet default; name the provider you have an agreement with.",
    );
  }

  const floor = entry.sponsorFloorXlm ?? DEFAULT_SPONSOR_FLOOR_XLM;
  if (!Number.isFinite(floor) || floor < 0) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      `Sponsor floor for "${entry.network}" must be a non-negative number of XLM, got ${String(floor)}.`,
    );
  }

  const maxFee = entry.maxTransactionFeeStroops ?? DEFAULT_MAX_TRANSACTION_FEE_STROOPS;
  if (!Number.isSafeInteger(maxFee) || maxFee <= 0) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      `maxTransactionFeeStroops for "${entry.network}" must be a positive integer, got ${String(maxFee)}.`,
    );
  }

  return {
    network: entry.network,
    signers: entry.signers,
    ...(entry.feeBumpSigner === undefined ? {} : { feeBumpSigner: entry.feeBumpSigner }),
    ...(entry.rpcUrl === undefined ? {} : { rpcUrl: entry.rpcUrl }),
    areFeesSponsored: entry.areFeesSponsored ?? true,
    maxTransactionFeeStroops: maxFee,
    sponsorFloorXlm: floor,
  };
}

/** The environment variable prefix for every facilitator setting. */
export const FACILITATOR_ENV_PREFIX: string = "MOVO_FACILITATOR_";

/** Maps a CAIP-2 network to the infix used in its environment variables. */
export const NETWORK_ENV_INFIX: { readonly [network: string]: string } = {
  [STELLAR_TESTNET_CAIP2]: "TESTNET",
  [STELLAR_PUBNET_CAIP2]: "PUBNET",
};

/**
 * Build a configuration from environment variables — the development and container path.
 *
 * Reads, for each network named in `MOVO_FACILITATOR_NETWORKS`:
 *
 * | Variable | Meaning |
 * |---|---|
 * | `MOVO_FACILITATOR_<NET>_SIGNER_SEEDS` | Comma-separated secret seeds; one per channel account |
 * | `MOVO_FACILITATOR_<NET>_FEE_BUMP_SEED` | Optional fee-source seed |
 * | `MOVO_FACILITATOR_<NET>_RPC_URL` | Soroban RPC URL; required on pubnet |
 * | `MOVO_FACILITATOR_<NET>_SPONSOR_FLOOR_XLM` | Readiness floor |
 * | `MOVO_FACILITATOR_<NET>_MAX_TX_FEE_STROOPS` | Fee ceiling passed to the scheme |
 *
 * **This path puts raw seeds in the process environment and is unsuitable for pubnet.** Use
 * {@link resolveFacilitatorConfig} with injected signer objects there. The function does not
 * refuse pubnet outright, because an operator running a KMS-backed sidecar that materialises
 * a seed in-memory is making an informed choice; the runbook argues against it at length and
 * `apps/facilitator` logs a warning when it happens.
 *
 * @param env - The environment to read
 * @returns A resolved configuration
 * @throws {MovoError} MOVO_E_FACILITATOR_CONFIG_INVALID when a required variable is absent
 */
export function facilitatorConfigFromEnv(env: EnvRecord): FacilitatorConfig {
  const declared = (env[`${FACILITATOR_ENV_PREFIX}NETWORKS`] ?? STELLAR_TESTNET_CAIP2)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  const networks = declared.map((declaredNetwork): FacilitatorNetworkConfigInput => {
    // The environment yields a plain string. `NETWORK_ENV_INFIX` is the allowlist that turns
    // it into a network this module will act on, so the assertion below is checked rather
    // than asserted: an unmapped value has already thrown by the time it is applied.
    const infix = NETWORK_ENV_INFIX[declaredNetwork];
    const network = declaredNetwork as Network;
    if (infix === undefined) {
      throw new MovoError(
        "MOVO_E_FACILITATOR_CONFIG_INVALID",
        `"${network}" has no environment-variable mapping. Configure it through resolveFacilitatorConfig with injected signers, or use ${STELLAR_TESTNET_CAIP2} / ${STELLAR_PUBNET_CAIP2}.`,
      );
    }
    const variable = (suffix: string): string | undefined =>
      env[`${FACILITATOR_ENV_PREFIX}${infix}_${suffix}`];

    const seeds = (variable("SIGNER_SEEDS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");

    if (seeds.length === 0) {
      throw new MovoError(
        "MOVO_E_FACILITATOR_CONFIG_INVALID",
        `${FACILITATOR_ENV_PREFIX}${infix}_SIGNER_SEEDS is empty. A facilitator with no sponsoring signer on "${network}" can verify payments but never settle one.`,
      );
    }

    const feeBumpSeed = variable("FEE_BUMP_SEED");
    const rpcUrl = variable("RPC_URL");
    const floor = variable("SPONSOR_FLOOR_XLM");
    const maxFee = variable("MAX_TX_FEE_STROOPS");
    const sponsored = variable("ARE_FEES_SPONSORED");

    return {
      network,
      signers: seeds.map((seed) => createEd25519Signer(seed, network)),
      ...(feeBumpSeed === undefined || feeBumpSeed.trim() === ""
        ? {}
        : { feeBumpSigner: createEd25519Signer(feeBumpSeed.trim(), network) }),
      ...(rpcUrl === undefined || rpcUrl.trim() === "" ? {} : { rpcUrl: rpcUrl.trim() }),
      ...(floor === undefined ? {} : { sponsorFloorXlm: Number(floor) }),
      ...(maxFee === undefined ? {} : { maxTransactionFeeStroops: Number(maxFee) }),
      ...(sponsored === undefined ? {} : { areFeesSponsored: sponsored !== "false" }),
    };
  });

  const keys = parseApiKeys(env[`${FACILITATOR_ENV_PREFIX}API_KEYS`]);
  const declaredMode = env[`${FACILITATOR_ENV_PREFIX}AUTH_MODE`];
  // Keyless unless the operator asked otherwise, or supplied keys — which is an unambiguous
  // statement of intent. Testnet stays free and keyless by default (RFP §3.1).
  const mode: FacilitatorAuthConfig["mode"] =
    declaredMode === "bearer" || (declaredMode === undefined && keys.length > 0)
      ? "bearer"
      : "open";

  return resolveFacilitatorConfig({
    networks,
    auth: { mode, keys },
    rateLimit: {
      enabled: env[`${FACILITATOR_ENV_PREFIX}RATE_LIMIT`] !== "off",
      ...numberIfPresent("windowMs", env[`${FACILITATOR_ENV_PREFIX}RATE_LIMIT_WINDOW_MS`]),
      ...numberIfPresent(
        "requestsPerWindowPerKey",
        env[`${FACILITATOR_ENV_PREFIX}RATE_LIMIT_PER_KEY`],
      ),
      ...numberIfPresent(
        "requestsPerWindowPerIp",
        env[`${FACILITATOR_ENV_PREFIX}RATE_LIMIT_PER_IP`],
      ),
    },
    fees: {
      ...numberIfPresent("settleFeeStroops", env[`${FACILITATOR_ENV_PREFIX}SETTLE_FEE_STROOPS`]),
    },
    ...numberIfPresent("maxBodyBytes", env[`${FACILITATOR_ENV_PREFIX}MAX_BODY_BYTES`]),
  });
}

function numberIfPresent<K extends string>(key: K, raw: string | undefined): { [P in K]?: number } {
  if (raw === undefined || raw.trim() === "") return {} as { [P in K]?: number };
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new MovoError(
      "MOVO_E_FACILITATOR_CONFIG_INVALID",
      `${key} was set to "${raw}", which is not a number.`,
    );
  }
  return { [key]: value } as { [P in K]?: number };
}

/**
 * Parse `id:secret[:limit]` triples out of a single environment variable.
 *
 * One variable rather than one per key so that a container platform's secret injection has a
 * single name to bind, which is how every deployment target this ships for actually works.
 */
export function parseApiKeys(raw: string | undefined): readonly FacilitatorApiKey[] {
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [id, secret, limit] = entry.split(":");
      if (id === undefined || secret === undefined || id === "" || secret === "") {
        throw new MovoError(
          "MOVO_E_FACILITATOR_CONFIG_INVALID",
          `${FACILITATOR_ENV_PREFIX}API_KEYS entries must be "id:secret" or "id:secret:limit". One entry was neither, and its value is not reproduced here because it contains a credential.`,
        );
      }
      return {
        id,
        secret,
        ...(limit === undefined || limit === "" ? {} : { requestsPerWindow: Number(limit) }),
      };
    });
}
