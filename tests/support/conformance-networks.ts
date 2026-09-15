/**
 * The networks the stock-client conformance suite runs against, and the gate that keeps pubnet
 * out until someone means it.
 *
 * §1.16 layer 4 and RFP §3.6 require the conformance suite to run on **both networks** and
 * publish a settled hash per network per scheme. Movo is testnet-complete: pubnet is a committed
 * production follow-on with its own human-gated prerequisites (funded sponsors, a KMS/HSM key
 * story, an RPC provider agreement, the Audit Bank review — §B.3/§B.4). So the matrix carries
 * both rows from the start and pubnet is **a configuration flip, not a code change** — but the
 * flip is deliberately hard to make by accident.
 *
 * **Why the opt-in is a separate variable from the credentials.** Naming pubnet in an
 * environment variable must not be sufficient to spend real money. A suite that runs against
 * mainnet the moment someone copies the wrong `.env` line is a suite that will eventually run
 * against mainnet; §29's release checklist asks for exactly this property ("no test is one
 * environment variable away from real funds"). `MOVO_CONFORMANCE_ALLOW_PUBNET=1` is an
 * additional, explicit act, and `tests/unit/conformance-network-gate.test.ts` proves the gate
 * fails closed without it.
 *
 * A network that cannot run is reported as **UNVERIFIED with a reason**, never silently dropped.
 * A conformance matrix that quietly shrinks to the row that happened to be configured is the
 * skipped-test defect (§E.3) wearing a conformance badge.
 */

/** One network in the conformance matrix. */
export interface ConformanceNetwork {
  /** CAIP-2 identifier, as upstream and the facilitator use it. */
  readonly caip2: string;
  /** Horizon instance used for independent on-chain confirmation. */
  readonly horizon: string;
  /** Environment variable naming the buyer's secret key. */
  readonly buyerKeyEnv: string;
  /** Environment variable naming the seller's receiving address. */
  readonly payToEnv: string;
  /** Environment variable naming the facilitator's sponsor seeds. */
  readonly sponsorSeedsEnv: string;
  /** True when running this network requires an explicit opt-in beyond its credentials. */
  readonly requiresOptIn: boolean;
}

/** The explicit act that unlocks the pubnet row. Nothing else does. */
export const PUBNET_OPT_IN = "MOVO_CONFORMANCE_ALLOW_PUBNET";

/** Both networks the RFP names, in the order the evidence table reports them. */
export const CONFORMANCE_NETWORKS: readonly ConformanceNetwork[] = [
  {
    caip2: "stellar:testnet",
    horizon: "https://horizon-testnet.stellar.org",
    buyerKeyEnv: "STELLAR_PRIVATE_KEY",
    payToEnv: "MOVO_PAY_TO",
    sponsorSeedsEnv: "MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS",
    requiresOptIn: false,
  },
  {
    caip2: "stellar:pubnet",
    horizon: "https://horizon.stellar.org",
    buyerKeyEnv: "MOVO_CONFORMANCE_PUBNET_BUYER_KEY",
    payToEnv: "MOVO_CONFORMANCE_PUBNET_PAY_TO",
    sponsorSeedsEnv: "MOVO_FACILITATOR_PUBNET_SIGNER_SEEDS",
    requiresOptIn: true,
  },
];

/** A network's place in this run: either runnable, or unverified with a reason. */
export interface NetworkSelection {
  readonly network: ConformanceNetwork;
  readonly runnable: boolean;
  /** Why it is not runnable. Empty when it is. */
  readonly reason: string;
}

/**
 * Decide, for one environment, which networks this run may touch.
 *
 * Fails closed at every step: the opt-in must be exactly `"1"`, and every credential the row
 * names must be present and non-empty. A row missing either is reported, not dropped.
 *
 * @param env - The environment to judge, injected so the gate is testable without mutating the process
 * @returns One selection per network in `CONFORMANCE_NETWORKS`, in that order
 */
export function selectNetworks(env: {
  readonly [name: string]: string | undefined;
}): readonly NetworkSelection[] {
  return CONFORMANCE_NETWORKS.map((network) => {
    if (network.requiresOptIn && env[PUBNET_OPT_IN] !== "1") {
      return {
        network,
        runnable: false,
        reason: `UNVERIFIED — ${network.caip2} requires ${PUBNET_OPT_IN}=1. Pubnet is the committed production follow-on (§B.4), not part of the testnet-complete release.`,
      };
    }

    const missing = [network.buyerKeyEnv, network.payToEnv, network.sponsorSeedsEnv].filter(
      (name) => {
        const value = env[name];
        return value === undefined || value === "";
      },
    );

    if (missing.length > 0) {
      return {
        network,
        runnable: false,
        reason: `UNVERIFIED — ${network.caip2} is not configured here: ${missing.join(", ")} unset.`,
      };
    }

    return { network, runnable: true, reason: "" };
  });
}
