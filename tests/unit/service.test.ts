import { describe, expect, it, vi } from "vitest";
import type { HistoryRepository } from "../../src/lib/elastic/repository";
import type { estypes } from "@elastic/elasticsearch";
import { mergeRecords } from "../../src/lib/history/merge";
import { jsonProvider } from "../../src/lib/history/providers";
import { searchHistory } from "../../src/lib/search/service";
import { searchSchema } from "../../src/lib/search/query";

const doc = mergeRecords(undefined, jsonProvider.parse('[{"url":"https://example.com/browser","title":"Browser agent","visited_at":"2026-10-25T00:00:00Z","page_content":"An agent controls the browser."}]').records, "demo").document;
function setup() {
    const search = vi.fn(async () => ({ took: 3, timed_out: false, _shards: { failed: 0 }, hits: { hits: [{ _id: doc.id, _source: doc }] } }));
    const repository = { index: () => "isis-demo-v1", client: { search } } as unknown as HistoryRepository;
    return { repository, search };
}

describe("search behavior and honest degradation", () => {
    it("defaults to hybrid and rejects unsupported modes", () => {
        expect(searchSchema.parse({ query: "browser agent", dataset: "demo" }).mode).toBe("hybrid");
        expect(searchSchema.safeParse({ query: "browser agent", dataset: "demo", mode: "unknown" }).success).toBe(false);
    });
    it.each(["lexical", "semantic", "hybrid"] as const)("executes the requested %s retriever", async (mode) => {
        const { repository, search } = setup();
        const response = await searchHistory(repository, searchSchema.parse({ query: "browser agent", dataset: "demo", mode, debug: true }));
        const request = (search.mock.calls[0] as unknown as [estypes.SearchRequest])[0];
        const retriever = JSON.stringify(request.retriever);
        expect(response.mode).toBe(mode);
        expect(response.warnings).toHaveLength(0);
        expect("trace" in response).toBe(true);
        if ("trace" in response) {
            expect(response.trace?.requestedCandidateWindow).toBe(mode === "hybrid" ? 100 : 30);
            expect(response.trace?.stages).toEqual(mode === "hybrid" ? ["bm25", "elser", "metadata", "rrf"] : [mode === "lexical" ? "bm25" : "elser", "metadata"]);
        }
        if (mode === "hybrid") expect(request.retriever?.rrf?.retrievers).toHaveLength(2);
        else {
            expect(request.retriever?.rrf).toBeUndefined();
            expect(retriever.includes("multi_match")).toBe(mode === "lexical");
            expect(retriever.includes("semantic_text")).toBe(mode === "semantic");
        }
    });
    it("does not silently substitute keywords for explicitly requested semantic search", async () => {
        const { repository, search } = setup();
        search.mockRejectedValueOnce({ meta: { statusCode: 503 } });
        await expect(searchHistory(repository, searchSchema.parse({ query: "browser agent", dataset: "demo", mode: "semantic" }))).rejects.toMatchObject({ meta: { statusCode: 503 } });
        expect(search).toHaveBeenCalledTimes(1);
    });
    it("preserves the explicit evaluation-script mode override", async () => {
        const { repository } = setup();
        const response = await searchHistory(repository, searchSchema.parse({ query: "browser agent", dataset: "demo" }), new Date(), "semantic");
        expect(response.mode).toBe("semantic");
    });
    it("marks a semantic outage as lexical-only rather than pretending hybrid", async () => {
        const { repository, search } = setup();
        search.mockRejectedValueOnce({ meta: { statusCode: 503 } });
        const response = await searchHistory(repository, searchSchema.parse({ query: "browser agent", dataset: "demo" }));
        expect(response.mode).toBe("lexical"); expect(response.warnings).toHaveLength(1); expect(search).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(search.mock.calls[1])).not.toContain('"rrf"');
    });
    it("does not hide permissions problems behind lexical fallback", async () => {
        const { repository, search } = setup();
        search.mockRejectedValueOnce({ meta: { statusCode: 403 } });
        await expect(searchHistory(repository, searchSchema.parse({ query: "browser agent", dataset: "demo" }))).rejects.toMatchObject({ meta: { statusCode: 403 } });
        expect(search).toHaveBeenCalledTimes(1);
    });
    it("reports weak evidence honestly without excluding semantic-only candidates", async () => {
        const { repository } = setup();
        const response = await searchHistory(repository, searchSchema.parse({ query: "kiln glaze chemistry", dataset: "demo" }));
        expect(response.status).toBe("no_confident_matches"); expect(response.results).toHaveLength(1); expect(response.results[0].label).toBe("Possible match");
    });
    it("does not run subject-free match_all queries", async () => {
        const { repository, search } = setup();
        await expect(searchHistory(repository, searchSchema.parse({ query: "GitHub recently", dataset: "demo" }))).rejects.toThrow("what the page was about");
        expect(search).not.toHaveBeenCalled();
    });
});