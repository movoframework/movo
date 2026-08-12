/**
 * Correlation identifiers.
 *
 * Every Movo diagnostic carries one so a 402, a verification failure and a settlement outcome
 * can be joined across the buyer's logs, the seller's logs and a facilitator's. Generated with
 * `crypto.randomUUID` (spec §10 M1, security requirements) rather than a counter or a
 * timestamp: an id that is guessable or that collides across processes is worse than none,
 * because it invites a reader to join two unrelated requests.
 */

import { randomUUID } from "node:crypto";

/**
 * Create a fresh correlation id.
 *
 * @returns A RFC 4122 v4 UUID
 */
export function newCorrelationId(): string {
  return randomUUID();
}
