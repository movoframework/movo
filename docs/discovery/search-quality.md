# Search quality

Search quality is a deliverable in this project, not a detail. §7.4 puts it plainly: *an
unevaluated ranker may not be described as "real ranking" in any Movo document.* This page is
what earns the description — the numbers, how they were produced, and how to reproduce them.

## Measured results

Produced by `pnpm test:search-eval`, which fails the build if either metric falls below its floor.

| Configuration | Model | nDCG@10 | recall@20 |
|---|---|---|---|
| **Hybrid** (BM25 + embeddings, RRF) | `Xenova/all-MiniLM-L6-v2` | **0.9332** | **1.0000** |
| Lexical only (degraded) | none | 0.8524 | 0.8711 |

| | Floor | Measured |
|---|---|---|
| Hybrid nDCG@10 | 0.70 | 0.9332 |
| Hybrid recall@20 | 0.90 | 1.0000 |
| Lexical nDCG@10 | 0.55 | 0.8524 |
| Lexical recall@20 | 0.75 | 0.8711 |

**Corpus:** 55 resources. **Queries:** 114. **Labelled pairs:** 169.

### What the comparison shows, and why both rows are published

The interesting number is not 0.9332 — it is the gap. Adding the semantic retriever moves
recall@20 from **0.871 to 1.000**: roughly one relevant resource in eight was not being found
*at all* by lexical retrieval within twenty results, and now none are missed. That is the known
failure mode of a lexical index — it cannot match a paraphrase that shares no terms — and it is
the entire justification for paying the cost of an embedding model.

Publishing only the hybrid number would let a reader assume the lexical half was doing the work.
Publishing only the aggregate would hide that the degraded configuration is genuinely weaker,
which is what `partialResults: true` is warning a caller about.

### The weakest queries, published rather than hidden

An average hides its tail, and the tail is where the next improvement is. In the hybrid
configuration two queries score **0.000** — the intended resource is not in the top ten at all:

| nDCG@10 | Query | Intended |
|---|---|---|
| 0.000 | "how long will it take to cycle there" | `routing-directions` |
| 0.000 | "is this review positive or negative" | `sentiment` |
| 0.131 | "convert dollars to euros" | `forex-rate` |
| 0.333 | "describe what is in this picture" | `image-caption` |
| 0.515 | "extract text from an image" | `ocr` |

These are all the same shape: a query phrased as a *user's intent* against a listing written as
a *technical description*. "Is this review positive or negative" never says "sentiment", and
MiniLM at 384 dimensions does not bridge it. They are recorded here because the honest response
is a better retrieval document — sellers describing what their endpoint is *for*, not only what
it returns — rather than a relabelled eval set.

## Method

**Hybrid retrieval**, because either half alone fails a known way:

- **Lexical — BM25** over `serviceName` (weighted ×2), `description`, `tags`, path words, and
  **per-parameter descriptions**. Parameters are the field most often forgotten and often the
  most informative: an endpoint described only as "returns data" may still have a `city`
  parameter described as "IATA airport code". `k1 = 1.2`, `b = 0.75`, untuned.
- **Semantic — embeddings** over the same synthesised document, cosine similarity.
- **Fusion — reciprocal rank fusion**, `k = 60`, from the original paper. RRF discards the
  scores and keeps only the ranks, which is why it needs no weight: BM25 scores and cosine
  similarities are not comparable, and any weight fitted against 169 labelled pairs would be
  fitted *to* those 169 pairs.

**Signals applied after fusion:**

- **Failure-rate demotion** — a listing whose calls fail is a bad result even when it matches
  textually. Bounded at 40% so a transient outage cannot erase an endpoint.
- **Activity, above a dust threshold** — settlement count boosts logarithmically. Sub-threshold
  settlements are **not counted at ingest**, so apparent traffic cannot be bought a stroop at a
  time.

**Metrics.** nDCG@10 uses graded labels (3 = the endpoint the user meant, 2 = a close sibling,
1 = plausibly useful) with gain `2^grade − 1` and the standard `log2(rank+1)` discount — it
rewards ranking the best answer *first*, which is what matters to an agent that takes the top
hit. recall@20 answers the different question "did we lose it entirely?", and catches a
retriever silently dropping a whole class of documents. A high nDCG with low recall means the
ranker is confident and blind.

## Ranking is never for sale

There is no paid placement, no promoted listing, and no operator override. The only inputs to
ranking are:

1. the text the seller wrote (matched, never weighted by who wrote it),
2. settlements that actually happened, above the dust threshold,
3. failures that actually happened.

None can be purchased and none is supplied by the seller as a ranking input. This is a
commitment, not a description of the current implementation — a future version that sold
placement would be a different product, and this paragraph would have to be deleted rather than
amended.

## The embedding model, and its licence

`Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`, run **locally**. 384 dimensions, no
API key, no account, no network at query time once cached. §25.7 asks for a permissively
licensed local model so self-hosters are not pushed onto a paid API, and this qualifies:

| Component | Licence |
|---|---|
| `@huggingface/transformers` | Apache-2.0 |
| `Xenova/all-MiniLM-L6-v2` weights | Apache-2.0 |

**One caveat, stated rather than buried.** The library pulls `sharp` transitively for image
pipelines, and its platform binary is `Apache-2.0 AND LGPL-3.0-or-later`. The repository licence
gate warns on LGPL rather than failing it (dynamic linking from a separate work), and the
text-embedding path never loads the image pipeline — but "we do not call it" is a weaker
guarantee than "it is not present", so an operator who needs a fully LGPL-free tree should run
with `MOVO_CATALOG_EMBEDDINGS=off` and accept the lexical-only numbers above.

The dependency is **optional**. Without it the catalog runs lexical-only and search sets
`partialResults: true` — the degraded-retriever signal, rather than a silent quality drop.

## Reproducing

```bash
pnpm test:search-eval              # both configurations, fails below either floor
node scripts/search-eval.ts --json # machine-readable
node scripts/search-eval.ts --lexical-only
```

First run downloads the model (~90 MB) and takes about 30 seconds; later runs use the cache.

## Refreshing the labelled set

The eval set lives in `tests/search/eval/` — `corpus.json` (resources) and `queries.json`
(queries with graded relevance).

1. **Add queries from real traffic**, not from imagination. A query set written by the people
   who wrote the corpus tests whether the corpus is self-consistent, not whether search works.
2. **Grade honestly.** 3 = this is the endpoint the user meant; 2 = a sibling that would also
   serve; 1 = plausibly useful; omit anything irrelevant. Loose grading inflates the metric
   until it stops measuring anything, which §28 names explicitly as a way to fake this
   milestone.
3. **Keep at least 100 labelled pairs.** Below that the metric moves on single queries.
4. **Re-run and record.** Update the tables on this page in the same commit as the fixture
   change, so the published number always describes the committed set.
5. **Do not raise a floor to make CI pass.** The floors sit below the measured values with
   headroom so ordinary variation does not fail the build. A floor pinned to the current score
   fails on noise and gets raised until it means nothing. If a change drops the number, the
   change is the problem.

## Known limitations

- **Indexes are in memory**, rebuilt from `CatalogStore.documents()`. Right for a facilitator's
  own listings — thousands, not millions. The seam for outgrowing it is `documents()`; see
  `running-a-catalog.md`.
- **The eval corpus is synthetic.** It is realistic and deliberately adversarial in places
  (near-duplicate weather endpoints, an exact-product-name query), but it is not production
  traffic. The first real refresh should replace it.
- **English only.** No query in the set is non-English, and neither retriever has been measured
  on one.
