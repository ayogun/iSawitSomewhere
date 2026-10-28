# Retrieval Specification

See [data model](data-model.md), [API](api.md), [testing](testing.md).

## Deterministic Query Understanding

No LLM. Extract aliases GitHub -> github.com, Elastic -> elastic.co,
AWS -> aws.amazon.com and explicit hostnames. Source hints are soft and may be wrong.
Multiple conflicting source hints remain ambiguous with no domain boost.
Hard domain/date restrictions come only from explicit user controls.

Use one injected UTC clock per query. Supported time phrases:

| Phrase | Inclusive lower / exclusive upper |
| --- | --- |
| recently, past month | now-30d / now+1ms |
| a few weeks ago | now-42d / now-14d |
| a few months ago | now-180d / now-60d |
| last year | previous January 1 / current January 1 |
| N days ago | target-2d / target+2d |
| N weeks ago | target-7d / target+7d |
| N months ago | calendar-relative target-30d / target+30d |

Prefer longest phrase; multiple conflicting time hints apply no inferred time boost.
Remove recognized clue spans and the documented memory scaffolding (`I saw`, `I think`,
`probably`, `that thing`, `where`, `sometime`, `I read`) only. Preserve other meaning.
If no meaningful subject remains, request a subject rather than `match_all`.
Do not claim unrecognized dates were interpreted.

## Elasticsearch Pipeline

1. Validate the query (3..1,000 characters), dataset, mode and explicit filters.
2. Parse concept/domain/time locally without network inference or an LLM.
3. Hybrid constructs two standard retrievers; lexical and semantic modes use only their
   respective retriever. Apply the same explicit domain and `visited_at` range filters.
   Date-array ranges match **any known visit**, not just the last.
4. Lexical: BM25 `multi_match`, best_fields, `title^4`, `description^2`, `content`, `url_search`.
5. Semantic: `match` on `semantic_text` with explicit ELSER on EIS endpoint from mapping.
6. Wrap each content query in `function_score`: multiply by 1.25 for the inferred exact
   domain, 1.15 for any visit in inferred time range. Identity otherwise. These modifiers
   adjust child rankings, never admit metadata-only documents or act as hard filters.
7. Hybrid uses Elasticsearch native RRF: `rank_constant=60`, `rank_window_size=100`.
   Single modes execute their standard retriever directly. Fetch <=30 hits in each mode.
   Return <=10 in Elastic order after evidence safety checks. No application-side reranking.
8. Retrieve allowlisted fields, lexical highlights, semantic fragments, `explain=true`.
   Bound execution to 10 seconds including one possible lexical fallback.

No default recency/popularity bias, pagination, cross-encoder or arbitrary BM25/vector sum.
The UI offers Keyword (lexical/BM25), Semantic (ELSER) and Hybrid (default). Changing mode
preserves the query/dataset/filters, clears stale results and requires explicit resubmission;
it does not trigger inference automatically. The same builders are used by evaluation scripts.
If inference fails in hybrid mode, one BM25 retry is allowed within the deadline and the
response explicitly reports lexical-only. Explicit semantic requests never silently switch
modes; intentional keyword mode must not be described as a semantic outage. Setup/permission
failures are not hidden as empty results. Compare rankings/evidence, not raw cross-mode scores.

## Evidence and Uncertainty

Quote real indexed title/description/content/semantic fragments. Validate quoted fragments
against indexed strings, and render as escaped text, never trusted highlight HTML.
An excerpt without a matching highlight is labeled an indexed excerpt. Domain/time badges
require a real matching hostname/timestamp. Do not infer factual features from a score.

All V1 results are labeled `Possible match` until live calibration justifies stronger labels.
Empty retrieval says no matches; returned candidates use the neutral `Possible matches.`
heading. The legacy `no_confident_matches` API status records insufficient lexical overlap
for compatibility, not calibrated semantic confidence; it must not produce a confidence
claim in the UI. Semantic-only candidates are not discarded merely for lacking lexical
overlap. No confidence percentages or invented pages.
Do not use RRF score/rank/gap as an absolute relevance cutoff. A semantic threshold can
be added only after tuning/holdout evaluation and a model/version-specific spec update.

## Developer View

Show actual parsed clues, time anchor, hard filters, requested window, returned candidate
count, mode/stages, ES `took` and server latency. Raw BM25/semantic scores are incomparable.
From the actual RRF explanation show child rank, adjusted score, reciprocal rank contribution,
final score, and metadata multipliers where available. Raw content scores are null unless
unambiguously present in that actual explanation. Never claim an additive metadata final score.
Unsupported explanation structures retain raw explanation and null extracted fields.
Detailed scores/DSL are local response-only, not logs or persistent telemetry.

## Official References

- https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text
- https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-setup-configuration
- https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-search-retrieval
- https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever

Pin `.elser-2-elastic`; changing defaults across versions must not silently change this product.