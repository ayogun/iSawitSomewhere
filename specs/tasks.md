# Dependency-Ordered Implementation Tasks

Source of truth: [product](product.md), [acceptance](acceptance-criteria.md).
Update status and evidence as work progresses; update specs before ambiguous behavior.

| Task | Dependencies | Deliverable / ownership | Gate | Status |
| --- | --- | --- | --- | --- |
| T01 | none | Ten specs, scope/privacy/Elastic-value review, traceability | Spec link/contract audit, AC-01 | Complete |
| T02 | T01 | Next/TS scaffold, .env.example, ignore rules, test/lint/build tooling, CI | typecheck + unit + build | Complete |
| T03 | T02, Cloud access | Synthetic capability probe: ELSER, RRF/explain, date arrays, partial updates | explicit paid preflight, remove probe index | Complete; live Elasticsearch 9.5.5 preflight passed |
| T04 | T02 | history schema/providers/URL normalization/merge; synthetic corpus/queries | focused history tests | Complete |
| T05 | T04 | replaceable secure transport/robots/readable enricher | injected and controlled HTTP tests | Complete locally |
| T06 | T03 contract, T04 | mappings/repository/import batches/stats/deletion barrier | repository/workflow tests and live preflight | Complete; repeat import, embedding preservation and probe deletion verified live |
| T07 | T03 contract, T04/06 | clues/ES query/evidence/explanation trace/fallback | query/service tests and live capability probe | Complete; live hybrid/explanations/highlights verified, quality evaluation remains T08 |
| T08 | T03/07 | tuning/holdout evaluation, mode comparison/performance report | retrieval gates AC-07/12 | Tool/judgments implemented; larger billable evaluation not run |
| T09 | T05/06/07 | secure APIs, preview consent, bounded enrichment, safe telemetry | workflow/API and real local browser tests | Complete locally |
| T10 | T01/02 contracts; final T09 | usable search/import/enrichment/debug/delete UI | responsive Playwright/keyboard | Complete; 8 browser tests passed |
| T11 | T08/09/10 | README/screenshots/security audit/full gates/local server URL | local gates and live Cloud setup | Configuration verified; relevance/performance acceptance pending |

T04 may proceed while T03 is blocked externally. T05 can proceed with mocked transport
alongside T06/T07. UI shell can start after contracts, not substitute fake retrieval for ES.
No external service provisioning or charges without explicit consent. No commit/branch requested.

2026-10-25 configuration follow-up: approved synthetic preflight passed on 9.5.5 and removed
its temporary indices. Shared app reloaded with Cloud configured. Local suite now has 78
passing unit tests. Larger quality/latency benchmarks remain a separate explicit operation.

## Review Record

2026-10-25: specifications complete enough to implement. Simplified to one Node process,
two app indices, ephemeral tickets, client-driven batches and no LLM/queue/extra database.
Retained secure optional fetching because it is explicitly required. Live Cloud/version/
license/region, explain-shape validation and retrieval/latency measurements remain external
gates. Strong confidence labels are deliberately deferred until measured calibration.

Evidence and external blockers: [verification record](../docs/verification.md).