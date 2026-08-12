/**
 * Reading a SEP-41 asset contract's own account of itself.
 *
 * Both the `asset` and `trustline` checks need to know what a contract address actually is,
 * and neither may assume. This module asks the contract.
 *
 * **Why this is not a layering violation.** `@stellar/stellar-sdk`'s `contract.Client` fetches
 * a contract's interface from the network and invokes read-only methods by simulation. No XDR
 * is written by hand, no authorization entry is constructed, nothing is signed, and no fee is
 * paid. That is squarely inside what a diagnostics package may do, and Spec Amendment 003 §1
 * explicitly permits `@movoframework/stellar` to import the SDK directly for exactly this kind
 * of work. Constructing an auth entry would be the violation; asking a contract its decimals is
 * not (ADR-0007).
 */

import { getNetworkPassphrase, getRpcUrl, type Network, type RpcConfig } from "@movoframework/core";
import { contract } from "@stellar/stellar-sdk";

/** What a SEP-41 contract reports about itself. */
export interface AssetMetadata {
  /** Decimals declared by the contract. Read, never assumed. */
  readonly decimals: number;
  /**
   * The contract's name.
   *
   * A Stellar Asset Contract wrapping a classic asset reports `"CODE:ISSUER"`, which is what
   * lets the trustline check verify the issuer rather than trusting an asset code. A native
   * Soroban token reports whatever its author chose.
   */
  readonly name: string;
  /** Parsed from {@link name} when the contract wraps a classic asset. */
  readonly classic?: { readonly code: string; readonly issuer: string };
}

/**
 * Ask an asset contract for its decimals and name.
 *
 * @param contractId - SEP-41 contract address
 * @param network - CAIP-2 network identifier
 * @param rpc - Optional RPC overrides
 * @returns What the contract reports about itself
 */
export async function readAssetMetadata(
  contractId: string,
  network: Network,
  rpc?: RpcConfig,
): Promise<AssetMetadata> {
  const client = await contract.Client.from({
    contractId,
    networkPassphrase: getNetworkPassphrase(network),
    rpcUrl: getRpcUrl(network, rpc),
  });

  const decimalsTx = await (
    client as unknown as { decimals: () => Promise<{ result: unknown }> }
  ).decimals();
  const nameTx = await (client as unknown as { name: () => Promise<{ result: unknown }> }).name();

  const decimals = Number(decimalsTx.result);
  const name = String(nameTx.result);

  const separator = name.indexOf(":");
  const classic =
    separator > 0
      ? { code: name.slice(0, separator), issuer: name.slice(separator + 1) }
      : undefined;

  return classic === undefined ? { decimals, name } : { decimals, name, classic };
}
