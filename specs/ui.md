# UI Specification

See [product](product.md), [API](api.md), [privacy](privacy.md).

## Primary Screen

Literal product heading **I Saw It Somewhere**, subtitle **Search the Internet you've
already seen.**, large labeled search `What do you remember?`, requested example placeholder:
`That GitHub project where an AI agent controlled a browser. I think I saw it a few months ago...`
and `Find it` button. Search is the actual product surface, not a separate landing page.
Example queries populate the input; no automatic submission without user intent.

Compact header: distinctive local logo asset, dataset selector, import and data controls.
Synthetic dataset badge is always visible when active. Empty initial state offers an
intentional sample load and JSON/CSV import; never auto-index/sample-fetch on page load.
Useful body states and results remain visible in the first viewport on mobile and desktop.

The search form includes a segmented Search mode control: Keyword, Semantic, Hybrid.
Hybrid is selected initially. Buttons expose pressed state and hover titles. Changing mode
preserves query, dataset and filters, abandons the pending client search, and clears old results without
submitting automatically; the user presses Enter or Find it again. This is separate from the
dataset switch and Under the hood toggle. Result headings show the actual executed mode.
Intentional Keyword searches must not show a semantic-outage warning; a Hybrid fallback
still displays the server's explicit warning and actual Keyword result mode.

Demo shows five clearly labeled synthetic query examples. Clicking one only fills the
query and retains the mode. Normal synthetic loading includes the original 60 pages plus
the five full-text showcase pages; the separate evaluation corpus is unchanged. Examples
are not shown in My history. Loading/indexing remains explicit and requires Cloud consent.

## Results and Diagnostics

Unframed search result rows: title/open link, domain/safe URL, last visited, matching
historical visit when applicable, observed/reported count distinction, evidence excerpt,
`Why this matches`, actual domain/time clues, `Possible match` label. No fake confidence bar.
Open links use `noopener noreferrer`. No remote domain favicon/image requests.

Any returned candidates use the neutral heading `Possible matches.`; zero candidates use
`No matches this time.` Do not turn word overlap or the legacy API uncertainty status into
a semantic-confidence claim or add unsupported tentative-evidence warnings.

Optional collapsed `Under the hood` view shows clues, filters, stages, actual timings,
Elastic scoring/ranks/fusion and expandable safe DSL/raw explanation. Normal search does
not expose unnecessary Elasticsearch vocabulary. Debug toggling must not change ranking.

## Import and Enrichment

Import dialog: choose file or synthetic data, validate locally, show safe sample/error
rows, unique URL and per-domain counts, acknowledge valid-only import if applicable,
explicit cloud storage/EIS disclosure and checkbox before commit. Show batch progress,
cancel and retry with honest partial completion. File never needs to be committed to Git.

After import, optional public-page enrichment: exact unique URL counts and per-domain
counts, individual approve/reject checkboxes initially clear; separate fetch command.
Unapproved/skipped/failed statuses are visible; history remains searchable either way.
Data control: typed deletion confirmation and verified completion; do not claim snapshot erasure.

## States

Pristine, missing configuration, empty dataset, validating, preview, indexing, enriching,
searching, possible matches, tentative candidates, no matches, lexical-only warning,
network/service error, deleting, deleted. Cancel/identity-check search requests to avoid
showing old results for new text. Do not substitute mock results when Cloud is unavailable.

## Visual and Accessibility Contract

Consumer/editorial search aesthetic: white/charcoal, green action accent, amber warnings,
purposeful local serif heading/sans controls, subtle paper/grid texture, <=8px framing
radius, no gradient blobs, giant dashboard cards or nested cards. Local visual asset and
lucide tool icons. Fixed control heights, wrapping long URLs, zero negative letter spacing.
No viewport-scaled type. Brief meaningful entrance motion and reduced-motion support.
Clear labels/tooltips for icon controls, visible focus, keyboard submit/dialog close,
screen-reader live status, WCAG AA contrast, 44px touch targets. Validate 360/768/1440px
screenshots and text/viewport bounds. No visible tutorial paragraphs or feature-marketing panels.