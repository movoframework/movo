/**
 * `account` — does the account that will be paid exist on this network, and is it funded?
 *
 * On Stellar an account does not exist until it holds the base reserve. Paying an
 * unfunded address does not fail with "no such account" in any obvious place; it fails deep
 * inside settlement, and the developer sees a rejected payment rather than a setup problem.
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

const ID = CHECK_IDS.account;
const TITLE = "payTo account exists and is funded";

/**
 * Check that `payTo` exists on the configured network.
 *
 * @param config - Resolved configuration
 * @param options - Timeout and RPC overrides
 * @returns A finding describing the account's state
 */
export async function account(config: ResolvedConfig, options?: CheckOptions): Promise<Finding> {
  const payTo = config.payTo.value;
  if (payTo === undefined) {
    return {
      id: ID,
      level: "error",
      title: `${TITLE} — no payTo configured`,
      detail:
        "No payTo address is configured, so there is no account to check and no account to be paid.",
      fix: "Set payTo in movo.config.ts, or MOVO_PAY_TO in the environment.",
    };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const network = networkOf(config);

  try {
    const horizon = getHorizonClient(network);
    const record = await withTimeout(async () => horizon.loadAccount(payTo), timeoutMs);

    const native = record.balances.find((balance) => balance.asset_type === "native");
    const xlm = native === undefined ? "0" : native.balance;

    if (Number(xlm) <= 0) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — account exists but holds no XLM`,
        detail: `${payTo} exists on ${network} but its native balance is ${xlm}. An account below the base reserve cannot hold trustlines.`,
        fix:
          network === "stellar:testnet"
            ? `Fund it from friendbot: curl "https://friendbot.stellar.org/?addr=${payTo}"`
            : "Fund the account with XLM to cover the base reserve and its trustlines.",
      };
    }

    return {
      id: ID,
      level: "ok",
      title: TITLE,
      detail: `${payTo} exists on ${network} with a native balance of ${xlm} XLM.`,
    };
  } catch (error) {
    if (error instanceof CheckTimeout) return timeoutFinding(ID, TITLE, timeoutMs);

    // Horizon answers 404 for an account that has never been funded. That is the single most
    // common state for a developer following the quickstart, so it gets a remedy rather than
    // a stack trace.
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — account does not exist`,
        detail: `${payTo} has never been funded on ${network}, so it does not exist yet. On Stellar an account comes into being only when it receives the base reserve.`,
        fix:
          network === "stellar:testnet"
            ? `Fund it from friendbot: curl "https://friendbot.stellar.org/?addr=${payTo}"`
            : "Send XLM to the address to create the account.",
      };
    }

    return unexpectedFinding(ID, TITLE, error);
  }
}
