/**
 * Semantic retrieval, and the honest fallback when it is unavailable.
 *
 * ## The model, and why this one
 *
 * `Xenova/all-MiniLM-L6-v2` running locally through `@huggingface/transformers`. Both the
 * library (Apache-2.0) and the model weights (Apache-2.0) are OSI-permissive, which is the
 * §25.7 requirement: *prefer a permissively licensed local model so self-hosters are not forced
 * onto a paid API*. It produces 384-dimension normalised vectors and needs no API key, no
 * account and no network at query time once cached.
 *
 * Measured before it was adopted rather than assumed — cosine similarity of
 * `"current weather forecast api"` against `"realtime meteorological conditions"` is **0.49**,
 * against `"stock ticker prices"` **0.22**. That gap is the entire reason the semantic half
 * earns its place: no lexical index scores those two phrases as related, because they share no
 * terms.
 *
 * **One licence caveat, stated rather than buried.** The library pulls `sharp` transitively for
 * image pipelines, and its Windows binary is `Apache-2.0 AND LGPL-3.0-or-later`. The repository
 * licence gate warns on LGPL rather than failing it, and the text-embedding path never loads
 * the image pipeline — but "we do not call it" is a weaker guarantee than "it is not there", so
 * it is documented in `docs/discovery/search-quality.md` for an operator to judge.
 *
 * ## Why it is optional, and what happens when it is absent
 *
 * The dependency is a peer, loaded lazily. A self-hoster who wants a small install gets a
 * lexical-only catalog; one who wants semantic search installs the peer. Either way the
 * behaviour is honest: with no embedder, search returns `partialResults: true`, which is
 * precisely the degraded-retriever signal §7.4 asks for rather than a silent quality drop.
 *
 * **The published nDCG@10 is measured with embeddings on.** A number produced by one
 * configuration and quoted for another would be a claim, not a measurement, so
 * `search-quality.md` reports both configurations separately.
 */

/** Turns text into a normalised vector. */
export interface Embedder {
  /** A stable identifier for the model, recorded alongside eval numbers. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/** The model this repository evaluates against and defaults to. */
export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * Cosine similarity of two normalised vectors.
 *
 * A plain dot product, because the pipeline normalises. Guarded anyway: an un-normalised vector
 * reaching here would silently produce scores above 1 and quietly distort fusion.
 *
 * @param left - First vector
 * @param right - Second vector
 * @returns Similarity in [-1, 1]
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * Load the local embedder, or report why it is unavailable.
 *
 * Never throws. A catalog whose constructor fails because an optional model could not be
 * downloaded is a catalog that stops serving `/discovery/resources` — a hard failure caused by
 * an optional feature, which is the wrong trade for a service whose value is being cheap to
 * self-host.
 *
 * @param model - Model identifier
 * @returns The embedder, or undefined when the peer dependency or the weights are unavailable
 */
export async function loadLocalEmbedder(
  model: string = DEFAULT_EMBEDDING_MODEL,
): Promise<Embedder | undefined> {
  try {
    const transformers = (await import(/* @vite-ignore */ "@huggingface/transformers")) as {
      pipeline: (
        task: string,
        model: string,
      ) => Promise<
        (
          texts: readonly string[],
          options: { pooling: string; normalize: boolean },
        ) => Promise<{ tolist(): number[][] }>
      >;
    };

    const extractor = await transformers.pipeline("feature-extraction", model);

    return {
      id: model,
      dimensions: 384,
      embed: async (texts) => {
        if (texts.length === 0) return [];
        const output = await extractor([...texts], { pooling: "mean", normalize: true });
        return output.tolist();
      },
    };
  } catch {
    return undefined;
  }
}

/** An in-memory vector index. */
export class VectorIndex {
  private readonly vectors: Map<string, readonly number[]> = new Map();

  /** Documents indexed. */
  get size(): number {
    return this.vectors.size;
  }

  /**
   * Embed and store a batch of documents.
   *
   * @param embedder - The model
   * @param documents - Listing texts
   */
  async index(
    embedder: Embedder,
    documents: readonly { id: string; text: string }[],
  ): Promise<void> {
    if (documents.length === 0) return;
    // Batched, because a per-document call pays the pipeline's fixed cost once per listing and
    // makes indexing a thousand listings take minutes instead of seconds.
    const BATCH = 32;
    for (let start = 0; start < documents.length; start += BATCH) {
      const slice = documents.slice(start, start + BATCH);
      const vectors = await embedder.embed(slice.map((document) => document.text));
      for (const [offset, document] of slice.entries()) {
        const vector = vectors[offset];
        if (vector !== undefined) this.vectors.set(document.id, vector);
      }
    }
  }

  /**
   * Rank documents by similarity to a query vector.
   *
   * @param queryVector - The embedded query
   * @param limit - Maximum candidates
   * @returns Candidates ordered by descending similarity
   */
  search(queryVector: readonly number[], limit: number): { id: string; score: number }[] {
    return [...this.vectors.entries()]
      .map(([id, vector]) => ({ id, score: cosineSimilarity(queryVector, vector) }))
      .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1))
      .slice(0, limit);
  }
}
