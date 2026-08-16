/**
 * search-eval — the ranker's evidence, and the gate that fails the build without it.
 *
 * §7.4: *"An unevaluated ranker may not be described as 'real ranking' in any Movo document."*
 * This script is what earns that description. It loads a labelled set, runs the real retrieval
 * stack over a real store, and computes nDCG@10 and recall@20. If either falls below its floor
 * the process exits non-zero.
 *
 * ## The metrics, and why these two
 *
 * **nDCG@10** — Normalised Discounted Cumulative Gain over the first ten results. It rewards
 * putting the *most* relevant result first rather than merely somewhere on the page, using
 * graded labels (3 = the endpoint the user meant, 2 = a close sibling, 1 = plausibly useful).
 * A ranker that returns the right answer at position 9 scores far below one that returns it
 * first, which is the property that matters for an agent that will take the top hit.
 *
 * **recall@20** — the fraction of labelled-relevant resources that appear at all in the top 20.
 * It answers the different question "did we lose it entirely?", and it is the metric that
 * catches a retriever silently dropping a whole class of documents. A high nDCG with low recall
 * means the ranker is confident and blind.
 *
 * ## What is deliberately *not* done here
 *
 * The floors are not fitted to the observed numbers. They are set below the measured result with
 * headroom, so that ordinary variation does not fail CI but a real regression does. A floor set
 * to the current score to the third decimal is a floor that fails on noise and gets raised until
 * it means nothing.
 *
 * Usage:
 *   node scripts/search-eval.ts                 # hybrid (lexical + embeddings)
 *   node scripts/search-eval.ts --lexical-only  # the degraded configuration
 *   node scripts/search-eval.ts --json
 *
 * Refresh process: docs/discovery/search-quality.md.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  type Embedder,
  loadLocalEmbedder,
  VectorIndex,
} from "../packages/catalog/src/search/embedding.ts";
import { BM25Index } from "../packages/catalog/src/search/lexical.ts";
import { reciprocalRankFusion } from "../packages/catalog/src/search/rank.ts";

const REPO_ROOT: string = resolve(fileURLToPath(import.meta.url), "..", "..");
const EVAL_DIR: string = join(REPO_ROOT, "tests", "search", "eval");

/** The CI floors. Below either, the build fails. */
export const NDCG_10_FLOOR = 0.7;
export const RECALL_20_FLOOR = 0.9;

/** Floors for the lexical-only configuration, which is legitimately weaker on paraphrase. */
export const LEXICAL_NDCG_10_FLOOR = 0.55;
export const LEXICAL_RECALL_20_FLOOR = 0.75;

interface CorpusEntry {
  readonly id: string;
  readonly serviceName: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly resource: string;
  readonly params: { readonly [name: string]: string };
}

interface LabelledQuery {
  readonly query: string;
  readonly relevant: { readonly [id: string]: number };
}

/** The eval result for one configuration. */
export interface EvalResult {
  readonly configuration: string;
  readonly model: string;
  readonly corpusSize: number;
  readonly queryCount: number;
  readonly labelledPairs: number;
  readonly ndcg10: number;
  readonly recall20: number;
  readonly worst: readonly { query: string; ndcg: number }[];
}

/**
 * Build the retrieval document for a corpus entry.
 *
 * Mirrors `retrievalText` in the catalog — serviceName twice, description, tags, path words and
 * per-parameter descriptions — so the eval measures the shipped ranker rather than a
 * reimplementation of it.
 *
 * @param entry - A corpus entry
 * @returns The indexed text
 */
