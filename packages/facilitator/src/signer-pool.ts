/**
 * The signer pool — channel accounts, in-flight accounting and balance floors.
 *
 * **What problem this solves, precisely.** Stellar serialises transactions per source account
 * by sequence number. `ExactStellarScheme.settle()` rebuilds the buyer's transaction with a
 * facilitator account as its source (read from the installed implementation), so every
 * settlement consumes one sequence number from one sponsor. Two settlements dispatched
 * concurrently against the same sponsor race for the same sequence number and one of them
 * fails. Agent traffic is bursty by nature, which makes this the throughput ceiling long
 * before RPC or CPU is (spec §8.2). Several independent sponsor accounts — channel accounts —
 * is the mechanism that lifts it, and AC6.8 is the measurement: 200 concurrent settlements,
 * zero sequence-number failures.
 *
 * **What this pool is not.** It is not a second signer-selection mechanism. Upstream's
 * `ExactStellarScheme` already selects round-robin and already accepts a `selectSigner`
 * callback; `docs/SPIKE_REPORT.md` finding 4 recorded that and asked for M6 to be re-scoped
 * against it. So the pool *supplies* that callback and adds only what upstream has no way to
 * know: which accounts are currently busy, and whether each can still pay a fee.
 *
 * ## Why the pool queues instead of spreading
 *
 * This was measured on testnet, and the first design was wrong.
 *
 * The obvious pool spreads work across accounts by picking the least-loaded one. With five
 * funded sponsors and five concurrent settlements it is flawless. At ten it settles exactly
 * five and fails five; at two hundred it settles five and fails a hundred and ninety-five. The
 * ratio is the tell: **one settlement per account succeeds, and every other settlement
 * dispatched against that account in the same window fails.**
 *
 * The cause is that spreading is not serialising. `ExactStellarScheme.settle()` calls
 * `server.getAccount(address)` to read the sponsor's current sequence number and builds a
 * transaction from it. Two settlements that read the same account at the same moment read the
 * *same* sequence number, and the network accepts exactly one of them. Least-loaded selection
 * distributes the collisions evenly across the pool; it does not prevent a single one.
 *
 * So an account is a mutex, not a weight. `acquire()` hands out at most
 * {@link SignerPoolOptions.maxInFlightPerSigner} lease per account — one by default — and
 * *waits* when every account is busy, rather than over-subscribing one. Throughput becomes
 * `pool size × (1 / settlement latency)` and excess concurrency queues instead of failing.
 * That is what makes AC6.8 pass on its substance rather than on a reason string that happens
 * not to contain the word "sequence".
 *
 * **The consequence an operator must know**, and the runbook says so: pool size is the
 * concurrency ceiling. Sustained load beyond it shows up as latency, then as `acquire`
 * timeouts reported as `signer_pool_exhausted` — never as a lost payment. Adding sponsors is
 * the remedy, and it is a configuration change.
 */

import { type FacilitatorStellarSigner, getHorizonClient, type Network } from "@movoframework/core";

/** A signer's operational state, as reported to `/ready` and `/metrics`. */
export interface SignerHealth {
  /** The sponsor's public address. Never a secret. */
  readonly address: string;
  /** Native XLM balance as a decimal string, or `undefined` when it could not be read. */
  readonly balanceXlm: string | undefined;
  /** True when the balance was read and is at or above the configured floor. */
  readonly aboveFloor: boolean;
  /** Settlements currently dispatched against this signer. */
  readonly inFlight: number;
  /** Why the reading failed, when it did. Present only alongside an undefined balance. */
  readonly error?: string;
}

/** The pool's aggregate state. */
export interface SignerPoolHealth {
  readonly network: Network;
  readonly floorXlm: number;
  readonly signers: readonly SignerHealth[];
  /**
   * True when every signer's balance was read and every one is at or above the floor.
   *
   * Conservative on purpose, in both directions. A signer whose balance could not be read is
   * not healthy — an unknown balance is not a passing balance, and treating it as one is the
   * "plausible fake" failure mode spec v2 §A.2 rule 4 names. And *any* signer below the floor
   * fails readiness rather than only all of them, because AC6.9 is written that way and
   * because a pool that keeps serving with a dead member is a pool that will hand that member
   * a settlement.
   */
  readonly healthy: boolean;
}

/** A reservation held for the duration of one settlement. */
export interface SignerLease {
  /** The address upstream must use as the transaction source for this settlement. */
  readonly address: string;
  /** Release the reservation. Idempotent; safe to call from a `finally`. */
  release(): void;
}

/** Reads a native XLM balance for an address. Injectable so tests need no network. */
export type BalanceReader = (address: string, network: Network) => Promise<string>;

