/**
 * Fixed-window rate limiting, per bearer key and per source address.
 *
 * The RFP asks for rate limiting as a configurable control. Spec §24.8 is more specific about
 * why it exists here: on a fee-sponsoring facilitator, rate limiting is a **spend control**
 * before it is an abuse control. Every settlement this service accepts costs the operator a
 * Stellar fee from a sponsor account, so an unbounded caller is an unbounded bill, and the
 * failure mode is a drained sponsor rather than a slow endpoint.
 *
 * **Fixed window, not token bucket or sliding log.** A fixed window admits up to twice the
 * nominal rate across a window boundary, which is a real and well-known weakness. It is
 * accepted deliberately: the alternative implementations need either per-request timestamp
 * retention (unbounded memory under attack — the thing being defended against) or a
 * background refill timer (a handle that keeps a process alive and has to be closed on
 * shutdown). The burst this admits is bounded at 2× and the sponsor floor catches the
 * consequence, so the simpler structure is the safer one here.
 *
 * **In-memory, and therefore per-instance.** A multi-instance deployment gets N× the
 * configured rate. This is stated rather than hidden: `docs/operating-a-facilitator/runbook.md`
 * tells operators to divide the limit by the replica count or to put a shared limiter at the
 * ingress. A distributed limiter would add a datastore to the hot path of a service whose
 * whole value is being cheap to self-host.
 */

/** The outcome of one rate-limit consultation. */
export interface RateLimitDecision {
  /** True when the request may proceed. */
  readonly allowed: boolean;
  /** Requests still available in the current window. */
  readonly remaining: number;
  /** Seconds until the window resets — the value for a `Retry-After` header. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  startedAtMs: number;
}

/** Construction options for {@link RateLimiter}. */
export interface RateLimiterOptions {
  readonly windowMs: number;
  /** Injectable clock so window expiry is testable without waiting a minute. */
  readonly now?: () => number;
  /**
   * Cap on tracked buckets. Reached only under a spoofed-source flood; the map is cleared
   * rather than grown, because a limiter that exhausts memory has become the outage.
   */
  readonly maxBuckets?: number;
}

/** Default ceiling on distinct tracked buckets. */
export const DEFAULT_MAX_BUCKETS: number = 50_000;

/** A fixed-window rate limiter keyed by an arbitrary bucket string. */
export class RateLimiter {
  private readonly windows: Map<string, Window> = new Map();
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxBuckets: number;

  /**
   * @param options - Window length, clock and bucket ceiling
   */
  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    this.maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  }

  /**
   * Consume one unit from a bucket's budget.
   *
   * @param bucket - The bucket key, e.g. `key:abc` or `ip:203.0.113.4`
   * @param limit - Requests permitted per window for this bucket
   * @returns Whether the request is allowed, and what to tell the caller if not
   */
  consume(bucket: string, limit: number): RateLimitDecision {
    const nowMs = this.now();
    const existing = this.windows.get(bucket);

    if (existing === undefined || nowMs - existing.startedAtMs >= this.windowMs) {
      if (this.windows.size >= this.maxBuckets) this.windows.clear();
      this.windows.set(bucket, { count: 1, startedAtMs: nowMs });
      return {
        allowed: limit > 0,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    existing.count += 1;
    const elapsed = nowMs - existing.startedAtMs;
    return {
      allowed: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000)),
    };
  }

  /** Distinct buckets currently tracked. For `/metrics` and for tests. */
  get size(): number {
    return this.windows.size;
  }

  /** Forget every bucket. Used by tests and by an operator-triggered reset. */
  reset(): void {
    this.windows.clear();
  }
}
