/**
 * `trustline` — THE HIGHEST-VALUE CHECK.
 *
 * A Stellar account cannot receive an asset it does not trust. There is no error at the point
 * of configuration, no warning at startup, and no useful message at the point of failure: the
 * payment is simply rejected, deep inside settlement, in language about the asset rather than
 * about the account. The developer's own account is the thing that is wrong, and nothing tells
 * them so.
 *
 * The official onboarding path makes this worse by routing a developer through three separate
 * tools — a wallet or the Lab to create the keypair, friendbot to fund it, and the Lab's
 * change-trust flow to add the trustline — before Circle's captcha-gated faucet will give them
 * any USDC. Every one of those steps is a place to stop, and stopping at any of them produces
 * the same silent failure later.
 *
 * This check exists so that failure is loud, early, and comes with the exact commands that
 * fix it. It is the single strongest argument for `movo doctor` existing at all.
 */

import {
  type Finding,
  getHorizonClient,
  getUsdcAddress,
  type Network,
  type ResolvedConfig,
} from "@movoframework/core";
import {
  assetForConfig,
  CheckTimeout,
  DEFAULT_CHECK_TIMEOUT_MS,
  networkOf,
  timeoutFinding,
  unexpectedFinding,
  withTimeout,
} from "../internal.js";
import { readAssetMetadata } from "../sac.js";
import { CHECK_IDS, type CheckOptions } from "../types.js";

const ID = CHECK_IDS.trustline;
const TITLE = "payTo trusts the configured asset";

/**
 * The remedy, written out in full.
 *
 * The `fix` field is the reason this check is worth having, so it names every step rather than
 * linking to a page that names them. A developer reading this at the point of failure should
 * not have to go and find a tutorial.
 *
 * @param address - The account needing the trustline
 * @param network - The network it is on
 * @returns A copy-pasteable remedy
 */
function trustlineRemedy(
  address: string,
  network: Network,
  expected?: { readonly code: string; readonly issuer: string },
): string {
  const testnet = network === "stellar:testnet";
  const line = expected === undefined ? "USDC:<issuer>" : `${expected.code}:${expected.issuer}`;
  const steps = [
    testnet
      ? `1. Fund the account if you have not already: curl "https://friendbot.stellar.org/?addr=${address}"`
      : "1. Ensure the account holds enough XLM for the base reserve plus one trustline.",
    `2. Add the trustline. With the Stellar CLI: stellar tx new change-trust --source-account <your-key> --line ${line} ${testnet ? "--network testnet" : "--network public"}. Or use the change-trust flow in Stellar Lab: https://lab.stellar.org`,
    testnet
      ? `3. Get testnet ${expected?.code ?? "USDC"} from Circle's faucet: https://faucet.circle.com (choose Stellar Testnet). The faucet is captcha-gated, so this step is manual by design.`
      : `3. Acquire ${expected?.code ?? "USDC"} through an exchange or issuer.`,
  ];
  return steps.join(" ");
}

/**
 * Check that `payTo` holds a trustline to the asset prices resolve to.
 *
 * @param config - Resolved configuration
 * @param options - Timeout and RPC overrides
 * @returns A finding describing the trustline's state
 */
export async function trustline(config: ResolvedConfig, options?: CheckOptions): Promise<Finding> {
  const payTo = config.payTo.value;
  if (payTo === undefined) {
    return {
      id: ID,
      level: "error",
      title: `${TITLE} — no payTo configured`,
      detail: "No payTo address is configured, so there is no account whose trustlines to check.",
      fix: "Set payTo in movo.config.ts, or MOVO_PAY_TO in the environment.",
    };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const network = networkOf(config);
  const assetContract = assetForConfig(config);
  const isDefaultUsdc = assetContract === getUsdcAddress(network);

  try {
    const horizon = getHorizonClient(network);
    const record = await withTimeout(async () => horizon.loadAccount(payTo), timeoutMs);

    const trustlines = record.balances.filter((balance) => balance.asset_type !== "native");

    if (trustlines.length === 0) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — no trustlines at all`,
        detail: `${payTo} holds no trustlines on ${network}, so it cannot receive ${
          isDefaultUsdc ? "USDC" : assetContract
        }. A payment to this account will be rejected during settlement, and the rejection will talk about the asset rather than about the account — which is why this is worth checking before a buyer ever tries.`,
        fix: trustlineRemedy(payTo, network),
      };
    }

    // Ask the contract what it actually is, rather than matching on an asset code. Anyone can
    // issue an asset called USDC, so a trustline whose code happens to read "USDC" proves
    // nothing on its own — the issuer is the identity that matters. A Stellar Asset Contract
    // reports "CODE:ISSUER", which is exactly the pair Horizon lists on the trustline.
    const metadata = await withTimeout(
      async () => readAssetMetadata(assetContract, network, options?.rpc),
      timeoutMs,
    );

    const expected = metadata.classic;
    if (expected === undefined) {
      // A native Soroban token has no classic trustline at all; holding it is a contract
      // balance. Reporting "no trustline" would be actively misleading.
      return {
        id: ID,
        level: "ok",
        title: `${TITLE} — native Soroban token, no trustline required`,
        detail: `${assetContract} on ${network} reports name ${JSON.stringify(metadata.name)} and does not wrap a classic asset, so receiving it does not require a trustline.`,
      };
    }

    const matching = trustlines.find(
      (balance) =>
        "asset_code" in balance &&
        balance.asset_code === expected.code &&
        "asset_issuer" in balance &&
        balance.asset_issuer === expected.issuer,
    );

    if (matching === undefined) {
      const sameCodeWrongIssuer = trustlines.find(
        (balance) => "asset_code" in balance && balance.asset_code === expected.code,
      );

      if (sameCodeWrongIssuer !== undefined && "asset_issuer" in sameCodeWrongIssuer) {
        return {
          id: ID,
          level: "error",
          title: `${TITLE} — trustline to the wrong ${expected.code} issuer`,
          detail: `${payTo} trusts an asset called ${expected.code}, but issued by ${sameCodeWrongIssuer.asset_issuer} rather than ${expected.issuer}. Asset codes are not unique on Stellar — anyone may issue one called ${expected.code} — so this account still cannot receive the asset your prices resolve to.`,
          fix: trustlineRemedy(payTo, network, expected),
        };
      }

      const found =
        trustlines
          .map((balance) => ("asset_code" in balance ? balance.asset_code : "unknown"))
          .join(", ") || "none";
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — no ${expected.code} trustline`,
        detail: `${payTo} holds trustlines to ${found}, but not to ${expected.code} issued by ${expected.issuer}, which is what prices on ${network} resolve to.`,
        fix: trustlineRemedy(payTo, network, expected),
      };
    }

    const balance = "balance" in matching ? matching.balance : "0";
    return {
      id: ID,
      level: "ok",
      title: TITLE,
      detail: `${payTo} trusts ${expected.code} issued by ${expected.issuer} on ${network}${
        isDefaultUsdc ? " (the network's default USDC)" : ""
      } and currently holds ${balance}. It can receive payment.`,
    };
  } catch (error) {
    if (error instanceof CheckTimeout) return timeoutFinding(ID, TITLE, timeoutMs);

    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — account does not exist`,
        detail: `${payTo} does not exist on ${network}, so it has no trustlines and cannot be paid.`,
        fix: trustlineRemedy(payTo, network),
      };
    }

    return unexpectedFinding(ID, TITLE, error);
  }
}