/** Construction options for {@link SignerPool}. */
export interface SignerPoolOptions {
  readonly network: Network;
  readonly signers: readonly FacilitatorStellarSigner[];
  readonly floorXlm: number;
  /** How long a balance reading stays fresh. */
  readonly balanceCacheMs: number;
  /** Overrides the Horizon-backed reader. Tests supply a fake; production does not. */
  readonly readBalance?: BalanceReader;
  /** Clock injection, so cache-expiry behaviour is testable without waiting. */
  readonly now?: () => number;
  /**
   * Concurrent settlements permitted against a single account. Defaults to 1.
   *
   * One is the only value that is correct against Stellar today, for the sequence-number
   * reason in this module's header. It is configurable rather than hard-coded because the
   * constraint belongs to the network and not to Movo: if a future protocol change or a
   * different sequencing strategy lifts it, an operator should be able to raise this without
   * a Movo release. Raising it on today's network re-introduces the collisions.
   */
  readonly maxInFlightPerSigner?: number;
  /**
   * How long `acquire()` waits for a free account before giving up. Defaults to 60s.
   *
   * A bounded wait, because an unbounded one turns sponsor exhaustion into hung connections.
   * On expiry the caller gets `signer_pool_exhausted` — a rejection with a reason, which is
   * the outcome AC6.5 requires and an operator can alert on.
   */
  readonly acquireTimeoutMs?: number;
}

/** Default concurrent settlements per account: one, because an account is a mutex. */
export const DEFAULT_MAX_IN_FLIGHT_PER_SIGNER: number = 1;

/** Default ceiling on how long a settlement waits for a free sponsor. */
export const DEFAULT_ACQUIRE_TIMEOUT_MS: number = 60_000;

interface BalanceCacheEntry {
  readonly readAtMs: number;
  readonly balanceXlm: string | undefined;
  readonly error?: string;
}

/**
 * Read a native XLM balance from Horizon.
 *
 * Horizon rather than Soroban RPC: the native balance of a classic account is a Horizon
 * account record, and `getHorizonClient` is already re-exported through the narrow waist for
 * exactly this class of read. This performs no transaction, signs nothing and pays no fee —
 * the same diagnostics-not-protocol boundary spec v2 §A.1 draws for `@movoframework/stellar`'s
 * contract reads.
 *
 * @param address - The sponsor account to read
 * @param network - The CAIP-2 network it lives on
 * @returns The native balance as a decimal string
 */
export async function readNativeBalance(address: string, network: Network): Promise<string> {
  const horizon = getHorizonClient(network);
  const account = await horizon.loadAccount(address);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  return native?.balance ?? "0";
}

/**
 * A pool of sponsoring signers with in-flight accounting and balance floors.
 */
export class SignerPool {
  readonly network: Network;
  readonly floorXlm: number;

  private readonly byAddress: Map<string, FacilitatorStellarSigner>;
  private readonly inFlight: Map<string, number>;
  private readonly balances: Map<string, BalanceCacheEntry>;
  private readonly balanceCacheMs: number;
  private readonly readBalance: BalanceReader;
  private readonly now: () => number;
  private readonly maxInFlightPerSigner: number;
  private readonly acquireTimeoutMs: number;
  private readonly waiting: ((address: string) => void)[] = [];

  /**
   * @param options - Network, signers, floor, concurrency limits and injectable seams
   */
  constructor(options: SignerPoolOptions) {
    this.network = options.network;
    this.floorXlm = options.floorXlm;
    this.balanceCacheMs = options.balanceCacheMs;
    this.readBalance = options.readBalance ?? readNativeBalance;
    this.now = options.now ?? Date.now;
    this.maxInFlightPerSigner = options.maxInFlightPerSigner ?? DEFAULT_MAX_IN_FLIGHT_PER_SIGNER;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;

    this.byAddress = new Map(options.signers.map((signer) => [signer.address, signer]));
    this.inFlight = new Map(options.signers.map((signer) => [signer.address, 0]));
    this.balances = new Map();
  }

  /** Every signer in the pool, in configuration order. */
  get signers(): readonly FacilitatorStellarSigner[] {
    return [...this.byAddress.values()];
  }

  /** Every sponsor address, for `/supported`'s signers block and for logs. */
  get addresses(): readonly string[] {
    return [...this.byAddress.keys()];
  }

  /** Settlements waiting for a free account. Surfaced on `/metrics` as queue depth. */
  get waitingCount(): number {
    return this.waiting.length;
  }

