/**
 * `clock` — is this machine's clock close enough to the network's?
 *
 * Payment authorisations are bounded by ledger sequence, and a machine whose clock has drifted
 * will compute expiry windows against the wrong "now". The symptom is payments that expire
 * before they are used, or that appear valid after they should not — and neither points at the
 * clock. Containers with a paused or suspended host are the usual culprit, which makes this a
 * cheap check with a surprisingly high hit rate.
 *
 * The reference is the Horizon response's own `Date` header. That avoids adding a dependency on
 * a third-party time service purely to answer a diagnostic question, and it measures skew
 * against the network Movo actually talks to.
 */

import { type Finding, getHorizonClient, type ResolvedConfig } from "@movoframework/core";
import {
  CheckTimeout,
  DEFAULT_CHECK_TIMEOUT_MS,
  networkOf,
  timeoutFinding,
  unexpectedFinding,
  withTimeout,
} from "../internal.js";
import { CHECK_IDS, type CheckOptions } from "../types.js";

const ID = CHECK_IDS.clock;
const TITLE = "local clock agrees with the network";

/** Skew above this is worth reporting. Below it, ordinary latency dominates. */
const WARN_SKEW_MS = 5_000;

/** Skew above this will affect payment windows. */
const ERROR_SKEW_MS = 30_000;

/**
 * Check local clock skew against the network.
 *
 * @param config - Resolved configuration
 * @param options - Timeout, fetch and clock overrides
 * @returns A finding describing the skew
 */
export async function clock(config: ResolvedConfig, options?: CheckOptions): Promise<Finding> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const network = networkOf(config);
  const now = options?.now ?? (() => Date.now());
  const doFetch = options?.fetch ?? globalThis.fetch;

  try {
    const horizonUrl = getHorizonClient(network).serverURL.toString().replace(/\/$/, "");

    const before = now();
    const response = await withTimeout(
      async (signal) => doFetch(`${horizonUrl}/`, { method: "GET", signal }),
      timeoutMs,
    );
    const after = now();

    const header = response.headers.get("date");
    if (header === null) {
      return {
        id: ID,
        level: "warn",
        title: `${TITLE} — no reference time available`,
        detail: `${horizonUrl} did not return a Date header, so local clock skew could not be measured.`,
        fix: "No action needed unless payments are expiring unexpectedly, in which case check this machine's clock against an NTP source.",
      };
    }

    const networkTime = Date.parse(header);
    // Compare against the midpoint of the request, so the round trip is not counted as skew.
    const localMidpoint = before + (after - before) / 2;
    const skewMs = localMidpoint - networkTime;
    const magnitude = Math.abs(skewMs);
    const direction = skewMs > 0 ? "ahead of" : "behind";
    const summary = `This machine's clock is about ${String(Math.round(magnitude / 1000))}s ${direction} ${horizonUrl}`;

    if (magnitude >= ERROR_SKEW_MS) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — significant skew`,
        detail: `${summary}. Payment authorisation windows are computed against local time, so skew of this size will cause payments to expire early or to look valid when they are not.`,
        fix: "Synchronise this machine's clock with an NTP source. On a container host that has been suspended or paused, restarting the container is usually enough.",
      };
    }

    if (magnitude >= WARN_SKEW_MS) {
      return {
        id: ID,
        level: "warn",
        title: `${TITLE} — minor skew`,
        detail: `${summary}, which is more than ordinary network latency explains but not yet large enough to affect payment windows.`,
        fix: "Worth synchronising with NTP before it grows.",
      };
    }

    return {
      id: ID,
      level: "ok",
      title: TITLE,
      detail: `${summary}, which is within normal round-trip latency.`,
    };
  } catch (error) {
    if (error instanceof CheckTimeout) return timeoutFinding(ID, TITLE, timeoutMs);
    return unexpectedFinding(ID, TITLE, error);
  }
}
