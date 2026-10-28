# Data Model and Import

See [privacy](privacy.md), [API](api.md), [search](search.md).

## Canonical Input

Canonical JSON is an array of objects. Recognized browser JSON exports are normalized
as described below. CSV is UTF-8 RFC4180 with a header row; accept BOM and quoted
commas/newlines. CSV uses these exact canonical field names; no mapping wizard in V1.

| Field | Rule |
| --- | --- |
| url | Required absolute HTTP/HTTPS URL, max 8,192 characters. |
| title | Required nonblank string, max 2,000 characters. |
| visited_at | Required valid RFC3339 timestamp with Z or explicit offset; normalize UTC milliseconds. |
| visit_count | Optional positive safe integer; CSV decimal digits only. |
| domain | Optional hostname, must match hostname derived from URL. |
| description | Optional plain text, max 10,000 characters. |
| page_content | Optional plain text, max 100,000 characters. |

Never substitute a date/title or stringify objects. Reject invalid calendar dates,
locale dates, numeric values in canonical `visited_at`, null optional values and oversized
supplied text. Explicitly named browser timestamp fields are handled by the adapters below.
Blank optional CSV cells mean absent. Unknown fields are ignored with a warning.
Duplicate CSV headers or malformed document structure fail the file.
Max 100,000 rows / 50 MiB. Empty or all-invalid files cannot commit.

Row issues include 1-based row, field, stable code and safe message, not rejected values.
A mixed-validity preview can import only valid rows after explicit acknowledgment.
Preview performs no Cloud/DNS/site calls. Rejected secret-bearing records are not retained.

## Browser JSON Adapters

- Accept a canonical array, or exactly one array under `Browser History`, `history`,
  `records`, `items`, `visits`, or `data`. Also accept these named arrays one level inside
  a `data` object. Reject multiple candidate arrays rather than guessing which is history.
- Safari exports shaped as `{metadata: {...}, history: [...]}` are supported. Ignore the
  export metadata; it is not indexed and `export_time_usec` is never used as a visit time.
- When canonical `visited_at` is absent, `time_usec` means nonnegative Unix microseconds
  and `lastVisitTime` means nonnegative Unix milliseconds. No magnitude-based epoch/unit
  guessing. Preserve UTC milliseconds; truncate finer microsecond precision. Reject unsafe
  numeric microseconds, malformed strings, out-of-range dates and conflicting aliases.
- String microseconds are converted with integer arithmetic. Existing canonical timestamps
  take precedence and must validate; do not replace a malformed canonical value with an alias.
- Map extension `visitCount` to `visit_count` only when the canonical field is absent.
  Counts still use the same positive-safe-integer validation and max-not-sum merge policy.
- Titles remain required. Report missing/blank Safari titles as row errors, allowing explicit
  valid-only import of remaining rows. Never invent a title or follow a redirect to obtain one.
- Ignore `destination_url`, `destination_time_usec`, `source_time_usec` and other export-only
  fields; they must not create extra pages/visits or trigger fetching. Safe warnings identify
  recognized wrapper names and counts only, never unknown keys or discarded values.

## URL Identity

WHATWG URL serialization: lowercase hostname, remove default port, remove `utm_*`,
`fbclid`, `gclid` tracking parameters. Remove ordinary anchors but preserve hash routes
starting `#/` or `#!`. Preserve HTTP vs HTTPS, www, path case, non-root trailing slash,
meaningful query values and query order. ID = SHA256(normalized URL).

Reject userinfo, unsupported schemes, localhost/local names, nonpublic literal IPs and
known token/signature/session/credential parameters or sensitive fragments. Detection is
conservative, not proof that a URL contains no secrets. Enrichment also rejects protected
account/login/settings paths; imported metadata for those paths may be retained after consent.
HTML canonical links are advisory validated metadata, not identity-merging instructions.

## Indexed Page

Strict mapping, `_meta.schema_version=1`. Index names default `isis-demo-v1` and
`isis-personal-v1`; dataset is server-selected from an enum, never arbitrary client input.
These names are write aliases over exact `-data` backing indices. Bulk writes require
an existing alias; deletion removes both backing indices/aliases, so delayed writes cannot
auto-create a new index. Never use Update API upserts after deleting a page/index.

| Fields | Mapping |
| --- | --- |
| schema_version | integer |
| id, url, domain, dataset, source, content_type | keyword |
| title | text (English analyzer), keyword subfield |
| description, content | text (English analyzer) |
| url_search | text (standard analyzer) |
| visited_at | date array |
| first_visited_at, last_visited_at, created_at, updated_at, fetched_at | date |
| visit_count, imported_visit_count_max | integer |
| fetch_status, fetch_reason, content_provenance, content_hash, canonical_url | keyword |
| content_truncated | boolean |
| semantic_text | semantic_text, explicit configured inference_id |

`semantic_text` is labeled title + description + plain content. Do not embed visits or
the entire URL record. ELSER creates sparse embeddings and chunks through Elasticsearch.
Source fields/embeddings are not exposed wholesale in result or debug responses.

## Merge Rules

- One document per normalized URL per dataset. Sort and union known UTC timestamps
  at millisecond precision; earliest/latest are derived, not overwritten by input order.
- `imported_visit_count_max` is the maximum aggregate count ever supplied, not their sum.
  `visit_count=max(number of known distinct timestamps, imported_visit_count_max)`.
  UI distinguishes observed visits from reported counts. Identical timestamp/URL visits
  cannot be distinguished. Max 10,000 known timestamps/page; reject overflow, never truncate visits.
- Reimporting identical data is a no-op. Later valid nonempty metadata updates existing
  values; absent/empty optional fields do not erase data. Track content provenance.
- Explicit re-enrichment may replace supplied content; unsuccessful fetching preserves it.
- A content hash guards inference input. Partial updates omit unchanged `semantic_text`;
  metadata-only changes must not request new embeddings. Validate against live ES preflight.
- Serialize local writes; use `_seq_no` / `_primary_term` for optimistic conflicts with
  at most two retries. Report per-page failures; HTTP retry must not double-count visits.

Fetch states are exactly `not_requested`, `pending`, `fetched`, `skipped`, `failed`.
Reason codes and timestamps explain skipped/failed outcomes without storing raw responses.