  /**
   * Reserve an account for one settlement, waiting if every account is busy.
   *
   * Resolves `undefined` in two cases, both of which the handler turns into a
   * `signer_pool_exhausted` rejection rather than a thrown exception (AC6.5): the pool is
   * empty, or the wait exceeded `acquireTimeoutMs`.
   *
   * @returns A lease that must be released, or `undefined` when none became available
   */
  async acquire(): Promise<SignerLease | undefined> {
    if (this.byAddress.size === 0) return undefined;

    const free = this.freeAddress();
    if (free !== undefined) {
      this.inFlight.set(free, (this.inFlight.get(free) ?? 0) + 1);
      return this.leaseFor(free);
    }

    // Every account is busy. Queue, and let a `release()` hand this waiter an account
    // directly — the reservation is transferred rather than dropped and re-contended for, so
    // a queued settlement cannot be starved by a newly arriving one.
    const address = await new Promise<string | undefined>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const index = this.waiting.indexOf(handoff);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(undefined);
      }, this.acquireTimeoutMs);
      // `unref` so a pending acquire timer cannot hold the process open at shutdown.
      timer.unref?.();

      const handoff = (granted: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(granted);
      };
      this.waiting.push(handoff);
    });

    return address === undefined ? undefined : this.leaseFor(address);
  }

  private leaseFor(address: string): SignerLease {
    let released = false;
    return {
      address,
      release: (): void => {
        if (released) return;
        released = true;

        const next = this.waiting.shift();
        // Transfer the reservation rather than decrementing and re-incrementing: between
        // those two steps the account would look free, and a concurrent `acquire()` could
        // take it while a waiter that has been queued longer is still parked.
        if (next !== undefined) {
          next(address);
          return;
        }
        this.inFlight.set(address, Math.max(0, (this.inFlight.get(address) ?? 1) - 1));
      },
    };
  }

  private freeAddress(): string | undefined {
    // Insertion order makes selection deterministic and reproducible in a test. With a limit
    // of one in flight per account this is "the first idle account"; at a higher limit it is
    // still least-loaded-first, because the map is scanned in order and the first account
    // under the limit wins only after earlier ones are at it.
    let chosen: string | undefined;
    let chosenLoad = this.maxInFlightPerSigner;
    for (const [address, load] of this.inFlight) {
      if (load < chosenLoad) {
        chosen = address;
        chosenLoad = load;
      }
    }
    return chosen;
  }

  /** Settlements currently in flight against one address. Exposed for tests and metrics. */
  loadOf(address: string): number {
    return this.inFlight.get(address) ?? 0;
  }

  /**
   * Choose a signer address when upstream asks, honouring a lease when one is bound.
   *
   * `ExactStellarScheme` calls its `selectSigner` callback synchronously inside `settle()`,
   * with no way to pass per-call context. `createFacilitator` binds the acquired lease to the
   * call with `AsyncLocalStorage` and this method reads it; when nothing is bound — a direct
   * in-process caller, or a settlement not routed through the handler — it falls back to
   * least-in-flight so the pool is never bypassed silently.
   *
   * @param preferred - The leased address, when a lease is in scope
   * @param offered - The addresses upstream is willing to use
   * @returns The address upstream should build the transaction against
   */
  select(preferred: string | undefined, offered: readonly string[]): string {
    if (preferred !== undefined && offered.includes(preferred)) return preferred;

    let chosen = offered[0] ?? preferred ?? "";
    let chosenLoad = Number.POSITIVE_INFINITY;
    for (const address of offered) {
      const load = this.inFlight.get(address) ?? 0;
      if (load < chosenLoad) {
        chosen = address;
        chosenLoad = load;
      }
    }
    return chosen;
  }

  /**
   * Read every signer's balance and compare it against the floor.
   *
   * Readings are cached for `balanceCacheMs`. Readiness must reflect current reality, but
   * `/ready` is polled by load balancers at a rate that would otherwise turn a health check
   * into a Horizon load test.
   *
   * @returns The pool's aggregate health
   */
  async health(): Promise<SignerPoolHealth> {
    const signers = await Promise.all(
      this.addresses.map(async (address): Promise<SignerHealth> => {
        const entry = await this.balanceOf(address);
        const balanceXlm = entry.balanceXlm;
        return {
          address,
          balanceXlm,
          aboveFloor: balanceXlm !== undefined && Number(balanceXlm) >= this.floorXlm,
          inFlight: this.loadOf(address),
          ...(entry.error === undefined ? {} : { error: entry.error }),
        };
      }),
    );

    return {
      network: this.network,
      floorXlm: this.floorXlm,
      signers,
      healthy: signers.length > 0 && signers.every((signer) => signer.aboveFloor),
    };
  }

  /** Drop cached balances so the next `health()` reads through. Used after a top-up. */
  invalidateBalances(): void {
    this.balances.clear();
  }

  private async balanceOf(address: string): Promise<BalanceCacheEntry> {
    const cached = this.balances.get(address);
    if (cached !== undefined && this.now() - cached.readAtMs < this.balanceCacheMs) {
      return cached;
    }

    let entry: BalanceCacheEntry;
    try {
      entry = { readAtMs: this.now(), balanceXlm: await this.readBalance(address, this.network) };
    } catch (cause) {
      // A failed read is recorded as a failed read, not as a zero and not as a pass. Both of
      // those are lies with operational consequences: one pages an on-call engineer for a
      // funded account, the other lets an unfunded one keep taking settlements.
      entry = {
        readAtMs: this.now(),
        balanceXlm: undefined,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
    this.balances.set(address, entry);
    return entry;
  }
}
