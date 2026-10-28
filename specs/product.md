# I Saw It Somewhere

Status: implementation contract, 2026-10-25. Changes to behavior must update these specifications.

## Product

A search engine for things you remember seeing but cannot find again.
**Search the Internet you've already seen.** The primary experience is a usable search
screen, not a chat application or an Elasticsearch administration console.

The user provides browsing history, then searches a vague memory such as "the GitHub
agent that controlled a browser a few months ago". Only indexed, previously imported
pages can be returned. Every explanation must be supported by indexed evidence.

## Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-01 | Intentionally load visibly labeled synthetic history without private data. |
| FR-02 | Preview JSON/CSV uploads locally, validate records, explicitly consent to cloud indexing. |
| FR-03 | Normalize URLs, merge repeated imports idempotently, preserve known visit timestamps. |
| FR-04 | Optionally enrich public pages after per-domain approval; failure never blocks import. |
| FR-05 | Elasticsearch performs BM25, ELSER semantic search, and native hybrid RRF. |
| FR-06 | Use deterministic source/time clues as soft boosts; explicit UI filters are hard filters. |
| FR-07 | Display real URLs, visits, excerpts, and grounded reasons; never invent a match. |
| FR-08 | Optionally inspect actual retrieval stages, timings, ranks, scores, and query DSL. |
| FR-09 | Delete all app-owned history, enrichment, previews, and consent state. |
| FR-10 | Distinguish missing setup, empty results, uncertain matches, and degraded lexical search. |
| FR-11 | Record latency/counts/error codes without sensitive query or history logs. |

## Nonfunctional Requirements

- NFR-01: one localhost Node application and Elastic Cloud Hosted 9.2+; no other service.
- NFR-02: at most 50 MiB and 100,000 rows per upload; bounded memory, text and network work.
- NFR-03: warm normal search p95 target <=3 seconds, debug <=6 seconds, measured over
  100 queries/10,000 synthetic pages on a documented deployment. These are unverified
  targets until measured. Search has a 10-second deadline.
- NFR-04: keyboard and screen-reader usable, WCAG AA contrast, no overflow at 360/768/1440px.
- NFR-05: secrets remain server-side; TLS to Cloud; no content analytics or local persistent history.
- NFR-06: repeatable synthetic tests and setup without committing private browsing data.

## Scope

Included: file import, safe optional public HTML enrichment, search, evidence, diagnostics,
deletion, sample data, evaluation tooling, documentation. No LLM is required or implemented.

Excluded: accounts, public SaaS, extension, social APIs, feed capture, crawling links,
headless rendering, PDFs, durable background jobs, multiple server processes, cross-device sync.
A clicked social URL can be history; an item merely seen while scrolling cannot.

Roadmap only: V2 Chrome extension; V3 bookmarks/saved items; V4 optional platform importers;
V5 cross-device personal memory. Do not implement these in V1.

## Specification Map

[Architecture](architecture.md), [data model](data-model.md), [search](search.md),
[API](api.md), [UI](ui.md), [privacy](privacy.md), [testing](testing.md),
[acceptance criteria](acceptance-criteria.md), [tasks](tasks.md).