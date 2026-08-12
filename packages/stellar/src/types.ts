/**
 * Preflight types.
 *
 * Every check returns a {@link Finding} and **never throws for a negative result**. A missing
 * trustline is data about the world, not an exceptional condition — the whole purpose of
 * preflight is to report it clearly. Checks throw only on programmer error, such as being
 * handed a configuration that never resolved.
 *
 * Severity policy belongs to the caller. `movo doctor --fail-on warn` is a CLI flag precisely
 * because a library that decided which findings were fatal would be imposing policy on every
 * consumer (spec §5.6).
 */

import type { Finding, Network, ResolvedConfig, RpcConfig } from "@movoframework/core";

/** Stable identifiers for the six checks. Changing one is a major: CI configurations filter on them. */
export const CHECK_IDS = {
  account: "stellar.account",
  trustline: "stellar.trustline",
  asset: "stellar.asset",
  facilitator: "stellar.facilitator",
  expiry: "stellar.expiry",
  clock: "stellar.clock",
} as const;

/** The name of a single preflight check. */
export type CheckId = keyof typeof CHECK_IDS;

/** Every check name, in the order `preflight` runs them. */
export const ALL_CHECKS: readonly CheckId[] = [
  "account",
  "trustline",
  "asset",
  "facilitator",
  "expiry",
  "clock",
];

/** Options common to every check. */
export interface CheckOptions {
  /**
   * Bound on each network call.
   *
   * A timeout produces a `warn`, never an `error`: a slow RPC is not a misconfiguration, and
   * failing a deploy gate because someone's network was briefly congested would teach people
   * to disable the gate.
   */
  readonly timeoutMs?: number;
  /** RPC overrides, passed through to upstream's client factories. */
  readonly rpc?: RpcConfig;
  /** Injectable clock, so the skew check is testable without waiting for reality. */
  readonly now?: () => number;
  /** Injectable fetch, so the facilitator check is testable without a network. */
  readonly fetch?: typeof globalThis.fetch;
}

/** A single preflight check. */
export type Check = (config: ResolvedConfig, options?: CheckOptions) => Promise<Finding>;

/** Options for {@link preflight}. */
export interface PreflightOptions extends CheckOptions {
  /** Which checks to run. Defaults to all six, in {@link ALL_CHECKS} order. */
  readonly checks?: readonly CheckId[];
}

/** The asset a resource is priced in, resolved from configuration. */
export interface ResolvedAsset {
  /** SEP-41 contract address. */
  readonly contractId: string;
  /** The network it lives on. */
  readonly network: Network;
}

export type { Finding };
