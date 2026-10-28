# API Specification

Node runtime, loopback only, JSON with `Cache-Control: no-store`. Validate runtime inputs.
Search is POST so memories are not in browser/proxy URL logs. See [privacy](privacy.md).

Errors: `{error:{code,message,requestId,issues?}}`; no raw rejected values or stack traces.
Codes: 400 invalid request, 403 host/origin, 409 busy/stale ticket, 413 limits, 422 invalid
records/query, 429 capacity, 503 Cloud unavailable/setup, 504 deadline. A mixed valid preview
is 200 with row issues; malformed files/all invalid inputs are 422.

## Endpoints

### GET /api/health

Returns `{configured,profile,inferenceId}` without credentials/deployment URL. Configuration
is not a live capability claim. Paid capability probing is explicit CLI only.

### POST /api/imports/preview

Multipart `file` and `dataset=personal`, or JSON `{sample:true}` for synthetic demo.
Returns `{previewId,dataset,expiresAt,rowCount,validCount,invalidCount,duplicateCount,
uniqueUrls,domains:[{domain,count,eligible}],issues,warnings,samples}`.
Samples are safe normalized metadata, at most three. Counts are within-file only; preview
never contacts Cloud, resolves DNS or fetches sites. One active preview, 10-minute idle expiry.
Valid commit-batch requests renew that idle timeout before/after work, so larger active
imports can continue beyond ten minutes. Cancel/delete still discard the preview immediately.

### POST /api/imports/:id/commit

Body `{cloudConsent:true,validOnly:boolean,cursor:0}`. If preview contains invalid rows,
`validOnly:true` explicitly acknowledges partial import. No implied fetch permission.
Process <=25 grouped pages from cursor; response `{processed,persisted,unchanged,failed,
nextCursor,complete,pageIds,errors}`. Repeat batch requests are safe through canonical merge.
Page IDs returned allow later optional enrichment. Request ceiling 60 seconds. Completed
batches remain if cancelled/restarted; UI reports partial progress rather than atomic import.

### DELETE /api/imports/:id

Discards preview/approval memory. Does not delete already committed pages.

### POST /api/enrichment/preview

Body `{dataset,pageIds}` (1..100). Reads only already committed pages. Returns immutable
expiring ticket `{ticket,uniqueUrls,domains,expiresAt}` bound to dataset/URLs/data generation.
All domains initially unchecked. No website contact. More than 100 pages require another group.

### POST /api/enrichment/:ticket/run

Body `{approvedDomains:[hostname],cursor:0}`. Only ticket's exact hostnames may be approved;
server never accepts substituted URLs. Process <=5 pages/batch, <=90 seconds. Return
`{results:[{id,status,reason}],nextCursor,complete}`. Approvals remain fixed after first batch.
Replaying completed cursor returns cached outcomes. Fetch failure does not roll back import.

### POST /api/search

Body `{query,dataset,mode?,debug?,filters?:{domain?,start?,end?}}`; dataset `demo|personal`.
Mode is `hybrid|lexical|semantic`, defaults to `hybrid`, and rejects unknown values.
The UI labels `lexical` as Keyword. The response mode is the actual executed mode;
hybrid may report lexical with an explicit outage warning. Explicit semantic requests
do not silently fall back to keywords.
Date filters are UTC RFC3339, inclusive start/exclusive end. Validate start < end.
Response `{mode,status,clues,results,warnings,latencyMs,elasticTook,trace?}`.
Status `possible_matches|no_confident_matches|no_matches`. Each result has real id/title/url/
domain, latest/matching visit, known/reported counts, fetch status, quoted evidence,
matched metadata clues, possible-match label. No embeddings or full document dump.
Trace includes actual DSL/explanations only when requested, not application logs.

### GET /api/history/stats

Returns per-dataset unique page count, known timestamp count and fetch-state counts.
No history list endpoint required. If Cloud is missing, report setup state, not pretend zero.

### DELETE /api/history

Body `{confirmation:"DELETE ALL HISTORY"}`. Invalidate previews/consent, cancel fetch,
drain writers, delete the two exact app indices, verify absence, clear memory and return
`{deleted:true}`. Return error if certainty is unavailable. Never delete arbitrary indices
or share a development/evaluation prefix with user data. Cloud backup retention is external.

## Request Security

Require loopback Host (127.0.0.1/localhost/[::1]) and same-origin Origin for browser writes,
including searches and preview. CLI requests must also set the matching Origin. No CORS.
Reject cross-site fetch metadata. Bound JSON bodies (64 KiB; multipart <=50 MiB + 64 KiB framing).
History files themselves are capped at 50 MiB / 100,000 records, with matching UI,
provider validation and batch-cursor limits. Cloud writes remain <=25 pages per batch.
Do not log request bodies, raw Elastic errors or query DSL. Request IDs are random.