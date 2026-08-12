/**
 * `expiry` — is `maxTimeoutSeconds` sane against how fast this network closes ledgers?
 *
 * A signed Soroban authorization entry is valid until a ledger sequence, not until a wall-clock
 * time. `maxTimeoutSeconds` is how long Movo tells a buyer their payment authorisation remains
 * good for, so it has to be expressed in enough ledgers to survive the round trip — sign,
 * retry, verify, settle — while staying short enough that the replay window is small.
 *
 * Both directions are worth a finding. Too short and slow clients fail intermittently, which
 * reads as flakiness rather than as configuration. Too long and a signed authorisation stays
 * spendable far longer than the request that produced it.
 */

import {
  DEFAULT_ESTIMATED_LEDGER_SECONDS,
  type Finding,
  getEstimatedLedgerCloseTimeSeconds,
  type ResolvedConfig,
} from "@movoframework/core";
import {
  CheckTimeout,
  DEFAULT_CHECK_TIMEOUT_MS,
  networkOf,
  timeoutFinding,
  unexpectedFinding,
  withTimeout,
} from "../internal.js";
import { CHECK_IDS, type CheckOptions } from "../types.js";

const ID = CHECK_IDS.expiry;
const TITLE = "maxTimeoutSeconds leaves usable headroom";

/**
 * Below this many ledgers, an ordinary round trip risks expiring mid-flight.
 *
 * Three is the smallest number with a defensible story: one ledger to be included, one for the
 * facilitator's verify, one for settle. Anything less and the buyer's signature can expire
 * between two steps that both succeeded.
 */
const MIN_LEDGERS = 3;

/** Above this many ledgers the replay window is wider than any request needs. */
const MAX_REASONABLE_LEDGERS = 120;

/**
 * Check the payment authorisation window against ledger close time.
 *
 * @param config - Resolved configuration
 * @param options - Timeout overrides
 * @returns A finding describing the headroom
 */
export async function expiry(config: ResolvedConfig, options?: CheckOptions): Promise<Finding> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const network = networkOf(config);
  const maxTimeoutSeconds = config.defaults.maxTimeoutSeconds.value;

  try {
    const secondsPerLedger = await withTimeout(
      async () => getEstimatedLedgerCloseTimeSeconds(network),
      timeoutMs,
    );

    const effective = secondsPerLedger > 0 ? secondsPerLedger : DEFAULT_ESTIMATED_LEDGER_SECONDS;
    const ledgers = Math.floor(maxTimeoutSeconds / effective);
    const summary = `maxTimeoutSeconds is ${String(maxTimeoutSeconds)}s and ${network} closes a ledger about every ${String(effective)}s, so a payment authorisation covers roughly ${String(ledgers)} ledger(s)`;

    if (ledgers < MIN_LEDGERS) {
      return {
        id: ID,
        level: "warn",
        title: `${TITLE} — window may be too short`,
        detail: `${summary}. A full round trip needs the payment to be included, verified and settled, so fewer than ${String(MIN_LEDGERS)} ledgers risks authorisations expiring mid-flight. That failure looks like intermittent flakiness rather than like configuration.`,
        fix: `Raise defaults.maxTimeoutSeconds to at least ${String(MIN_LEDGERS * effective)}. 60 is a reasonable default.`,
      };
    }

    if (ledgers > MAX_REASONABLE_LEDGERS) {
      return {
        id: ID,
        level: "warn",
        title: `${TITLE} — window is very wide`,
        detail: `${summary}, which keeps a signed authorisation spendable for far longer than the request that produced it.`,
        fix: "Lower defaults.maxTimeoutSeconds. Unless you have a specific reason for a long window, 60 seconds is ample and keeps the replay window small.",
      };
    }

    return {
      id: ID,
      level: "ok",
      title: TITLE,
      detail: `${summary}, which is comfortable for a sign, verify and settle round trip.`,
    };
  } catch (error) {
    if (error instanceof CheckTimeout) return timeoutFinding(ID, TITLE, timeoutMs);
    return unexpectedFinding(ID, TITLE, error);
  }
}
