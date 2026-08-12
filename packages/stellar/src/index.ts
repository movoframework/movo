/**
 * `@movoframework/stellar` — Stellar preflight diagnostics.
 *
 * This package is deliberately thin, and it is worth saying why rather than letting a reader
 * wonder. Movo defines **no** Stellar constants: not a network identifier, not a USDC contract
 * address, not a decimal count, not a passphrase, not an RPC URL, not an address validator, not
 * an amount converter. Every one of those is exported by `@x402/stellar` and imported through
 * the Movo core narrow waist. A second copy of a USDC address or a decimal count is exactly how
 * a silent money bug is made — the copies agree until the day one changes (spec §1.8 D4).
 *
 * What is left is the part nobody else does: turning the setup problems that produce
 * inscrutable payment failures into findings with remedies attached. The trustline check alone
 * justifies the package.
 *
 * **Findings, not exceptions.** Every check returns a `Finding` and never throws for a negative
 * result. A missing trustline is data about the world. Whether it should fail a build is policy,
 * and policy belongs to the caller — which is why `movo doctor --fail-on` is a CLI flag and not
 * a library decision.
 */

import type { Finding, ResolvedConfig } from "@movoframework/core";
import { account } from "./checks/account.js";
import { asset } from "./checks/asset.js";
import { clock } from "./checks/clock.js";
import { expiry } from "./checks/expiry.js";
import { facilitator } from "./checks/facilitator.js";
import { trustline } from "./checks/trustline.js";
import { ALL_CHECKS, type Check, type CheckId, type PreflightOptions } from "./types.js";

export { account } from "./checks/account.js";
export { asset } from "./checks/asset.js";
export { clock } from "./checks/clock.js";
export { expiry } from "./checks/expiry.js";
export { facilitator } from "./checks/facilitator.js";
export { trustline } from "./checks/trustline.js";
export { type AssetMetadata, readAssetMetadata } from "./sac.js";
export {
  ALL_CHECKS,
  CHECK_IDS,
  type Check,
  type CheckId,
  type CheckOptions,
  type Finding,
  type PreflightOptions,
} from "./types.js";

/** Every check, addressable by name. */
export const checks: Readonly<Record<CheckId, Check>> = {
  account,
  trustline,
  asset,
  facilitator,
  expiry,
  clock,
};

/**
 * Run the preflight checks.
 *
 * Checks run **sequentially**, in the order they appear in {@link ALL_CHECKS}. That order is not
 * arbitrary and the sequencing is not an oversight: `account` before `trustline` before `asset`
 * means the first failure a developer sees is the most fundamental one. Running them in
 * parallel would be faster and would produce three errors describing the same missing account,
 * leaving the reader to work out which to fix first.
 *
 * @param config - Resolved configuration
 * @param options - Which checks to run, and timeout/RPC/clock overrides
 * @returns One finding per check, in run order
 */
export async function preflight(
  config: ResolvedConfig,
  options?: PreflightOptions,
): Promise<Finding[]> {
  const selected = options?.checks ?? ALL_CHECKS;
  const findings: Finding[] = [];

  for (const id of selected) {
    const check = checks[id];
    findings.push(await check(config, options));
  }

  return findings;
}

/** The published version of this package. */
export const VERSION: string = "0.0.0";
