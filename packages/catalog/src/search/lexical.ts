/**
 * BM25 lexical retrieval.
 *
 * **Why BM25 rather than a `LIKE` query.** §28 names a keyword `LIKE` query dressed as ranking
 * as the plausible fake for this milestone, and the difference is not stylistic. `LIKE` is a
 * filter: a document either contains the substring or it does not, so every match ties and the
 * order that comes back is whatever the store felt like. BM25 is a *ranking function* — it
 * scores term rarity (IDF), saturates repeated terms so a document that says "weather" fifty
 * times does not beat one that says it twice in the right places, and normalises for document
 * length so a long listing does not win by having more words. Those three properties are what
 * make the top of the list mean something, and they are exactly what the eval harness measures.
 *
 * **Why it is implemented here rather than delegated to the store.** SQLite has FTS5 and
 * Postgres has `tsvector`, and both are excellent — but they score differently, tokenise
 * differently, and stem differently. AC7.10 requires the same suite to pass against both, and
 * a ranker whose results depend on which store is underneath is a ranker whose published
 * nDCG@10 is true of one deployment and unmeasured on the other. One implementation over the
 * store's `documents()` keeps the published number honest for every deployment.
 *
 * This is not a protocol primitive and there is no upstream equivalent — `@x402/extensions`
 * validates declarations and does not rank — so implementing it is composition, not
 * reimplementation.
 *
 * Standard parameters: `k1 = 1.2` (term-frequency saturation), `b = 0.75` (length
 * normalisation). Untuned on purpose — tuning two constants against 100 labelled pairs overfits
 * the eval set, and the fusion step is where the real gains are.
 */

/** One scored candidate. */
export interface ScoredId {
  readonly id: string;
  readonly score: number;
}

const K1 = 1.2;
const B = 0.75;

/**
 * Split text into lowercase alphanumeric terms.
 *
 * Deliberately simple and shared by indexing and querying — the one property a tokeniser must
 * have is that both sides agree, and a clever tokeniser used on one side only is worse than a
 * plain one used on both. No stemming: "weather" and "weathers" stay distinct, and the
 * embedding retriever is what closes that gap.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
}

/** An in-memory BM25 index over the catalog's documents. */
export class BM25Index {
  private readonly postings: Map<string, Map<string, number>> = new Map();
  private readonly lengths: Map<string, number> = new Map();
  private averageLength = 0;

  /**
   * @param documents - Every listing's retrieval text
   */
  constructor(documents: readonly { id: string; text: string }[]) {
    let total = 0;
    for (const document of documents) {
      const terms = tokenize(document.text);
      this.lengths.set(document.id, terms.length);
      total += terms.length;

      for (const term of terms) {
        let posting = this.postings.get(term);
        if (posting === undefined) {
          posting = new Map();
          this.postings.set(term, posting);
        }
        posting.set(document.id, (posting.get(document.id) ?? 0) + 1);
      }
    }
    this.averageLength = documents.length === 0 ? 0 : total / documents.length;
  }

  /** Documents indexed. */
  get size(): number {
    return this.lengths.size;
  }

  /**
   * Score every document containing at least one query term.
   *
   * @param query - The natural-language query
   * @param limit - Maximum candidates to return
   * @returns Candidates ordered by descending score
   */
  search(query: string, limit: number): ScoredId[] {
    const documentCount = this.lengths.size;
    if (documentCount === 0) return [];

    const scores = new Map<string, number>();

    for (const term of new Set(tokenize(query))) {
      const posting = this.postings.get(term);
      if (posting === undefined) continue;

      // Robertson/Sparck-Jones IDF with the +1 that keeps it non-negative for terms appearing
      // in more than half the corpus. Without it a common term subtracts score, and a document
      // matching a common term plus a rare one can rank below one matching only the rare term.
      const idf = Math.log(1 + (documentCount - posting.size + 0.5) / (posting.size + 0.5));

      for (const [id, frequency] of posting) {
        const length = this.lengths.get(id) ?? 0;
        const normalisation =
          this.averageLength === 0 ? 1 : 1 - B + B * (length / this.averageLength);
        const saturated = (frequency * (K1 + 1)) / (frequency + K1 * normalisation);
        scores.set(id, (scores.get(id) ?? 0) + idf * saturated);
      }
    }

    return (
      [...scores.entries()]
        .map(([id, score]) => ({ id, score }))
        // Ties broken by id so ordering is deterministic across runs and across stores — a
        // ranker whose output depends on Map iteration order cannot be evaluated reproducibly.
        .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1))
        .slice(0, limit)
    );
  }
}
