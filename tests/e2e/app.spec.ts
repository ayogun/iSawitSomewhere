import { expect, test } from "@playwright/test";
import showcaseFixture from "../../fixtures/semantic-showcase.json";

test("real local preview has explicit Cloud consent and no pretend search", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "I Saw It Somewhere" })).toBeVisible();
    await expect(page.getByText("Elastic Cloud isn't connected.")).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.getByRole("button", { name: "Load sample history" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Load synthetic history" })).toBeVisible();
    await expect(dialog.getByText("unique URLs", { exact: true })).toBeVisible();
    await expect(dialog.getByText("65", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "I approve Cloud storage" })).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Index history" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
});

test("real JSON upload reports safe row and field errors", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import history", exact: true }).click();
    await expect(page.getByText("JSON or CSV, up to 50 MiB / 100,000 records", { exact: true })).toBeVisible();
    await page.getByLabel("History JSON or CSV file").setInputFiles({ name: "synthetic-errors.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ url: "https://example.com/good", title: "A synthetic page", visited_at: "2026-10-25T10:00:00Z" }, { url: "https://example.com/bad", title: "Bad date", visited_at: "yesterday" }])) });
    await expect(page.getByText("rejected rows", { exact: true })).toBeVisible();
    await page.getByText("Preview and validation", { exact: true }).click();
    await expect(page.getByText(/Row 2, visited_at/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Import only the 1 valid records" })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Index history" })).toBeDisabled();
});

test("real CSV upload handles quoted titles and refuses missing required values", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import history", exact: true }).click();
    await page.getByLabel("History JSON or CSV file").setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from('url,title,visited_at\nhttps://example.com,"A, title",2026-10-25T10:00:00Z') });
    await expect(page.getByText("unique URLs", { exact: true })).toBeVisible();
    await page.getByText("Preview and validation", { exact: true }).click();
    await expect(page.getByText("A, title", { exact: true })).toBeVisible();
});

test("real API rejects a cross-origin write", async ({ request }) => {
    const response = await request.post("/api/imports/preview", { headers: { Origin: "https://untrusted.example" }, data: { sample: true } });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toBe("no-store");
});

