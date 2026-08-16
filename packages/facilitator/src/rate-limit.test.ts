import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("admits up to the limit and refuses the next request", () => {
    const limiter = new RateLimiter({ windowMs: 1_000, now: () => 0 });

    expect(limiter.consume("key:a", 3).allowed).toBe(true);
    expect(limiter.consume("key:a", 3).allowed).toBe(true);
    expect(limiter.consume("key:a", 3).allowed).toBe(true);
    expect(limiter.consume("key:a", 3).allowed).toBe(false);
  });

  it("reports remaining budget and a usable Retry-After", () => {
    let clock = 0;
    const limiter = new RateLimiter({ windowMs: 10_000, now: () => clock });

    expect(limiter.consume("key:a", 5).remaining).toBe(4);
    clock = 4_000;
    const decision = limiter.consume("key:a", 5);

    expect(decision.remaining).toBe(3);
    expect(decision.retryAfterSeconds).toBe(6);
  });

  it("keeps buckets independent, so one caller cannot exhaust another's budget", () => {
    const limiter = new RateLimiter({ windowMs: 1_000, now: () => 0 });

    expect(limiter.consume("key:a", 1).allowed).toBe(true);
    expect(limiter.consume("key:a", 1).allowed).toBe(false);
    expect(limiter.consume("ip:203.0.113.4", 1).allowed).toBe(true);
  });

  it("opens a new window once the old one elapses", () => {
    let clock = 0;
    const limiter = new RateLimiter({ windowMs: 1_000, now: () => clock });

    expect(limiter.consume("key:a", 1).allowed).toBe(true);
    expect(limiter.consume("key:a", 1).allowed).toBe(false);

    clock = 1_001;
    expect(limiter.consume("key:a", 1).allowed).toBe(true);
  });

  it("refuses everything at a limit of zero", () => {
    const limiter = new RateLimiter({ windowMs: 1_000, now: () => 0 });
    expect(limiter.consume("key:a", 0).allowed).toBe(false);
  });

  it("bounds its own memory rather than growing under a spoofed-source flood", () => {
    // The limiter must not become the outage it exists to prevent.
    const limiter = new RateLimiter({ windowMs: 60_000, now: () => 0, maxBuckets: 4 });
    for (let index = 0; index < 20; index += 1) limiter.consume(`ip:${index}`, 10);

    expect(limiter.size).toBeLessThanOrEqual(4);
  });

  it("forgets every bucket on reset", () => {
    const limiter = new RateLimiter({ windowMs: 1_000, now: () => 0 });
    limiter.consume("key:a", 1);
    limiter.reset();

    expect(limiter.size).toBe(0);
    expect(limiter.consume("key:a", 1).allowed).toBe(true);
  });
});
