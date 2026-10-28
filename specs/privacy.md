# Privacy and Security

Normative for [architecture](architecture.md), [import](data-model.md), [API](api.md).

## Data Boundaries

| Boundary | Data and permission |
| --- | --- |
| File -> local preview RAM | Explicit user file selection; no network/persistent file copy. |
| Commit -> Elastic Cloud | Safe URLs, titles, content, visits and derived embeddings; explicit cloud consent. |
| Elastic -> Elastic Inference Service | Title/description/plain content and query concepts for ELSER; disclosed before commit/search. |
| Optional fetch -> approved site | URL, app user-agent and network IP; per-domain approval, no browser cookies. |

No external LLM provider or analytics. Pin ELSER on EIS; never silently change model/provider.
EIS may process outside deployment region: user must review current service region/retention
terms. Do not promise no retention, no training or regional colocation without verified terms.
Cloud inference is billable, including synthetic samples/probes. Initial page load is inert.
Imported content and public pages may still be sensitive; pattern matching is not proof of safety.

## Fetch Policy

Only HTTP/HTTPS on standard ports, approved exact hostname, no credentials/tokens/signed
URLs or account/login/settings/auth/password paths (decoded path-segment checks). No file,
browser internal, localhost/local names, nonpublic IPs, proxies, metadata endpoints or userinfo.
Validate all A/AAAA answers with IP classification; reject mixed public/private sets.
Pin validated IP in socket lookup while preserving hostname TLS/SNI/Host. A DNS precheck
followed by ordinary unpinned fetch is insufficient. Disable automatic redirects/proxy env.

Every redirect (max 3) repeats URL, approval, DNS, IP, path and robots checks. Never follow
unapproved hostnames. HTML canonical hints do not grant consent or trigger new fetches.
Robots requests themselves use the same safe approved transport. User-agent identifies app.
Honor Allow/Disallow/crawl-delay; 404/410 mean no rules; errors/auth/429/5xx/malformed policy
fail closed. No override. Cache <=5 minutes in RAM. Never bypass auth, paywalls, robots,
rate limits or anti-bot pages; stop on 401/403/429 and do not automatically retry.
Honor Retry-After for later manual requests in the current process (60 seconds if absent);
cooldowns are ephemeral and lost on restart, so users must still respect site restrictions.

Conservative bounds: global concurrency <=2, per-origin <=1, >=1 second spacing (or
greater crawl delay), robots <=256 KiB/5s, HTML <=2 MiB decompressed/12s redirect chain,
batch <=90s. Enforce streaming/decompressed limits, HTML MIME checks and abort signals.
Avoid headless rendering, cookies, auth headers, form submission, external DOM resources.
Only readable main text/title/description/validated canonical hint is retained, <=100k text
with truncation flag. Strip forms/scripts/navigation/ads before Readability; no raw HTML
or whole-body fallback. Failed extraction preserves import. Known paywall/anti-bot signals
are skipped, never worked around; detection is best-effort, not a guarantee.

Statuses: not_requested; pending only during approved work; fetched; skipped (policy or
unapproved); failed (network/extraction). Interrupted pending work may be marked failed
when those pages are selected for a new explicit enrichment preview; never automatically
resume fetching after restart without consent. Robots/rate caches are capped at 128 origins.

## Local App and Secret Handling

Bind 127.0.0.1. One local user/process; do not deploy publicly without authentication.
Validate Host/Origin/fetch metadata, no CORS, no-store API responses, security headers/CSP.
API keys only server-side environment; `.env.example` contains placeholders, never secrets.
Ignore real imports, `.env*`, upload/data directories, private screenshots/traces/test outputs.
Least-privilege app indices; setup and runtime key guidance in README, no superuser requirement.

## Logs and Deletion

Log only random request ID, operation, duration, counts, mode/stages, safe error code.
Never log query, URL, domain, title, filename, content, raw DSL/request/Elastic error.
Debug details are ephemeral local UI response only. No localStorage/IndexedDB history.

Delete all invalidates previews/consents, aborts fetches, drains active writers, deletes
exact app indices and verifies absence. No wildcard unrelated index deletion. Do not
report success on uncertain drain/delete. Snapshots/backups/provider retention and past
public-site requests cannot be retracted by logical index deletion; document limitation.