test("real Safari export preview reports untitled rows without indexing", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Import history", exact: true }).click();
    const timeUsec = Date.parse("2026-10-25T10:00:00Z") * 1000;
    const history = [{ url: "https://example.com/article", title: "Synthetic article", time_usec: timeUsec, visit_count: 2 }, { url: "https://example.com/redirect", time_usec: timeUsec }];
    await page.getByLabel("History JSON or CSV file").setInputFiles({ name: "synthetic-safari.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ metadata: { browser_name: "Safari", data_type: "history", schema_version: 1 }, history })) });
    await expect(page.getByRole("checkbox", { name: "Import only the 1 valid records" })).not.toBeChecked();
    await page.getByText("Preview and validation", { exact: true }).click();
    await expect(page.getByText(/Row 2, title: A nonblank page title/)).toBeVisible();
    await expect(page.getByText(/Read records from the history export wrapper/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Index history" })).toBeDisabled();
});

test("synthetic UI contract: search mode selector preserves inputs and waits for submit", async ({ page }) => {
    const requests: { mode: string; query: string; dataset: string; filters: unknown }[] = [];
    await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
    await page.route("**/api/history/stats", (route) => route.fulfill({ json: { datasets: [] } }));
    await page.route("**/api/search", (route) => {
        const input = route.request().postDataJSON();
        requests.push(input);
        return route.fulfill({ json: { mode: input.mode, status: "no_matches", clues: { concept: input.query, domain: null, time: null, referenceTime: "2026-10-25T12:00:00Z", warnings: [] }, results: [], warnings: [], latencyMs: 1, elasticTook: 1 } });
    });
    await page.goto("/");
    const modes = page.getByRole("group", { name: "Search mode", exact: true });
    await expect(modes.getByRole("button", { name: "Hybrid", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "My history", exact: true }).click();
    await page.getByLabel("What do you remember?").fill("synthetic browser agent");
    await page.locator(".filters > summary").click();
    await page.getByLabel("Domain", { exact: true }).fill("example.com");
    await page.getByLabel("Visited from", { exact: true }).fill("2026-01-01");
    await page.getByLabel("Before", { exact: true }).fill("2026-11-01");
    for (const [label, value] of [["Keyword", "lexical"], ["Semantic", "semantic"], ["Hybrid", "hybrid"]]) {
        const count = requests.length;
        await modes.getByRole("button", { name: label, exact: true }).click();
        await expect(page.locator(".results-section")).toHaveCount(0);
        expect(requests).toHaveLength(count);
        await expect(page.getByLabel("What do you remember?")).toHaveValue("synthetic browser agent");
        await expect(page.getByLabel("Domain", { exact: true })).toHaveValue("example.com");
        await page.getByRole("button", { name: "Find it", exact: true }).click();
        await expect(page.locator(".results-heading")).toContainText(label);
        expect(requests.at(-1)).toMatchObject({ mode: value, query: "synthetic browser agent", dataset: "personal", filters: { domain: "example.com", start: "2026-01-01T00:00:00Z", end: "2026-11-01T00:00:00Z" } });
        await expect(page.getByText("Keyword search only. Semantic retrieval is currently unavailable.", { exact: true })).toHaveCount(0);
    }
});

test("synthetic UI contract: five demo examples fill the query without submitting", async ({ page }) => {
    let searches = 0;
    await page.route("**/api/health", (route) => route.fulfill({ json: { configured: false } }));
    await page.route("**/api/search", (route) => { searches++; return route.fulfill({ status: 500 }); });
    await page.goto("/");
    const examples = page.locator(".example-grid .example");
    await expect(examples).toHaveCount(5);
    for (const [index, showcase] of showcaseFixture.entries()) {
        await examples.nth(index).click();
        await expect(page.getByLabel("What do you remember?")).toHaveValue(showcase.query);
    }
    expect(searches).toBe(0);
    await page.getByRole("button", { name: "My history", exact: true }).click();
    await expect(examples).toHaveCount(0);
});

test("synthetic UI contract: meaning-only candidates have no unsupported confidence claim", async ({ page }) => {
    await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
    await page.route("**/api/history/stats", (route) => route.fulfill({ json: { datasets: [] } }));
    await page.route("**/api/search", (route) => route.fulfill({
        json: {
            mode: route.request().postDataJSON().mode, status: "no_confident_matches",
            clues: { concept: "forgot my password", domain: null, time: null, referenceTime: "2026-10-25T12:00:00Z", warnings: [] },
            warnings: [], latencyMs: 1, elasticTook: 1,
            results: [{ id: "synthetic", title: "[Synthetic demo] Recovering sign-in credentials", url: "https://example.com/semantic-showcase/entry-03", domain: "example.com", lastVisitedAt: "2026-10-22T11:00:00Z", matchingVisitAt: null, observedVisitCount: 1, reportedVisitCount: 0, snippet: "Original synthetic article about recovering a lost authentication secret.", why: "From this page's indexed text:", evidenceSource: "indexed_excerpt", matchedClues: [], fetchStatus: "not_requested", label: "Possible match" }],
        }
    }));
    await page.goto("/");
    await page.getByLabel("What do you remember?").fill("forgot my password");
    for (const mode of ["Keyword", "Semantic", "Hybrid"]) {
        await page.getByRole("group", { name: "Search mode", exact: true }).getByRole("button", { name: mode, exact: true }).click();
        await page.getByRole("button", { name: "Find it", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Possible matches.", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "[Synthetic demo] Recovering sign-in credentials", exact: true })).toBeVisible();
        await expect(page.getByText("No confident match yet.", { exact: true })).toHaveCount(0);
        await expect(page.getByText(/indexed evidence does not establish a clear match/)).toHaveCount(0);
    }
});

for (const width of [360, 768, 1440]) {
    test(`synthetic UI contract: results, trace, assets and bounds at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
        await page.route("**/api/history/stats", (route) => route.fulfill({ json: { datasets: [{ dataset: "demo", pages: 60, knownVisits: 101, fetch: [] }] } }));
        await page.route("**/api/search", (route) => route.fulfill({
            json: {
                mode: "hybrid", status: "possible_matches", clues: { concept: "AI agent controls browser", domain: "github.com", time: null, referenceTime: "2026-10-25T12:00:00Z", warnings: [] },
                warnings: [], latencyMs: 142, elasticTook: 104,
                results: [{ id: "synthetic", title: "Browser Use", url: "https://github.com/browser-use/browser-use", domain: "github.com", lastVisitedAt: "2026-10-19T14:00:00Z", matchingVisitAt: "2026-07-14T10:00:00Z", observedVisitCount: 2, reportedVisitCount: 6, snippet: "Synthetic example: Browser Use lets an AI agent control a web browser and interact with websites.", why: "A related passage in this indexed page:", evidenceSource: "matching_passage", matchedClues: ["Source: github.com"], fetchStatus: "not_requested", label: "Possible match" }],
                trace: { requestedCandidateWindow: 100, returnedCandidates: 1, stages: ["bm25", "elser", "metadata", "rrf"], query: { notice: "UI contract fixture, not live retrieval evidence" }, scores: [] },
            }
        }));
        const failures: string[] = [];
        page.on("pageerror", (error) => failures.push(error.message));
        await page.goto("/");
        await page.getByLabel("What do you remember?").fill("AI agent that controls a browser");
        await page.getByRole("checkbox", { name: "Under the hood" }).check();
        await page.getByRole("button", { name: "Find it", exact: true }).click();
        await expect(page.getByRole("link", { name: "Browser Use", exact: true })).toBeVisible();
        await expect(page.getByText("Possible match", { exact: true })).toBeVisible();
        await expect(page.getByText("Actual score explanations", { exact: true })).toBeVisible();
        expect(await page.locator(".wordmark img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(failures).toEqual([]);
        await page.locator(".developer-panel").evaluate((element) => (element as HTMLDetailsElement).open = false);
        await expect(page.locator(".result")).toHaveCSS("opacity", "1");
        await page.screenshot({ path: width === 1440 ? "docs/images/search-desktop.png" : width === 360 ? "docs/images/search-mobile.png" : "test-results/search-768.png", fullPage: true, animations: "disabled" });
    });
}

test("synthetic UI contract: explicit domain approval, fetch outcomes and verified deletion", async ({ page }) => {
    let loaded = false;
    await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
    await page.route("**/api/history/stats", (route) => route.fulfill({ json: { datasets: [{ dataset: "personal", pages: loaded ? 2 : 0, knownVisits: loaded ? 2 : 0, fetch: [] }] } }));
    await page.route("**/api/imports/*/commit", async (route) => {
        expect(route.request().postDataJSON().cloudConsent).toBe(true);
        loaded = true;
        await route.fulfill({ json: { processed: 2, persisted: 2, unchanged: 0, failed: 0, pageIds: ["a".repeat(64), "b".repeat(64)], errors: [], nextCursor: 2, complete: true } });
    });
    await page.route("**/api/enrichment/preview", (route) => route.fulfill({ json: { ticket: "synthetic-ticket", uniqueUrls: 2, domains: [{ domain: "github.com", count: 1, eligible: 1 }, { domain: "example.com", count: 1, eligible: 1 }] } }));
    await page.route("**/api/enrichment/*/run", async (route) => {
        expect(route.request().postDataJSON().approvedDomains).toEqual(["github.com"]);
        await route.fulfill({ json: { results: [{ id: "a".repeat(64), status: "fetched", reason: "ok" }, { id: "b".repeat(64), status: "skipped", reason: "unapproved_domain" }], nextCursor: 2, complete: true } });
    });
    await page.route("**/api/history", async (route) => {
        expect(route.request().method()).toBe("DELETE");
        expect(route.request().postDataJSON().confirmation).toBe("DELETE ALL HISTORY");
        loaded = false;
        await route.fulfill({ json: { deleted: true } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Import history", exact: true }).click();
    await page.getByLabel("History JSON or CSV file").setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify([{ url: "https://github.com/browser-use/browser-use", title: "Browser Use", visited_at: "2026-07-14T10:00:00Z" }, { url: "https://example.com/article", title: "Article", visited_at: "2026-10-25T10:00:00Z" }])) });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Index history" })).toBeDisabled();
    await dialog.getByRole("checkbox", { name: "I approve Cloud storage" }).check();
    await dialog.getByRole("button", { name: "Index history" }).click();
    await dialog.getByRole("button", { name: "Review public-page enrichment" }).click();
    await expect(dialog.getByRole("checkbox", { name: /github.com/ })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: /example.com/ })).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: /github.com/ }).check();
    await dialog.getByRole("button", { name: "Fetch approved pages" }).click();
    await expect(dialog.getByText("1 fetched", { exact: true })).toBeVisible();
    await expect(dialog.getByText("1 skipped", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Privacy & data" }).click();
    await expect(page.getByRole("button", { name: "Delete all history", exact: true })).toBeDisabled();
    await page.getByLabel("Type DELETE ALL HISTORY").fill("DELETE ALL HISTORY");
    await page.getByRole("button", { name: "Delete all history", exact: true }).click();
    await expect(page.getByText("All app history was deleted and absence was verified.")).toBeVisible();
});