/**
 * Per-caller metering.
 *
 * Counts what an operator needs to answer three questions: who is using this service, what
 * did it cost, and what is failing. It records counters and nothing else — no payloads, no
 * addresses, no keys, no reasons that could carry caller data. The identity recorded for a
 * bearer caller is the key's `id`, never its secret; an unauthenticated caller is recorded as
 * a single aggregate bucket rather than by IP, because per-IP retention is a data-protection
 * decision an operator should make deliberately rather than inherit from a default.
 *
 * `accruedFeeStroops` is the operator's own fee schedule accumulating
 * (`FacilitatorFeeConfig.settleFeeStroops` × successful settlements), which is how the RFP's
 * "mainnet fee must be configurable" requirement becomes visible in operation. It defaults to
 * zero and it never appears in a protocol response.
 */

/** The anonymous bucket used for callers with no bearer key. */
export const ANONYMOUS_CALLER: string = "anonymous";

/** One caller's counters. */
export interface CallerMeter {
  readonly caller: string;
  readonly verifyTotal: number;
  readonly verifyInvalid: number;
  readonly settleTotal: number;
  readonly settleFailed: number;
  readonly rejectedTotal: number;
  readonly accruedFeeStroops: number;
}

/** Which endpoint an observation belongs to. */
export type MeteredOperation = "verify" | "settle" | "supported";

interface MutableMeter {
  verifyTotal: number;
  verifyInvalid: number;
  settleTotal: number;
  settleFailed: number;
  rejectedTotal: number;
  accruedFeeStroops: number;
}

/** Accumulates per-caller counters in memory. */
export class Metering {
  private readonly meters: Map<string, MutableMeter> = new Map();
  private readonly settleFeeStroops: number;

  /**
   * @param settleFeeStroops - The operator's fee per successful settlement; zero by default
   */
  constructor(settleFeeStroops: number) {
    this.settleFeeStroops = settleFeeStroops;
  }

  /**
   * Record a completed protocol call.
   *
   * @param caller - Bearer key id, or {@link ANONYMOUS_CALLER}
   * @param operation - Which endpoint served the call
   * @param succeeded - Whether the payment verified or settled successfully
   */
  record(caller: string, operation: MeteredOperation, succeeded: boolean): void {
    const meter = this.meterFor(caller);
    if (operation === "verify") {
      meter.verifyTotal += 1;
      if (!succeeded) meter.verifyInvalid += 1;
      return;
    }
    if (operation === "settle") {
      meter.settleTotal += 1;
      if (succeeded) meter.accruedFeeStroops += this.settleFeeStroops;
      else meter.settleFailed += 1;
    }
  }

  /**
   * Record a request rejected before it reached the payment scheme.
   *
   * Counted separately from a failed verification because they are different operational
   * signals: one is callers sending bad requests, the other is buyers sending bad payments.
   *
   * @param caller - Bearer key id, or {@link ANONYMOUS_CALLER}
   */
  recordRejection(caller: string): void {
    this.meterFor(caller).rejectedTotal += 1;
  }

  /** Every caller's counters, for `/metrics`. */
  snapshot(): readonly CallerMeter[] {
    return [...this.meters.entries()].map(([caller, meter]) => ({ caller, ...meter }));
  }

  private meterFor(caller: string): MutableMeter {
    const existing = this.meters.get(caller);
    if (existing !== undefined) return existing;
    const created: MutableMeter = {
      verifyTotal: 0,
      verifyInvalid: 0,
      settleTotal: 0,
      settleFailed: 0,
      rejectedTotal: 0,
      accruedFeeStroops: 0,
    };
    this.meters.set(caller, created);
    return created;
  }
}