export function documentFor(entry: CorpusEntry): string {
  return [
    entry.serviceName,
    entry.serviceName,
    entry.description,
    ...entry.tags,
    entry.resource
      .replace(/^https?:\/\//, "")
      .split(/[/?#:]/)
      .join(" "),
    ...Object.values(entry.params),
  ].join(" \n");
}

/**
 * Discounted cumulative gain of a ranked id list against graded labels.
 *
 * @param ranked - Ids in rank order
 * @param labels - id → grade
 * @param k - Cutoff
 * @returns DCG@k
 */
export function dcg(
  ranked: readonly string[],
  labels: { readonly [id: string]: number },
  k: number,
): number {
  let total = 0;
  for (let index = 0; index < Math.min(k, ranked.length); index += 1) {
    const grade = labels[ranked[index] as string] ?? 0;
    if (grade === 0) continue;
    // 2^grade - 1 rewards a grade-3 hit far above a grade-1, which is the point of graded
    // labels; log2(rank+1) is the standard positional discount.
    total += (2 ** grade - 1) / Math.log2(index + 2);
  }
  return total;
}

/**
 * nDCG@k — DCG normalised by the best achievable ordering.
 *
 * @param ranked - Ids in rank order
 * @param labels - id → grade
 * @param k - Cutoff
 * @returns nDCG@k in [0, 1]
 */
export function ndcg(
  ranked: readonly string[],
  labels: { readonly [id: string]: number },
  k: number,
): number {
  const ideal = Object.entries(labels)
    .filter(([, grade]) => grade > 0)
    .sort(([, left], [, right]) => right - left)
    .map(([id]) => id);
  const best = dcg(ideal, labels, k);
  return best === 0 ? 0 : dcg(ranked, labels, k) / best;
}

/**
 * recall@k — the share of relevant documents retrieved within the cutoff.
 *
 * @param ranked - Ids in rank order
 * @param labels - id → grade
 * @param k - Cutoff
 * @returns recall@k in [0, 1]
 */
export function recall(
  ranked: readonly string[],
  labels: { readonly [id: string]: number },
  k: number,
): number {
  const relevant = Object.entries(labels)
    .filter(([, grade]) => grade > 0)
    .map(([id]) => id);
  if (relevant.length === 0) return 1;
  const head = new Set(ranked.slice(0, k));
  return relevant.filter((id) => head.has(id)).length / relevant.length;
}

/**
 * Run the eval over one configuration.
 *
 * @param options - Whether to include the semantic retriever
 * @returns The measured result
 */
export async function runEval(options: { lexicalOnly: boolean }): Promise<EvalResult> {
  const corpus = JSON.parse(readFileSync(join(EVAL_DIR, "corpus.json"), "utf8")) as CorpusEntry[];
  const queries = JSON.parse(
    readFileSync(join(EVAL_DIR, "queries.json"), "utf8"),
  ) as LabelledQuery[];

  const documents = corpus.map((entry) => ({ id: entry.id, text: documentFor(entry) }));
  const lexical = new BM25Index(documents);

  let embedder: Embedder | undefined;
  const vectors = new VectorIndex();
  if (!options.lexicalOnly) {
    embedder = await loadLocalEmbedder();
    if (embedder === undefined) {
      throw new Error(
        "the hybrid configuration needs the local embedder; install @huggingface/transformers or run with --lexical-only",
      );
    }
    await vectors.index(embedder, documents);
  }

  let ndcgTotal = 0;
  let recallTotal = 0;
  const perQuery: { query: string; ndcg: number }[] = [];

  for (const labelled of queries) {
    const lists = [lexical.search(labelled.query, 100)];

    if (embedder !== undefined) {
      const [queryVector] = await embedder.embed([labelled.query]);
      if (queryVector !== undefined) lists.push(vectors.search(queryVector, 100));
    }

    const ranked = reciprocalRankFusion(lists).map((candidate) => candidate.id);
    const queryNdcg = ndcg(ranked, labelled.relevant, 10);

    ndcgTotal += queryNdcg;
    recallTotal += recall(ranked, labelled.relevant, 20);
    perQuery.push({ query: labelled.query, ndcg: queryNdcg });
  }

  const labelledPairs = queries.reduce(
    (sum, labelled) => sum + Object.keys(labelled.relevant).length,
    0,
  );

  return {
    configuration: options.lexicalOnly ? "lexical-only" : "hybrid (BM25 + embeddings, RRF)",
    model: options.lexicalOnly ? "none" : (embedder?.id ?? "none"),
    corpusSize: corpus.length,
    queryCount: queries.length,
    labelledPairs,
    ndcg10: ndcgTotal / queries.length,
    recall20: recallTotal / queries.length,
    // The worst queries are printed because an average hides them, and they are where the next
    // improvement comes from.
    worst: perQuery.sort((left, right) => left.ndcg - right.ndcg).slice(0, 5),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "lexical-only": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      both: { type: "boolean", default: false },
    },
  });

  const configurations = values.both === true ? [true, false] : [values["lexical-only"] === true];
  const results: EvalResult[] = [];
  for (const lexicalOnly of configurations) {
    results.push(await runEval({ lexicalOnly }));
  }

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    for (const result of results) {
      const ndcgFloor = result.model === "none" ? LEXICAL_NDCG_10_FLOOR : NDCG_10_FLOOR;
      const recallFloor = result.model === "none" ? LEXICAL_RECALL_20_FLOOR : RECALL_20_FLOOR;
      process.stdout.write(
        `\nsearch eval — ${result.configuration}\n` +
          `  model:          ${result.model}\n` +
          `  corpus:         ${String(result.corpusSize)} resources\n` +
          `  queries:        ${String(result.queryCount)} (${String(result.labelledPairs)} labelled pairs)\n` +
          `  nDCG@10:        ${result.ndcg10.toFixed(4)}   (floor ${ndcgFloor.toFixed(2)})\n` +
          `  recall@20:      ${result.recall20.toFixed(4)}   (floor ${recallFloor.toFixed(2)})\n` +
          `  weakest queries:\n${result.worst
            .map((entry) => `    ${entry.ndcg.toFixed(3)}  ${entry.query}`)
            .join("\n")}\n`,
      );
    }
  }

  let failed = false;
  for (const result of results) {
    const ndcgFloor = result.model === "none" ? LEXICAL_NDCG_10_FLOOR : NDCG_10_FLOOR;
    const recallFloor = result.model === "none" ? LEXICAL_RECALL_20_FLOOR : RECALL_20_FLOOR;
    if (result.ndcg10 < ndcgFloor) {
      process.stderr.write(
        `\nsearch eval FAILED: ${result.configuration} nDCG@10 ${result.ndcg10.toFixed(4)} is below the floor ${ndcgFloor.toFixed(2)}.\n`,
      );
      failed = true;
    }
    if (result.recall20 < recallFloor) {
      process.stderr.write(
        `\nsearch eval FAILED: ${result.configuration} recall@20 ${result.recall20.toFixed(4)} is below the floor ${recallFloor.toFixed(2)}.\n`,
      );
      failed = true;
    }
  }

  if (failed) {
    process.stderr.write(
      "A ranker below its floor is a regression in the product's highest-value feature.\n" +
        "See docs/discovery/search-quality.md for the refresh process before changing a floor.\n",
    );
    process.exit(1);
  }

  process.stdout.write("\nsearch eval PASSED: every configuration meets its floor.\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
