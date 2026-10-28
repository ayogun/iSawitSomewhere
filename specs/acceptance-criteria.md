# Acceptance Criteria and Traceability

See [requirements](product.md), [testing](testing.md), [tasks](tasks.md).
Checked boxes require actual evidence, not planned functionality.

| ID | Acceptance criterion | Requirements | Tasks / verification |
| --- | --- | --- | --- |
| AC-01 | Ten consistent cross-linked specs reviewed before app code. | All | T01 / spec audit |
| AC-02 | Fresh local setup and intentional synthetic seed without private files. | FR-01, NFR-01/06 | T02/03/11 / README + preflight |
| AC-03 | JSON/CSV preview, safe row errors, valid-only and cloud consent. | FR-02 | T04/06/09/10 / unit + browser |
| AC-04 | Repeat exports preserve distinct visits without count inflation; historical date ranges work. | FR-03/06 | T04/06/07 / merge + live tests |
| AC-05 | Domain approval counts, SSRF/robots/limits enforced, fetch failures nonblocking. | FR-04, NFR-02/05 | T05/09/10 / transport + browser |
| AC-06 | ES actually runs BM25, sparse semantics, metadata, filters, native RRF. | FR-05/06 | T03/07 / live capability + quality |
| AC-07 | Golden top3, holdout Recall@5 >=0.85 and honest mode comparison. | FR-05 | T08 / live evaluation |
| AC-08 | Results/quotes/clues grounded, weak/empty/outage states honest. | FR-07/10 | T07/10 / unit + browser |
| AC-09 | Actual debug stages/ranks/scores; unavailable fields null, no invented percentages. | FR-08 | T03/07/10 / trace fixtures + live |
| AC-10 | No secret/history logs or client keys; Cloud/EIS/site disclosure. | FR-11, NFR-05 | T02/09/11 / tests + audit |
| AC-11 | Delete clears app indices and memory, drains writers, no late recreation. | FR-09 | T06/09/10 / race + live tests |
| AC-12 | Consumer UI, keyboard/mobile/desktop, clear demo distinction, measured latency. | NFR-03/04 | T10/11 / Playwright + benchmark |
| AC-13 | Complete README with actual screenshot, setup, privacy, limits, Elastic/LLM rationale, roadmap. | NFR-06 | T11 / documentation audit |

Live Cloud criteria remain **unverified** until real configuration is available. Missing
credentials do not prevent source/offline testing, but do prevent a fully accepted MVP.