/**
 * The Movo configuration shape and its structural validation.
 *
 * Two absences are deliberate and are recorded here so nobody adds them back by reflex.
 *
 * **No `stellar.testnetFeeWorkaround`.** The M0 spike settled on Stellar testnet first try
 * with no `fee: "1"` transaction clone (docs/SPIKE_REPORT.md Q2, Spec Amendment 001 §1). The
 * flag described in the official quickstart is not required against `@x402/*` 2.21.0 and the
 * public testnet facilitator. If a fee-limit failure ever appears, it is filed as a
 * protocol-drift regression with its trigger condition — not coded around pre-emptively.
 *
 * **No payer key of any shape.** A Movo resource server never needs one: it names an address
 * to be paid, and the buyer signs. There is deliberately no field a developer could put a
 * secret seed into, because the type system is a cheaper custody boundary than a code review
 * (spec §1.11).
 */

import { MovoError } from "../errors/MovoError.js";
import type { Network, Price } from "../protocol/index.js";

/** Which network posture a project is running under. */
export type MovoEnv = "local" | "testnet" | "pubnet";

/** The three environments, for validation and for error messages. */
export const MOVO_ENVS: readonly MovoEnv[] = ["local", "testnet", "pubnet"];

/**
 * Supplies facilitator authorisation headers at call time.
 *
 * A function, never a string. The credential is read when it is needed and is never stored on
 * the configuration object, so it cannot be reached by anything that walks the config —
 * `movo doctor`'s printer, a diagnostic dump, a test snapshot.
 */
export type AuthHeadersProvider = () => Promise<{
  readonly verify?: Record<string, string>;
  readonly settle?: Record<string, string>;
  readonly supported?: Record<string, string>;
}>;

/** Facilitator selection and transport settings. */
export interface FacilitatorConfig {
  readonly url: string;
  readonly authHeaders?: AuthHeadersProvider;
  readonly timeoutMs: number;
}

/** Values a resource inherits when it does not state its own. */
export interface DefaultsConfig {
  readonly price?: Price;
  readonly maxTimeoutSeconds: number;
}

/** Project-level Bazaar discovery metadata. */
export interface DiscoveryConfig {
  readonly enabled: boolean;
  readonly serviceName?: string;
  readonly tags?: readonly string[];
  readonly iconUrl?: string;
}

/** Stellar transport settings. Constants and validators come from `@x402/stellar`, not here. */
export interface StellarConfig {
  readonly rpcUrl?: string;
}

/** The fully-populated configuration a compiled app runs against. */
export interface MovoConfig {
  readonly env: MovoEnv;
  readonly network: Network;
  readonly payTo?: string;
  readonly facilitator: FacilitatorConfig;
  readonly defaults: DefaultsConfig;
  readonly discovery: DiscoveryConfig;
  readonly stellar: StellarConfig;
}

/**
 * What an author writes in `movo.config.ts`.
 *
 * Every field is `?: T | undefined` rather than `?: T`, and the explicit `| undefined` is
 * deliberate under `exactOptionalPropertyTypes`. The most ordinary line anyone writes in a
 * config file is `payTo: process.env["MOVO_PAY_TO"]`, whose type is `string | undefined`. With
 * a bare `payTo?: string` that line does not compile, and the workarounds a reader reaches for
 * are worse than the problem — `?? ""` produces an empty address that fails validation later,
 * and `!` asserts something about the environment nobody has checked.
 *
 * Accepting `undefined` costs nothing, because resolution already treats an undefined value as
 * "this layer said nothing" rather than as an instruction to unset. The *resolved* type stays
 * strict; only the input is lenient. That is the distinction `exactOptionalPropertyTypes`
 * exists to let a library make.
 */
export interface MovoConfigInput {
  readonly env?: MovoEnv | undefined;
  readonly network?: Network | undefined;
  readonly payTo?: string | undefined;
  readonly facilitator?:
    | {
        readonly url?: string | undefined;
        readonly authHeaders?: AuthHeadersProvider | undefined;
        readonly timeoutMs?: number | undefined;
      }
    | undefined;
  readonly defaults?:
    | {
        readonly price?: Price | undefined;
        readonly maxTimeoutSeconds?: number | undefined;
      }
    | undefined;
  readonly discovery?:
    | {
        readonly enabled?: boolean | undefined;
        readonly serviceName?: string | undefined;
        readonly tags?: readonly string[] | undefined;
        readonly iconUrl?: string | undefined;
      }
    | undefined;
  readonly stellar?: { readonly rpcUrl?: string | undefined } | undefined;
}

/**
 * Reject a credential supplied as a literal rather than as a provider function.
 *
 * Runs at `defineConfig` time and again at every resolution layer. Failing fast here is
 * cheaper than any amount of redaction later: a credential that never enters the process's
 * configuration cannot be printed by code nobody has written yet.
 *
 * @param input - Raw configuration input from any layer
 * @param layerName - Which layer this input came from, for the error context
 */
export function assertNoLiteralSecret(input: MovoConfigInput, layerName: string): void {
  const authHeaders: unknown = input.facilitator?.authHeaders;
  if (authHeaders === undefined || typeof authHeaders === "function") return;

  throw new MovoError(
    "MOVO_E_SECRET_IN_CONFIG",
    `facilitator.authHeaders must be a function, but the ${layerName} layer supplied a ${typeof authHeaders}. ` +
      "A literal credential in configuration is rejected at definition time rather than risked in a log later.",
    { context: { layer: layerName, receivedType: typeof authHeaders } },
  );
}

/**
 * Validate the parts of a configuration input that can be checked without merging layers.
 *
 * Anything that depends on the *resolved* value — the env/network agreement, the pubnet gate —
 * belongs in `resolveConfig`, because at this point a later layer may still change it.
 *
 * @param input - Raw configuration input
 * @param layerName - Which layer this input came from, for error context
 */
export function validateConfigInput(input: MovoConfigInput, layerName: string): void {
  assertNoLiteralSecret(input, layerName);

  if (input.env !== undefined && !MOVO_ENVS.includes(input.env)) {
    throw new MovoError(
      "MOVO_E_ENV_INVALID",
      `env must be one of ${MOVO_ENVS.join(", ")}, received ${JSON.stringify(input.env)}.`,
      { context: { layer: layerName, env: input.env } },
    );
  }

  const timeoutMs = input.facilitator?.timeoutMs;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new MovoError(
      "MOVO_E_TIMEOUT_INVALID",
      `facilitator.timeoutMs must be a positive finite number of milliseconds, received ${String(timeoutMs)}.`,
      { context: { layer: layerName, timeoutMs } },
    );
  }

  const maxTimeoutSeconds = input.defaults?.maxTimeoutSeconds;
  if (
    maxTimeoutSeconds !== undefined &&
    (!Number.isFinite(maxTimeoutSeconds) || maxTimeoutSeconds <= 0)
  ) {
    throw new MovoError(
      "MOVO_E_MAX_TIMEOUT_INVALID",
      `defaults.maxTimeoutSeconds must be a positive finite number of seconds, received ${String(maxTimeoutSeconds)}.`,
      { context: { layer: layerName, maxTimeoutSeconds } },
    );
  }
}
