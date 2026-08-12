/**
 * Shared helpers for the preflight checks.
 *
 * Nothing here defines a Stellar constant, a network identifier, an address validator or a
 * decimal count. Every one of those comes from `@x402/stellar` through the Movo core narrow
 * waist (spec §1.8 D4). Duplicating a USDC contract address or a decimal count is exactly how
 * a silent money bug gets made: the two copies agree right up until the day one of them
 * changes.
 */

import {
  type Finding,
  getUsdcAddress,
  isAssetAmount,
  type MovoPrice,
  type Network,
  type ResolvedConfig,
} from "@movoframework/core";

/** How long a network-bound check waits before reporting a timeout. */
export const DEFAULT_CHECK_TIMEOUT_MS = 10_000;

/** Marker distinguishing "the network did not answer in time" from "the answer was bad". */
export class CheckTimeout extends Error {
  // Declared explicitly rather than as a constructor parameter property: `erasableSyntaxOnly`
  // is on, so the repository only permits TypeScript syntax that erases to nothing.
  readonly timeoutMs: number;
  override readonly name: string = "CheckTimeout";

  constructor(timeoutMs: number) {
    super(`timed out after ${String(timeoutMs)}ms`);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Run an operation under a deadline.
 *
 * @param operation - Receives an AbortSignal so the underlying request is actually cancelled
 * @param timeoutMs - Deadline in milliseconds
 * @returns The operation's result
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new CheckTimeout(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the `warn`-level finding a timeout produces.
 *
 * Deliberately not an `error`. A slow RPC is a fact about someone's network, not a fact about
 * their configuration, and a preflight that fails a deploy for it would be switched off.
 *
 * @param id - The check's stable id
 * @param title - Short summary
 * @param timeoutMs - The deadline that expired
 * @returns A warn-level finding
 */
export function timeoutFinding(id: string, title: string, timeoutMs: number): Finding {
  return {
    id,
    level: "warn",
    title: `${title} — timed out`,
    detail: `The check did not complete within ${String(timeoutMs)}ms. This is reported as a warning rather than an error because a slow or unreachable RPC endpoint is not by itself a misconfiguration.`,
    fix: "Re-run the check. If it times out consistently, set stellar.rpcUrl to an endpoint you control, or raise the preflight timeout.",
  };
}

/**
 * Build the finding an unexpected failure produces.
 *
 * @param id - The check's stable id
 * @param title - Short summary
 * @param error - The underlying failure
 * @returns A warn-level finding carrying the reason
 */
export function unexpectedFinding(id: string, title: string, error: unknown): Finding {
  return {
    id,
    level: "warn",
    title: `${title} — could not be completed`,
    detail: `The check failed for a reason Movo does not recognise: ${
      error instanceof Error ? error.message : String(error)
    }`,
    fix: "Re-run with MOVO_LOG_LEVEL=debug. If this persists, it is worth reporting — an unrecognised failure mode is a gap in the diagnostics, not just a gap in your setup.",
  };
}

/**
 * The asset a project's prices are denominated in.
 *
 * A resource priced with a money string such as `"$0.001"` settles in the network's default
 * stablecoin, which upstream resolves through `getUsdcAddress`. A resource priced with an
 * explicit `AssetAmount` names its own contract. Preflight therefore has to ask configuration
 * the same question the scheme will ask at request time, and must answer it the same way —
 * hence `getUsdcAddress` rather than a constant written down here.
 *
 * @param config - Resolved configuration
 * @returns The SEP-41 contract address prices resolve to
 */
export function assetForConfig(config: ResolvedConfig): string {
  const price: MovoPrice | undefined = config.defaults.price.value as MovoPrice | undefined;
  if (price !== undefined && isAssetAmount(price)) return price.asset;
  return getUsdcAddress(config.network.value);
}

/**
 * The network a check should run against.
 *
 * @param config - Resolved configuration
 * @returns The CAIP-2 network identifier
 */
export function networkOf(config: ResolvedConfig): Network {
  return config.network.value;
}
