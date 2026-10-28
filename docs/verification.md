# Verification Record

2026-10-25. Source/offline evidence is distinct from live external acceptance.

## Verified Locally

- Ten specifications written/reviewed before application code, internal links checked.
- TypeScript route generation/compilation and ESLint.
- Latest local suite: 131 unit tests across 7 files passed; 8 Playwright browser tests
  passed during initial implementation. Typecheck and lint pass after the heading/demo changes.
- The separate five-page semantic showcase passes normalization, synthetic labeling,
  unique identity, relative-visit and query-leakage checks. Its seed command refuses to
  proceed without Cloud consent; the original 60-page / 101-visit sample is unchanged.
- Normal Demo preview and default seeding now include all 65 synthetic pages / 106 visits.
  A direct API regression verifies the preview counts without repository access. Evaluation
  continues to use the unchanged original corpus, not the combined user-facing demo.
- Isolated browser checks at 360/768/1440px verify five fixture-derived example buttons,
  query filling without automatic submission, no examples in My history, neutral candidate
  headings and the genuine empty state. Legacy word-overlap statuses remain API-compatible.
  All APIs were intercepted, captures were visually inspected, and no overflow/page errors
  were found. No Cloud calls, reindexing or personal-history changes were made for this fix.
- Mode selector regressions cover Hybrid defaults, supported API modes, invalid-mode
  rejection, correct BM25/ELSER/RRF queries, stage/window accuracy, and no hidden fallback
  for an explicit Semantic request. Existing evaluation-script mode overrides still work.
- Isolated browser checks at 360/768/1440px exercised all three modes, preserved query,
  dataset/domain/date filters, verified explicit submission and actual result-mode labels,
  and found no horizontal overflow. Synthetic screenshots were visually inspected. All
  API responses were intercepted; no private history or paid inference was used for these
  checks. A reusable browser regression was added; the full browser suite was not rerun.
- Development-session regressions verify cached workflow methods refresh without discarding
  a live preview, and safe application errors remain recognizable across module reloads.
  A development-only boolean probe reproduced the stale-error condition and confirmed
  the repair on the running app; temporary health fields were removed afterward.
- Safari/Takeout and recognized JSON wrappers are covered by synthetic regressions for
  explicit timestamp units, precision, title requirements, ambiguity and ignored redirect
  metadata. The actual multipart API previews mixed valid/untitled Safari rows without
  repository access. An isolated synthetic browser check verifies warnings and consent.
- The user-supplied Safari export was validated locally with aggregate-only output. No
  browsing contents were printed, copied into fixtures, indexed or sent to Elastic. The
  private root export filename is excluded from Git; private counts are not recorded here.
- Large-upload regression: generated >28 MiB JSON/CSV accepted, >50 MiB rejected,
  UTF-8 byte accounting and the 100,000-record guard checked. The actual multipart API
  handler accepted a synthetic 28 MiB preview without repository/Cloud access and discarded it.
- Import previews retain ten-minute idle expiry while valid batches renew it; fake-clock
  tests cover imports lasting longer than ten minutes and cancellation during a batch.
- An isolated browser confirmed the 50 MiB / 100,000-record label with Cloud requests
  intercepted. No private history was opened or uploaded for these tests.
- Schema/providers/URL/merge, query/evidence/trace, repository and workflow tests.
- Real socket pinning/Host preservation against controlled local HTTP fixtures, decompression
  caps, MIME/redirect checks, stalled-body cancellation and Retry-After guards.
- Browser: real local synthetic preview, real JSON/CSV validation, cross-origin rejection.
- Explicitly mocked UI contracts: results/debug at 360/768/1440px, domain consent, fetch
  outcomes and typed deletion. These are not live Elasticsearch claims.
- Node 24 LTS optimized build: Next.js 16.4.2 / Elastic JS client 9.2.0.
- Missing-config CLI exits blocked without external calls.
- Desktop/mobile screenshots inspected for loaded assets, wrapping and overflow.

