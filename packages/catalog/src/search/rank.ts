/**
 * Fusion and the ranking signals applied after it.
 *
 * ## Reciprocal-rank fusion, and why no tuned weights
 *
 * BM25 scores and cosine similarities are not comparable. One is unbounded and depends on
 * corpus statistics; the other lives in [-1, 1]. Any attempt to add them needs a weight, and a
 * weight fitted against 100 labelled pairs is a weight fitted to 100 labelled pairs — it will
 * look excellent on the eval set and mean nothing on a real catalog.
 *
 * RRF sidesteps the problem by discarding the scores and keeping only the *ranks*:
 *
 *     score(d) = Σ_retrievers 1 / (k + rank_r(d))
 *
 * A document ranked first by either retriever scores highly; one ranked well by both scores
 * higher still. There is nothing to overfit, which is why §7.4 specifies it explicitly at this
 * data volume. `k = 60` is the value from the original RRF paper and is not tuned here.
 *
 * ## The two signals applied after fusion
 *
 * **Failure-rate demotion.** A listing whose calls fail is a bad result even when it is a
 * textually perfect match, so a listing's recent failure rate multiplies its fused score down.
 * The demotion is bounded — a listing is never removed on this signal alone, because a single
 * transient outage should not delete an endpoint from the catalog.
 *
 * **Activity, above a dust threshold.** Settlement count is a weak positive signal, applied
 * logarithmically so a popular endpoint edges out an identical unused one without letting
 * volume dominate relevance. The dust threshold is enforced at ingest rather than here — by the
 * time ranking sees `settlementCount`, sub-threshold settlements have already not been counted.
 *
 * **Ranking is never for sale.** No input to this function can be purchased, and none is
 * supplied by the seller: the two signals are the buyer's own settlements and the endpoint's
 * own failures. `docs/discovery/search-quality.md` states this as a commitment, not a
 * description.
 */

import type { ScoredId } from "./lexical.js";

/** The RRF constant from the original paper. Not tuned. */
export const RRF_K = 60;

/**
 * Fuse ranked lists by reciprocal rank.
 *
 * @param lists - One ranked list per retriever, best first
 * @returns Fused candidates, best first
 */
export function reciprocalRankFusion(lists: readonly (readonly ScoredId[])[]): ScoredId[] {
  const fused = new Map<string, number>();

  for (const list of lists) {
    for (const [index, candidate] of list.entries()) {
      const contribution = 1 / (RRF_K + index + 1);
      fused.set(candidate.id, (fused.get(candidate.id) ?? 0) + contribution);
    }
  }

  return [...fused.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
}

/** The per-listing signals ranking consults. */
export interface RankingSignals {
  readonly settlementCount: number;
  readonly failureCount: number;
}

/** Tunables for the post-fusion signals. */
export interface RankingWeights {
  /** Strongest permitted demotion. 0.4 leaves a fully-failing listing at 40% of its score. */
  readonly maxFailureDemotion: number;
  /** How much a decade of settlements is worth. */
  readonly activityBoost: number;
}

/** Defaults: demotion matters more than popularity, deliberately. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  maxFailureDemotion: 0.4,
  activityBoost: 0.08,
};

/**
 * Apply failure demotion and activity boost to fused candidates.
 *
 * @param fused - Candidates from {@link reciprocalRankFusion}
 * @param signals - Per-listing signals, keyed by id
 * @param weights - Tunables
 * @returns Re-ordered candidates
 */
export function applySignals(
  fused: readonly ScoredId[],
  signals: ReadonlyMap<string, RankingSignals>,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): ScoredId[] {
  return fused
    .map((candidate) => {
      const signal = signals.get(candidate.id);
      if (signal === undefined) return candidate;

      const attempts = signal.settlementCount + signal.failureCount;
      // No attempts means no evidence, not good evidence. A brand-new listing is neither
      // demoted nor boosted.
      const failureRate = attempts === 0 ? 0 : signal.failureCount / attempts;
      const demotion = 1 - failureRate * (1 - weights.maxFailureDemotion);
      const activity = 1 + Math.log10(1 + signal.settlementCount) * weights.activityBoost;

      return { id: candidate.id, score: candidate.score * demotion * activity };
    })
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
}

/**
 * The retrieval text for a listing.
 *
 * §7.4 names the fields: `serviceName`, `description`, `tags`, and **per-parameter
 * descriptions**. The last is the one most easily forgotten and often the most informative —
 * a weather endpoint whose description says only "returns data" may still have a `city`
 * parameter described as "IATA airport code", and that is what makes it findable.
 *
 * `serviceName` is repeated twice. That is not a hack: BM25 has no field weighting, and a name
 * match is a stronger relevance signal than a description match, so the name is given twice the
 * term frequency. It is the only weighting in the lexical half and it is stated here rather
 * than hidden in the indexer.
 *
 * @param listing - The stored listing
 * @returns Text for both retrievers
 */
export function retrievalText(listing: {
  readonly serviceName?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly resource: string;
  readonly toolName?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}): string {
  const parts: string[] = [];

  if (listing.serviceName !== undefined) parts.push(listing.serviceName, listing.serviceName);
  if (listing.description !== undefined) parts.push(listing.description);
  if (listing.tags !== undefined) parts.push(...listing.tags);
  if (listing.toolName !== undefined) parts.push(listing.toolName);

  // The path carries meaning a description sometimes omits: /weather/{city} says "weather".
  parts.push(
    listing.resource
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)
      .join(" "),
  );

  parts.push(...parameterDescriptions(listing.extensions));

  return parts.join(" \n");
}

/**
 * Pull per-parameter descriptions out of the echoed bazaar declaration.
 *
 * Walks the declared JSON Schema for `description` strings. Defensive throughout: this is
 * attacker-influenced data that has passed the integrity controls but is still arbitrary
 * nesting, and a retrieval-text builder must not be the thing that throws on it.
 *
 * @param extensions - The echoed extension payloads
 * @returns Every description string found
 */
export function parameterDescriptions(
  extensions: Readonly<Record<string, unknown>> | undefined,
): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown, depth: number): void {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    for (const [key, value] of Object.entries(node as { [key: string]: unknown })) {
      if (key === "description" && typeof value === "string" && value.length > 0) {
        found.push(value);
        continue;
      }
      walk(value, depth + 1);
    }
  }

  walk(extensions?.["bazaar"], 0);
  return found;
}
