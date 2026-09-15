/**
 * The pubnet gate on the conformance matrix, and the proof that it fails closed.
 *
 * The dangerous failure here is not a red build — it is a green one that spent real money.
 * §29's release checklist asks that no test be one environment variable away from real funds,
 * so this asserts the two properties that make that true: naming pubnet is not enough, and
 * holding pubnet credentials is not enough. Both are required, and each alone must fail.
 */

import { describe, expect, it } from "vitest";
import {
  CONFORMANCE_NETWORKS,
  PUBNET_OPT_IN,
  selectNetworks,
} from "../support/conformance-networks.ts";

const TESTNET_ENV = {
  STELLAR_PRIVATE_KEY: "S…buyer",
  MOVO_PAY_TO: "G…seller",
  MOVO_FACILITATOR_TESTNET_SIGNER_SEEDS: "S…sponsor",
};

const PUBNET_CREDENTIALS = {
  MOVO_CONFORMANCE_PUBNET_BUYER_KEY: "S…buyer",
  MOVO_CONFORMANCE_PUBNET_PAY_TO: "G…seller",
  MOVO_FACILITATOR_PUBNET_SIGNER_SEEDS: "S…sponsor",
};

/**
 * Look up one network's selection.
 *
 * @param selections - The result of `selectNetworks`
 * @param caip2 - The network to find
 * @returns That network's selection
 */
function selectionFor(
  selections: readonly { network: { caip2: string }; runnable: boolean; reason: string }[],
  caip2: string,
): { runnable: boolean; reason: string } {
  const found = selections.find((selection) => selection.network.caip2 === caip2);
  if (found === undefined) throw new Error(`${caip2} is missing from the conformance matrix`);
  return found;
}

describe("conformance network matrix", () => {
  it("carries both networks, so pubnet is a configuration flip and not a code change", () => {
    expect(CONFORMANCE_NETWORKS.map((network) => network.caip2)).toEqual([
      "stellar:testnet",
      "stellar:pubnet",
    ]);
  });

  it("runs testnet when its credentials are present", () => {
    expect(selectionFor(selectNetworks(TESTNET_ENV), "stellar:testnet").runnable).toBe(true);
  });

  it("reports a missing network rather than dropping it", () => {
    const selection = selectionFor(selectNetworks({}), "stellar:testnet");
    expect(selection.runnable).toBe(false);
    expect(selection.reason).toContain("UNVERIFIED");
    expect(selection.reason).toContain("STELLAR_PRIVATE_KEY");
  });

  it("refuses pubnet when the credentials are present but the opt-in is not", () => {
    // The load-bearing case. Someone with pubnet keys in their environment — an operator, a
    // future production runner — must not settle real value by running the suite.
    const selection = selectionFor(selectNetworks(PUBNET_CREDENTIALS), "stellar:pubnet");
    expect(selection.runnable).toBe(false);
    expect(selection.reason).toContain(PUBNET_OPT_IN);
  });

  it("refuses pubnet when the opt-in is present but the credentials are not", () => {
    const selection = selectionFor(selectNetworks({ [PUBNET_OPT_IN]: "1" }), "stellar:pubnet");
    expect(selection.runnable).toBe(false);
    expect(selection.reason).toContain("UNVERIFIED");
  });

  it('treats any value other than exactly "1" as not opted in', () => {
    for (const value of ["true", "yes", "0", " 1", "1 ", ""]) {
      const selection = selectionFor(
        selectNetworks({ ...PUBNET_CREDENTIALS, [PUBNET_OPT_IN]: value }),
        "stellar:pubnet",
      );
      expect(selection.runnable, `${PUBNET_OPT_IN}=${JSON.stringify(value)} unlocked pubnet`).toBe(
        false,
      );
    }
  });

  it("unlocks pubnet only when both the opt-in and every credential are present", () => {
    const selection = selectionFor(
      selectNetworks({ ...PUBNET_CREDENTIALS, [PUBNET_OPT_IN]: "1" }),
      "stellar:pubnet",
    );
    expect(selection.runnable).toBe(true);
  });

  it("does not opt in from this repository's own environment", () => {
    // Asserted against the real environment, not a fixture: the gate must be shut here, in the
    // repository that ships the testnet-complete release.
    expect(selectionFor(selectNetworks(process.env), "stellar:pubnet").runnable).toBe(false);
  });
});
