import type { FacilitatorStellarSigner, Network } from "@movoframework/core";
import { describe, expect, it } from "vitest";
import { SignerPool } from "./signer-pool.js";

const NETWORK: Network = "stellar:testnet";

function signer(address: string): FacilitatorStellarSigner {
  return {
    address,
    signAuthEntry: async () => ({ signedAuthEntry: "", signerAddress: address }),
    signTransaction: async () => ({ signedTxXdr: "", signerAddress: address }),
  } as unknown as FacilitatorStellarSigner;
}

const ADDRESSES = ["GAAA", "GBBB", "GCCC"];

function pool(options: {
  floorXlm?: number;
  balances?: { readonly [address: string]: string };
  fail?: boolean;
  now?: () => number;
  cacheMs?: number;
  acquireTimeoutMs?: number;
}): SignerPool {
  return new SignerPool({
    network: NETWORK,
    signers: ADDRESSES.map(signer),
    floorXlm: options.floorXlm ?? 5,
    balanceCacheMs: options.cacheMs ?? 30_000,
    readBalance: async (address) => {
      if (options.fail === true) throw new Error("horizon unreachable");
      return options.balances?.[address] ?? "100.0000000";
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

describe("acquisition — the channel-account mechanism", () => {
  it("spreads consecutive acquisitions across every account", async () => {
    const subject = pool({});
    const leased = [await subject.acquire(), await subject.acquire(), await subject.acquire()];

    expect(new Set(leased.map((lease) => lease?.address)).size).toBe(3);
  });

  it("never hands the same account to two live settlements", async () => {
    // THE property AC6.8 depends on, and the one the first design got wrong. Measured on
    // testnet: with N sponsors, N concurrent settlements all succeed and the N+1st fails,
    // because two settlements reading one account read the same sequence number. Spreading
    // load across accounts distributes those collisions; only exclusivity prevents them.
    const subject = pool({});
    const held = [await subject.acquire(), await subject.acquire(), await subject.acquire()];

    for (const address of ADDRESSES) expect(subject.loadOf(address)).toBe(1);
    for (const lease of held) lease?.release();
  });

  it("queues a fourth settlement rather than over-subscribing an account", async () => {
    const subject = pool({});
    const held = [await subject.acquire(), await subject.acquire(), await subject.acquire()];

    let granted: string | undefined;
    const queued = subject.acquire().then((lease) => {
      granted = lease?.address;
      return lease;
    });

    // Nothing is free, so the fourth caller waits instead of receiving a busy account.
    await Promise.resolve();
    expect(granted).toBeUndefined();
    expect(subject.waitingCount).toBe(1);

    held[1]?.release();
    const lease = await queued;

    expect(lease?.address).toBe(ADDRESSES[1]);
    expect(subject.waitingCount).toBe(0);
    lease?.release();
    held[0]?.release();
    held[2]?.release();
  });

  it("hands a released account straight to the longest-waiting caller", async () => {
    const subject = pool({});
    const held = [await subject.acquire(), await subject.acquire(), await subject.acquire()];

    const first = subject.acquire();
    const second = subject.acquire();
    await Promise.resolve();
    expect(subject.waitingCount).toBe(2);

    held[0]?.release();
    const firstLease = await first;

    // The reservation transfers rather than being dropped and re-contended for, so a caller
    // that arrived later cannot overtake one already queued.
    expect(firstLease?.address).toBe(ADDRESSES[0]);
    expect(subject.loadOf(ADDRESSES[0] as string)).toBe(1);

    firstLease?.release();
    (await second)?.release();
    held[1]?.release();
    held[2]?.release();
  });

  it("gives up after the acquire timeout rather than hanging the caller", async () => {
    const subject = new SignerPool({
      network: NETWORK,
      signers: [signer("GAAA")],
      floorXlm: 1,
      balanceCacheMs: 1,
      acquireTimeoutMs: 20,
      readBalance: async () => "10",
    });

    const held = await subject.acquire();
    // A bounded wait: sponsor exhaustion becomes a rejection with a reason, not a hung socket.
    expect(await subject.acquire()).toBeUndefined();
    held?.release();
  });

  it("returns the account to the pool on release, and release is idempotent", async () => {
    const subject = pool({});
    const lease = await subject.acquire();
    expect(subject.loadOf(ADDRESSES[0] as string)).toBe(1);

    lease?.release();
    lease?.release();
    expect(subject.loadOf(ADDRESSES[0] as string)).toBe(0);
  });

  it("honours a raised per-signer limit, for a future network that permits one", async () => {
    const subject = new SignerPool({
      network: NETWORK,
      signers: [signer("GAAA")],
      floorXlm: 1,
      balanceCacheMs: 1,
      maxInFlightPerSigner: 2,
      readBalance: async () => "10",
    });

    const a = await subject.acquire();
    const b = await subject.acquire();

    expect(a?.address).toBe("GAAA");
    expect(b?.address).toBe("GAAA");
    expect(subject.loadOf("GAAA")).toBe(2);
    a?.release();
    b?.release();
  });

  it("hands back nothing when the pool is empty", async () => {
    const empty = new SignerPool({
      network: NETWORK,
      signers: [],
      floorXlm: 5,
      balanceCacheMs: 1,
      readBalance: async () => "0",
    });

    expect(await empty.acquire()).toBeUndefined();
  });
});

describe("select — the callback upstream calls", () => {
  it("honours the leased address when upstream offers it", () => {
    const subject = pool({});
    expect(subject.select(ADDRESSES[1], ADDRESSES)).toBe(ADDRESSES[1]);
  });

  it("falls back to least-in-flight when no lease is bound", async () => {
    const subject = pool({});
    const held = await subject.acquire();

    expect(subject.select(undefined, ADDRESSES)).not.toBe(held?.address);
    held?.release();
  });

  it("ignores a leased address upstream is not willing to use", () => {
    // Defensive: a lease naming an account the scheme does not hold would otherwise produce a
    // signer-selection failure at settle time rather than a working settlement.
    const subject = pool({});
    expect(subject.select("GZZZ", ADDRESSES)).toBe(ADDRESSES[0]);
  });
});

describe("health — the readiness input for AC6.9", () => {
  it("reports healthy when every sponsor is above the floor", async () => {
    const health = await pool({ floorXlm: 5 }).health();

    expect(health.healthy).toBe(true);
    expect(health.signers).toHaveLength(3);
    expect(health.signers.every((entry) => entry.aboveFloor)).toBe(true);
  });

  it("reports unhealthy when one sponsor falls below the floor", async () => {
    const health = await pool({
      floorXlm: 5,
      balances: { GBBB: "1.2000000" },
    }).health();

    expect(health.healthy).toBe(false);
    expect(health.signers.find((entry) => entry.address === "GBBB")?.aboveFloor).toBe(false);
    // The other two are still fine; readiness fails on the pool, not on every member.
    expect(health.signers.filter((entry) => entry.aboveFloor)).toHaveLength(2);
  });

  it("treats an unreadable balance as unhealthy rather than as a pass", async () => {
    // A plausible fake is worse than a missing implementation (spec v2 §A.2 rule 4). An
    // unknown balance defaulting to healthy would let an unfunded sponsor keep taking
    // settlements it cannot pay for, and nothing would signal it.
    const health = await pool({ fail: true }).health();

    expect(health.healthy).toBe(false);
    expect(health.signers.every((entry) => entry.balanceXlm === undefined)).toBe(true);
    expect(health.signers[0]?.error).toContain("horizon unreachable");
  });

  it("treats a balance exactly at the floor as sufficient", async () => {
    const health = await pool({ floorXlm: 5, balances: { GAAA: "5.0000000" } }).health();
    expect(health.signers.find((entry) => entry.address === "GAAA")?.aboveFloor).toBe(true);
  });

  it("reports in-flight load alongside the balance", async () => {
    const subject = pool({});
    const lease = await subject.acquire();
    const health = await subject.health();

    expect(health.signers.find((entry) => entry.address === lease?.address)?.inFlight).toBe(1);
    lease?.release();
  });
});

describe("balance caching", () => {
  it("serves a cached reading inside the window and re-reads outside it", async () => {
    let reads = 0;
    let clock = 0;
    const subject = new SignerPool({
      network: NETWORK,
      signers: [signer("GAAA")],
      floorXlm: 1,
      balanceCacheMs: 1_000,
      now: () => clock,
      readBalance: async () => {
        reads += 1;
        return "10";
      },
    });

    await subject.health();
    await subject.health();
    expect(reads).toBe(1);

    clock = 2_000;
    await subject.health();
    expect(reads).toBe(2);
  });

  it("re-reads immediately after an explicit invalidation, as a top-up requires", async () => {
    let reads = 0;
    const subject = new SignerPool({
      network: NETWORK,
      signers: [signer("GAAA")],
      floorXlm: 1,
      balanceCacheMs: 60_000,
      readBalance: async () => {
        reads += 1;
        return "10";
      },
    });

    await subject.health();
    subject.invalidateBalances();
    await subject.health();

    expect(reads).toBe(2);
  });
});
