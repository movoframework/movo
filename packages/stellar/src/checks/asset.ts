/**
 * `asset` — does the priced asset's contract resolve, and how many decimals does it declare?
 *
 * The decimals are **read from the contract, never assumed**. `DEFAULT_TOKEN_DECIMALS` is 7 and
 * Stellar USDC does use 7, but a project pricing in a different SEP-41 token may not — and an
 * assumed decimal count is the arithmetic error that sends a payment out by a factor of ten
 * million. Reading the value turns a silent assumption into a visible finding.
 */

import {
  DEFAULT_TOKEN_DECIMALS,
  type Finding,
  getUsdcAddress,
  type ResolvedConfig,
  validateStellarAssetAddress,
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

const ID = CHECK_IDS.asset;
const TITLE = "asset contract resolves and declares its decimals";

/**
 * Check that the configured asset contract exists and read its decimals.
 *
 * @param config - Resolved configuration
 * @param options - Timeout and RPC overrides
 * @returns A finding describing the asset
 */
export async function asset(config: ResolvedConfig, options?: CheckOptions): Promise<Finding> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const network = networkOf(config);
  const contractId = assetForConfig(config);

  if (!validateStellarAssetAddress(contractId)) {
    return {
      id: ID,
      level: "error",
      title: `${TITLE} — not a contract address`,
      detail: `The configured asset ${JSON.stringify(contractId)} is not a SEP-41 contract address.`,
      fix: `Stellar assets are contract addresses beginning with C. Use getUsdcAddress("${network}") rather than writing an address down — an address in your source is a second copy of a value upstream already exports.`,
    };
  }

  try {
    const metadata = await withTimeout(
      async () => readAssetMetadata(contractId, network, options?.rpc),
      timeoutMs,
    );

    const isDefaultUsdc = contractId === getUsdcAddress(network);
    const matchesDefault = metadata.decimals === DEFAULT_TOKEN_DECIMALS;
    const described = `${contractId}${isDefaultUsdc ? " (the network's default USDC)" : ""} on ${network} reports name ${JSON.stringify(metadata.name)} and declares ${String(metadata.decimals)} decimals`;

    if (matchesDefault) {
      return {
        id: ID,
        level: "ok",
        title: TITLE,
        detail: `${described}, matching the default of ${String(DEFAULT_TOKEN_DECIMALS)}.`,
      };
    }

    return {
      id: ID,
      level: "warn",
      title: `${TITLE} — non-default decimals`,
      detail: `${described}, which differs from the default of ${String(DEFAULT_TOKEN_DECIMALS)}. Prices written as money strings are converted against the asset's real decimals by @x402/stellar, so this is reported rather than corrected — but a surprise here usually means the wrong asset is configured.`,
      fix: "If you intended to price in this asset, no action is needed. If you expected USDC, check that defaults.price names the contract you meant.",
    };
  } catch (error) {
    if (error instanceof CheckTimeout) return timeoutFinding(ID, TITLE, timeoutMs);

    const message = error instanceof Error ? error.message : String(error);
    if (/not found|no such contract|MissingValue/i.test(message)) {
      return {
        id: ID,
        level: "error",
        title: `${TITLE} — contract not found`,
        detail: `${contractId} does not resolve on ${network}. A price denominated in an asset that does not exist cannot produce payment requirements a buyer can satisfy.`,
        fix: `Check the network. A contract that exists on one Stellar network does not exist on the other. For the default stablecoin use getUsdcAddress("${network}").`,
      };
    }

    return unexpectedFinding(ID, TITLE, error);
  }
}
