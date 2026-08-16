import { type FacilitatorStellarSigner, MovoError } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEFAULT_SPONSOR_FLOOR_XLM,
  facilitatorConfigFromEnv,
  parseApiKeys,
  resolveFacilitatorConfig,
} from "./config.js";

/**
 * An external signer, of exactly the shape a KMS or HSM integration supplies.
 *
 * `FacilitatorStellarSigner` is structural — `{ address, signAuthEntry, signTransaction }` —
 * so these tests double as the demonstration that spec §24.8's "external signer injection so
 * production never needs a raw seed in an environment variable" is satisfied by construction
 * rather than by a code path that has to be written. Nothing in the configuration layer knows
 * or asks where a signature comes from.
 */
function externalSigner(address: string): FacilitatorStellarSigner {
  return {
    address,
    signAuthEntry: async () => ({ signedAuthEntry: "", signerAddress: address }),
    signTransaction: async () => ({ signedTxXdr: "", signerAddress: address }),
  } as unknown as FacilitatorStellarSigner;
}

const A = externalSigner("GA3A2SD6UVPPWQJS4PRTSXGLYAZW6SIUWNHLLJPFJUQCA56ZWANUKYYG");
const B = externalSigner("GBVMPGDRMNNJF6F27KWYG4TYMSZKG6CU7HHFNKNLLDAZW6AAAGXO6MDV");

describe("resolveFacilitatorConfig — the ordinary case", () => {
  it("resolves a testnet deployment with injected signers and no seed anywhere", () => {
    const config = resolveFacilitatorConfig({
      networks: [{ network: "stellar:testnet", signers: [A, B] }],
    });

    expect(config.networks).toHaveLength(1);
    expect(config.networks[0]?.signers).toHaveLength(2);
    expect(config.networks[0]?.sponsorFloorXlm).toBe(DEFAULT_SPONSOR_FLOOR_XLM);
    expect(config.networks[0]?.maxTransactionFeeStroops).toBe(DEFAULT_MAX_TRANSACTION_FEE_STROOPS);
    // Fee sponsorship on by default, matching upstream's own default and the reference
    // facilitator's advertised `extra.areFeesSponsored: true` for stellar:testnet.
    expect(config.networks[0]?.areFeesSponsored).toBe(true);
  });

  it("defaults to open, keyless auth — the testnet posture the RFP requires", () => {
    const config = resolveFacilitatorConfig({
      networks: [{ network: "stellar:testnet", signers: [A] }],
    });

    expect(config.auth.mode).toBe("open");
    expect(config.auth.keys).toEqual([]);
  });

  it("defaults the operator fee to zero rather than hard-coding one", () => {
    const config = resolveFacilitatorConfig({
      networks: [{ network: "stellar:testnet", signers: [A] }],
    });

    expect(config.fees.settleFeeStroops).toBe(0);
  });

  it("carries an operator fee through when one is configured", () => {
    const config = resolveFacilitatorConfig({
      networks: [{ network: "stellar:testnet", signers: [A] }],
      fees: { settleFeeStroops: 250 },
    });

    expect(config.fees.settleFeeStroops).toBe(250);
  });

  it("accepts pubnet when an RPC URL is named", () => {
    const config = resolveFacilitatorConfig({
      networks: [
        { network: "stellar:pubnet", signers: [A], rpcUrl: "https://soroban.example/rpc" },
      ],
    });

    expect(config.networks[0]?.rpcUrl).toBe("https://soroban.example/rpc");
  });
});

describe("resolveFacilitatorConfig — refusals", () => {
  it("refuses a facilitator with no networks", () => {
    expect(() => resolveFacilitatorConfig({ networks: [] })).toThrow(MovoError);
  });

  it("refuses a network with no signer, which could verify but never settle", () => {
    expect(() =>
      resolveFacilitatorConfig({ networks: [{ network: "stellar:testnet", signers: [] }] }),
    ).toThrow(/never settle/);
  });

  it("refuses a duplicated signer, which adds no throughput and breaks in-flight accounting", () => {
    expect(() =>
      resolveFacilitatorConfig({ networks: [{ network: "stellar:testnet", signers: [A, A] }] }),
    ).toThrow(/twice/);
  });

  it("refuses a duplicated network", () => {
    expect(() =>
      resolveFacilitatorConfig({
        networks: [
          { network: "stellar:testnet", signers: [A] },
          { network: "stellar:testnet", signers: [B] },
        ],
      }),
    ).toThrow(/more than once/);
  });

  it("refuses a non-Stellar network", () => {
    expect(() =>
      resolveFacilitatorConfig({ networks: [{ network: "eip155:84532", signers: [A] }] }),
    ).toThrow(/not a Stellar network/);
  });

  it("refuses pubnet without an explicit RPC URL", () => {
    // Discovering this at the first settlement means having already accepted a payment that
    // cannot be completed.
    expect(() =>
      resolveFacilitatorConfig({ networks: [{ network: "stellar:pubnet", signers: [A] }] }),
    ).toThrow(/Soroban RPC URL/);
  });

  it("refuses bearer auth with no keys, which would reject every request", () => {
    expect(() =>
      resolveFacilitatorConfig({
        networks: [{ network: "stellar:testnet", signers: [A] }],
        auth: { mode: "bearer", keys: [] },
      }),
    ).toThrow(/no keys are configured/);
  });

  it("refuses a bearer key with an empty secret", () => {
    expect(() =>
      resolveFacilitatorConfig({
        networks: [{ network: "stellar:testnet", signers: [A] }],
        auth: { mode: "bearer", keys: [{ id: "team", secret: "" }] },
      }),
    ).toThrow(/empty secret/);
  });

  it("refuses a negative sponsor floor and a non-positive fee ceiling", () => {
    expect(() =>
      resolveFacilitatorConfig({
        networks: [{ network: "stellar:testnet", signers: [A], sponsorFloorXlm: -1 }],
      }),
    ).toThrow(/non-negative/);

    expect(() =>
      resolveFacilitatorConfig({
        networks: [{ network: "stellar:testnet", signers: [A], maxTransactionFeeStroops: 0 }],
      }),
    ).toThrow(/positive integer/);
  });
});

describe("facilitatorConfigFromEnv", () => {
  it("refuses a network with no seeds", () => {
    expect(() =>
      facilitatorConfigFromEnv({ MOVO_FACILITATOR_NETWORKS: "stellar:testnet" }),
    ).toThrow(/SIGNER_SEEDS is empty/);
  });

  it("refuses a network with no environment-variable mapping", () => {
    expect(() => facilitatorConfigFromEnv({ MOVO_FACILITATOR_NETWORKS: "solana:devnet" })).toThrow(
      /no environment-variable mapping/,
    );
  });
});

describe("parseApiKeys", () => {
  it("parses id:secret and id:secret:limit", () => {
    const keys = parseApiKeys("team-a:secret-one,team-b:secret-two:1200");

    expect(keys).toEqual([
      { id: "team-a", secret: "secret-one" },
      { id: "team-b", secret: "secret-two", requestsPerWindow: 1200 },
    ]);
  });

  it("returns nothing for an absent or empty value", () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys("   ")).toEqual([]);
  });

  it("rejects a malformed entry without reproducing the credential in the message", () => {
    let message = "";
    try {
      parseApiKeys("no-secret-here");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/must be "id:secret"/);
    // The malformed value is a credential as far as anyone knows. An error message that
    // echoes it back puts it in every log that captured the failure.
    expect(message).not.toContain("no-secret-here");
  });
});