## Verified Live Cloud Capabilities

2026-10-25: the user configured their private local environment and approved the bounded
synthetic preflight. It completed with `capabilities_passed` and exit code 0 against
Elasticsearch **9.5.5**, using `.elser-2-elastic` (Elastic-hosted sparse ELSER).

- Version/endpoint access, actual semantic indexing/query, BM25 and native RRF passed.
- Actual explanations/highlights, identical reimport, Bulk embedding preservation and
  historical-visit filtering after a revisit passed.
- Temporary probe indices were deleted and absence verified. App/personal history indices
  were not used for the probe; no private browsing history was imported.
- The running local application reports Cloud configured, and its shared page was reloaded.
- Fixed Elasticsearch 9.5.5's outer `sum of:` explanation wrapper by finding the actual
  nested RRF block, with regressions covering both wrapped and older response formats.
- Preflight now reports safe stage-specific capability failures instead of opaque assertions.
- The shareable environment template was restored to placeholders; credentials remain in
  the private local environment and were not printed or added to documentation.
- A later read-only autoscaling-warning investigation found a green cluster, substantial
  reported free disk, and no app-index write blocks. No deployment capacity/billing settings,
  write blocks or watermarks were changed, and no indexed data was deleted or reimported
  by that investigation. A capacity-ceiling notice alone does not prove resource exhaustion.

## Verified Synthetic Showcase

2026-10-25: seeded exactly five original full-text, visibly labeled synthetic articles into
the demo dataset using `npm run seed -- --semantic-showcase --consent`. No personal-history
writes, website fetches, deletion, deployment changes or scoring changes were performed.

Fifteen actual application-API requests compared the same five paraphrases in Keyword,
Semantic and Hybrid with no filters. All responses reported the requested execution mode;
no degraded Keyword result was counted as a semantic success.

| Synthetic Topic | Keyword Target Rank | Semantic Target Rank | Hybrid Target Rank |
| --- | --- | --- | --- |
| Upstairs noise | Not returned | 1 | 1 |
| Scorched cookware | Not returned | 1 | 1 |
| Forgotten credentials | Not returned | 1 | 1 |
| Holiday plant care | Not returned | 1 | 3 |
| Unwanted email | Not returned | 1 | 1 |

Keyword returned two other pages for the plant-care query and zero results for the other
four queries. Ranks are within the app's ten displayed results on the current demo index.
See the [exact queries and seed instructions](../README.md#synthetic-semantic-showcase).
Queries are separate metadata, never copied into indexed article fields. No fixture match
or local ranking override exists in the application search path.

This is a constructed vocabulary-gap illustration, not a representative relevance study,
evidence of personal-history performance or a replacement for the declared holdout gates.
The original evaluation corpus and judgments remain unchanged. The UI now uses the neutral
`Possible matches.` heading whenever candidates exist, including legacy word-overlap-based
uncertainty statuses; it does not infer semantic confidence from lexical overlap.

## Remaining Acceptance Gates

| Gate | Status | Verification |
| --- | --- | --- |
| Golden top-three / holdout Recall@5 >=0.85 | Unverified | retrieval evaluation |
| Two conceptual improvements over lexical | Unverified | evaluation |
| Full application deletion workflow against Cloud | Not exercised with app data | separate explicit synthetic workflow |
| Normal/debug end-to-end p95 targets | Unmeasured | deployed benchmark |
| EIS region, retention and cost | Operator review | Cloud console/service terms |

Do not describe the MVP as fully accepted until these gates have real evidence. There is
no mocked search backend in the application. No larger relevance/performance benchmark was
run as part of this configuration check. Cloud probes and regression fixtures use synthetic
history; the later Safari compatibility check read the supplied file only for local counts.
Credentials were consumed only from local configuration, not chat. No deployment was provisioned or
resized by the assistant; the approved probe used the user's existing deployment/inference.