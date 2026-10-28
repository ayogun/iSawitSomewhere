# Testing Strategy

See [acceptance](acceptance-criteria.md), [tasks](tasks.md), [search](search.md).
Tests default to synthetic data and zero external calls. No private history fixtures.

## Layers

- Unit: JSON/CSV structure, BOM/quoting/newlines, timestamps/calendar validity, missing/invalid
  fields, safe issue messages, input limits, canonical URL identity, token URLs, domain
  mismatch, repeat import/no-op, max-not-sum counts, millisecond visits, metadata-only updates.
- Search unit: injected UTC date grammar, conflicting hints, soft boosts vs hard filters,
  both retriever constraints, native RRF shape, safe evidence grounding and honest labels,
  unrecognized explanation fields null rather than invented.
- Security unit: injected DNS/HTTP transport, no requests before approval, private/mapped
  IPs, mixed DNS sets, pinned connection, redirect approval/path checks, robots fail-closed,
  rate limits, decompressed body cap, MIME/auth/anti-bot failures, no executable DOM content.
- Workflow/repository: expiring tickets, mutations/busy barrier, interrupted pending work,
  partial item failures, conflicts, retries, delete vs in-flight writer and consent reuse.
- Live Elastic: isolated test prefix only, version/endpoint, actual semantic ingest/query,
  RRF/explain/highlights, any-visit date arrays, partial updates and repeat-import behavior.
- Browser: functional import preview/consent/results/debug/delete, honest missing setup,
  keyboard/focus, synthetic-only screenshots 360/768/1440px, no overflow/overlap. Mocked
  contract UI tests are distinct from live Elastic retrieval evidence.

## Retrieval Corpus and Gates

Approximately 60 original synthetic pages, >=100 known visits: Browser Use and browser
automation, unrelated agents, AWS outages, Warsaw apartments/balconies, local Mac LLMs,
Elastic hybrid search, distractors. Public-looking URLs are illustrative, text/visits synthetic.
No scraping required for seeding. Freeze test anchor 2026-10-25; demo seed uses dates relative
to current time. A separate generated 10,000-page corpus supports performance testing.

30 labeled queries split in advance: 12 tuning, 18 holdout including negatives. Store IDs,
expected relevants and source/time expectations. Evaluate lexical, semantic and hybrid on
identical data/filters/clock. Holdout positive Recall@5 >=0.85; report MRR@10 and nDCG@10.
Hybrid must improve top-k vs lexical on >=2 paraphrase cases without failing exact-title cases.
No confident false positives on negatives; V1 possible-match labels need no fabricated threshold.

Required goldens: Browser Use top3 for `AI agent that controls a browser`; a GitHub/browser
page top3 for `GitHub browser AI thing I saw recently`; semantic paraphrase top3; source/time
influence without excluding mismatched hints; old visit still satisfies old-time hard filter
even after a recent revisit; unrelated query yields no or explicitly uncertain matches.

Warm p95 targets in [product](product.md) require 100 measured real queries, model/version/
region/corpus/hardware recorded. Never claim mock timings or skipped live tests as evidence.

## Commands

`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`,
`npm run test:retrieval`, `npm run test:e2e`, `npm run build`.
Live commands require explicit credentials and consent; absent credentials produce a clear
blocked/nonzero result. Run the smallest relevant test immediately after each substantive edit.
CI runs offline gates; optional live workflow is manually triggered and synthetic-only.