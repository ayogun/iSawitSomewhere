import { describe, expect, it } from "vitest";
import { meaningfulTerms, parseClues } from "../../src/lib/search/clues";
import { buildSearch, searchSchema } from "../../src/lib/search/query";
import { findRrfExplanation, scoreTrace, toResult } from "../../src/lib/search/evidence";
import { mergeRecords } from "../../src/lib/history/merge";
import { jsonProvider } from "../../src/lib/history/providers";
import { demoRecords, sampleRecords, semanticShowcaseCases, semanticShowcaseRecords } from "../../src/lib/sample";

const now = new Date("2026-10-25T12:00:00Z");
const input = searchSchema.parse({ query: "AI agent controlling browser, probably GitHub, a few months ago", dataset: "demo", debug: true });
const doc = mergeRecords(undefined, jsonProvider.parse(JSON.stringify([{ url: "https://github.com/browser-use/browser-use", title: "Browser Use", visited_at: "2026-07-14T10:00:00Z", page_content: "An AI agent controls web browsers to interact with websites." }, { url: "https://github.com/browser-use/browser-use", title: "Browser Use", visited_at: "2026-10-24T10:00:00Z" }])).records, "demo").document;

describe("deterministic memory clues", () => {
    it("extracts source and approximate time without requiring them", () => {
        const clues = parseClues(input.query, now);
        expect(clues.domain).toBe("github.com");
        expect(clues.concept).toBe("AI agent controlling browser");
        expect(clues.time?.start).toBe("2026-04-28T12:00:00.000Z");
        expect(clues.time?.end).toBe("2026-08-26T12:00:00.000Z");
    });
    it("uses the previous calendar year and UTC reference clock", () => expect(parseClues("outage last year", now).time).toMatchObject({ start: "2025-01-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" }));
    it("does not choose between conflicting clues", () => {
        const clues = parseClues("GitHub or Elastic article recently or last year", now);
        expect(clues.time).toBeNull(); expect(clues.domain).toBeNull(); expect(clues.warnings).toHaveLength(2);
    });
    it("preserves unrecognized subject meaning", () => expect(parseClues("apartment with a huge balcony in Warsaw", now).concept).toBe("apartment with a huge balcony in Warsaw"));
    it("clamps month arithmetic at month end", () => expect(parseClues("outage 1 month ago", new Date("2026-03-31T12:00:00Z")).time?.start).toBe("2026-01-29T12:00:00.000Z"));
});

describe("Elastic hybrid DSL", () => {
    it("has two real retrievers with native RRF and metadata multipliers", () => {
        const query = buildSearch("isis-demo-v1", input, parseClues(input.query, now));
        expect(query.retriever?.rrf?.retrievers).toHaveLength(2);
        const serialized = JSON.stringify(query);
        expect(serialized).toContain('"semantic_text":{"query":"AI agent controlling browser"}');
        expect(serialized).toContain('"weight":1.25');
        expect(serialized).toContain('"weight":1.15');
        expect(serialized).not.toContain('"knn"');
    });
    it("applies hard filters to BOTH retrievers but inferred hints only to functions", () => {
        const withFilters = { ...input, filters: { domain: "github.com", start: "2026-01-01T00:00:00Z" } };
        const query = buildSearch("isis-demo-v1", withFilters, parseClues(input.query, now));
        const serialized = JSON.stringify(query);
        expect(serialized.match(/"gte":"2026-01-01T00:00:00Z"/g)).toHaveLength(2);
        expect(serialized).not.toContain("last_visited_at\":{");
    });
    it("rejects reversed explicit dates", () => expect(searchSchema.safeParse({ ...input, filters: { start: "2026-10-25T00:00:00Z", end: "2026-01-01T00:00:00Z" } }).success).toBe(false));
});

