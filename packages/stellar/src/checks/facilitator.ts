/**
 * `facilitator` — is the configured facilitator reachable, and does it advertise what this
 * project needs?
 *
 * A facilitator that is up but does not support `exact` on your network fails every payment
 * with a message about the payment rather than about the facilitator. Asking `/supported`
 * up front turns that into one clear finding.
 *
 * This check reads `/supported` only. It never sends a credential: `createAuthHeaders` may key
 * `supported` separately, and a preflight that authenticated would be probing with a secret to
 * answer a question that does not need one.
 */

import { EXACT_SCHEME, type Finding, type ResolvedConfig } from "@movoframework/core";
import {
  CheckTimeout,
  DEFAULT_CHECK_TIMEOUT_MS,
  networkOf,
  timeoutFinding,
  unexpectedFinding,
  withTimeout,
} from "../internal.js";
import { CHECK_IDS, type CheckOptions } from "../types.js";

const ID = CHECK_IDS.facilitator;
const TITLE = "facilitator is reachable and supports this network and scheme";

/** The shape of `/supported` that this check depends on. Everything else is ignored. */
interface SupportedPayload {
  readonly kinds?: readonly {
    readonly scheme?: string;
    readonly network?: string;
    readonly extra?: Record<string, unknown>;
  }[];
}

/**
 * Check facilitator reachability and advertised capability.
 *
 * @param config - Resolved configuration
 * @param options - Timeout and fetch overrides
 * @returns A finding describing the facilitator
 */
export async function facilitator(
  config: ResolvedConfig,
  options?: CheckOptions,
): Promise<Finding> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const network = networkOf(config);
  const base = config.facilitator.url.value.replace(/\/$/, "");
  const url = `${base}/supported`;
  const doFetch = options?.fetch ?? globalThis.fetch;

  try {
    const response = await withTimeout(async (signal) => doFetch(url, { signal }), timeoutMs);

    if (!response.ok) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — /supported returned ${String(response.status)}`,
        detail: `${url} answered HTTP ${String(response.status)}. Movo cannot tell whether this facilitator settles ${EXACT_SCHEME} on ${network}.`,
        fix: `Check facilitator.url, or MOVO_FACILITATOR_URL. The free keyless testnet facilitator is https://www.x402.org/facilitator.`,
      };
    }

    const payload = (await response.json()) as SupportedPayload;
    const kinds = payload.kinds ?? [];
    const match = kinds.find((kind) => kind.scheme === EXACT_SCHEME && kind.network === network);

    if (match === undefined) {
      const advertised =
        kinds.map((kind) => `${String(kind.scheme)}@${String(kind.network)}`).join(", ") ||
        "nothing";
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — does not advertise ${EXACT_SCHEME} on ${network}`,
        detail: `${base} is reachable but advertises ${advertised}. Every payment on ${network} would be rejected, and the rejection would describe the payment rather than the facilitator.`,
        fix: `Configure a facilitator that supports ${EXACT_SCHEME} on ${network}, or change network to one this facilitator supports. For Stellar testnet, https://www.x402.org/facilitator is free and needs no key.`,
      };
    }

    const sponsored = match.extra?.["areFeesSponsored"] === true;
    return {
      id: ID,
      level: "ok",
      title: TITLE,
      detail: `${base} advertises ${EXACT_SCHEME} on ${network}${
        sponsored
          ? " and sponsors network fees, so a buyer pays the asset amount and none of the Stellar fee"
          : " but does not advertise fee sponsorship, so a buyer must hold XLM to cover the network fee"
      }.`,
      ...(sponsored
        ? {}
        : {
            fix: "No action required, but buyers will need XLM as well as the payment asset. Worth stating in your API's documentation.",
          }),
    };
  } catch (error) {
    if (error instanceof CheckTimeout) return timeoutFinding(ID, TITLE, timeoutMs);

    return {
      id: ID,
      level: "warn",
      title: `${TITLE} — unreachable`,
      detail: `${url} could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }. This is a warning rather than an error because an unreachable endpoint is as often a local network problem as a misconfiguration.`,
      fix: `Confirm the URL and that outbound HTTPS is permitted from this machine. ${unexpectedFinding(ID, TITLE, error).fix ?? ""}`,
    };
  }
}