describe("grounded result evidence", () => {
    it("uses any known visit rather than only the latest", () => {
        const result = toResult({ _id: doc.id, _index: "test", _source: doc, highlight: { content: [doc.content] } }, parseClues(input.query, now));
        expect(result?.matchingVisitAt).toBe("2026-07-14T10:00:00.000Z");
        expect(result?.lastVisitedAt).toBe("2026-10-24T10:00:00.000Z");
        expect(result?.matchedClues).toHaveLength(2);
    });
    it("rejects an unsupported highlight rather than inventing evidence", () => {
        const result = toResult({ _id: doc.id, _index: "test", _source: doc, highlight: { content: ["This page can fly to the moon"] } }, parseClues(input.query, now));
        expect(result?.evidenceSource).toBe("indexed_excerpt");
        expect(result?.snippet).not.toContain("moon");
        expect(result?.label).toBe("Possible match");
    });
    it("uses null for unknown score details", () => {
        const trace = scoreTrace({ _id: doc.id, _index: "test", _score: 0.03, _source: doc }, parseClues(input.query, now));
        expect(trace.children).toBeNull(); expect(trace.finalScore).toBe(0.03);
    });
    it("does not mislabel a semantic-only explanation as BM25", () => {
        const trace = scoreTrace({ _id: doc.id, _index: "test", _source: doc, _explanation: { value: 0.016, description: "rrf score: [0.016]", details: [{ value: 1, description: "rrf score: [0.016], for rank [1] in query at index [1]", details: [{ value: 8, description: "semantic query", details: [] }] }] } }, parseClues(input.query, now));
        expect(trace.children?.[0].stage).toBe("elser");
        expect(trace.children?.[0].rawContentScore).toBeNull();
    });
    it("finds actual RRF contributions inside Elasticsearch 9.5's required-clause wrapper", () => {
        const fusion = {
            value: 0.032786883,
            description: "rrf score: [0.032786883] computed for initial ranks [1, 1] with rankConstant: [60]",
            details: [
                { value: 1, description: "rrf score: [0.016393442], for rank [1] in query at index [0] computed as [1 / (1 + 60)]", details: [{ value: 4, description: "function score, product of:", details: [{ value: 3, description: "content match", details: [] }] }] },
                { value: 1, description: "rrf score: [0.016393442], for rank [1] in query at index [1] computed as [1 / (1 + 60)]", details: [{ value: 8, description: "semantic match", details: [] }] },
            ],
        };
        const wrapper = { value: fusion.value, description: "sum of:", details: [fusion, { value: 0, description: "match on required clause, product of:", details: [{ value: 1, description: "FieldExistsQuery [field=_primary_term]", details: [] }] }] };
        const trace = scoreTrace({ _id: doc.id, _index: "test", _score: fusion.value, _source: doc, _explanation: wrapper }, parseClues(input.query, now));
        expect(findRrfExplanation(wrapper)).toBe(fusion);
        expect(trace.children).toHaveLength(2);
        expect(trace.children?.[0]).toMatchObject({ stage: "bm25", rank: 1, contribution: 0.016393442, adjustedScore: 4, rawContentScore: 3 });
        expect(trace.children?.[1]).toMatchObject({ stage: "elser", rank: 1, contribution: 0.016393442, adjustedScore: 8, rawContentScore: null });
        expect(trace.explanation).toBe(wrapper);
    });
    it("does not treat an ordinary sum or a lone child contribution as a complete RRF explanation", () => {
        expect(findRrfExplanation({ value: 1, description: "sum of:", details: [{ value: 1, description: "BM25 match", details: [] }] })).toBeNull();
        expect(findRrfExplanation({ value: 1, description: "rrf score: [0.016], for rank [1] in query at index [1]", details: [] })).toBeNull();
    });
});

describe("separate synthetic semantic showcase", () => {
    it("includes all five showcase pages in the user-facing demo without changing the benchmark", () => {
        const records = demoRecords(now);
        expect(records).toHaveLength(106);
        expect(new Set(records.map((record) => record.id)).size).toBe(65);
        expect(records.every((record) => record.source === "synthetic")).toBe(true);
        for (const showcase of semanticShowcaseCases) {
            expect(records.filter((record) => record.url === showcase.url)).toHaveLength(1);
        }
        expect(new Set(sampleRecords(now).map((record) => record.id)).size).toBe(60);
    });
    it("has exactly five labeled pages without changing the benchmark corpus", () => {
        const records = semanticShowcaseRecords(now);
        const benchmark = sampleRecords(now);
        expect(records).toHaveLength(5);
        expect(new Set(records.map((record) => record.id)).size).toBe(5);
        expect(benchmark).toHaveLength(101);
        expect(new Set(benchmark.map((record) => record.id)).size).toBe(60);
        for (const record of records) {
            expect(record.title).toMatch(/^\[Synthetic demo\]/);
            expect(record.source).toBe("synthetic");
            expect(record.page_content!.length).toBeGreaterThan(400);
            expect(benchmark.some((entry) => entry.id === record.id)).toBe(false);
        }
    });
    it("keeps paraphrase queries out of every indexed fixture field", () => {
        const records = semanticShowcaseRecords(now);
        expect(semanticShowcaseCases).toHaveLength(5);
        for (const showcase of semanticShowcaseCases) {
            const record = records.find((entry) => entry.url === showcase.url)!;
            const document = mergeRecords(undefined, [record], "demo", now.toISOString()).document;
            const indexedTerms = new Set(meaningfulTerms(`${document.semantic_text} ${document.url_search}`));
            expect(document.dataset).toBe("demo");
            expect(document.content_provenance).toBe("synthetic");
            expect(document).not.toHaveProperty("query");
            expect(meaningfulTerms(showcase.query).filter((term) => indexedTerms.has(term))).toEqual([]);
            expect(searchSchema.safeParse({ query: showcase.query, dataset: "demo", mode: "semantic" }).success).toBe(true);
        }
    });
    it("shifts showcase visits relative to the supplied clock", () => {
        const records = semanticShowcaseRecords(new Date("2026-11-25T12:00:00Z"));
        expect(records[0].visited_at).toBe("2026-11-24T09:00:00.000Z");
    });
});