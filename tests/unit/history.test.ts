import { describe, expect, it } from "vitest";
import { csvProvider, groupRecords, jsonProvider } from "../../src/lib/history/providers";
import { maxHistoryFileBytes, maxHistoryRecords } from "../../src/lib/history/schema";
import { mergeRecords } from "../../src/lib/history/merge";
import { normalizeUrl, fetchEligibility, isPublicAddress } from "../../src/lib/history/url";

const raw = { url: "https://github.com/browser-use/browser-use", title: "Browser Use", visited_at: "2026-07-14T10:00:00Z", visit_count: 7, page_content: "An AI agent interacts with web pages in a browser." };
const record = () => jsonProvider.parse(JSON.stringify([raw])).records[0];

describe("history providers", () => {
    it("normalizes offsets without losing milliseconds", () => {
        const result = jsonProvider.parse(JSON.stringify([{ ...raw, visited_at: "2026-07-14T12:00:00.123+02:00" }]));
        expect(result.records[0].visited_at).toBe("2026-07-14T10:00:00.123Z");
    });
    it("handles BOM, quoted commas and multiline CSV", () => {
        const result = csvProvider.parse('\uFEFFurl,title,visited_at,description\nhttps://example.com,"A, title",2026-01-01T00:00:00Z,"line one\nline two"');
        expect(result.records[0].description).toBe("line one\nline two");
        expect(result.records[0].title).toBe("A, title");
    });
    it.each(["2026-02-30T10:00:00Z", "2026-10-25T24:00:00Z", "10/25/2026", "2026-10-25T10:00:00", 123456])("rejects malformed timestamp %s", (visited_at) => {
        const parsed = jsonProvider.parse(JSON.stringify([{ ...raw, visited_at }]));
        expect(parsed.records).toHaveLength(0);
        expect(parsed.issues[0].field).toBe("visited_at");
    });
    it("does not invent required fields or retain secret values in errors", () => {
        const parsed = jsonProvider.parse(JSON.stringify([{ url: "https://example.com/?token=DO-NOT-ECHO", title: "Safe", visited_at: raw.visited_at }, { url: raw.url }]));
        expect(parsed.records).toHaveLength(0);
        expect(JSON.stringify(parsed)).not.toContain("DO-NOT-ECHO");
    });
    it("rejects duplicate headers and malformed counts", () => {
        expect(() => csvProvider.parse("url,title,title,visited_at\na,b,c,d")).toThrow();
        expect(csvProvider.parse("url,title,visited_at,visit_count\nhttps://example.com,a,2026-01-01T00:00:00Z,3oops").records).toHaveLength(0);
    });
    it("rejects incorrect domains and unexpected field types", () => {
        expect(jsonProvider.parse(JSON.stringify([{ ...raw, domain: "evil.com" }, { ...raw, page_content: {} }])).records).toHaveLength(0);
    });
});

describe("browser JSON exports", () => {
    const visitedAt = "2026-10-25T12:34:56.789Z";
    const microseconds = Date.parse(visitedAt) * 1000 + 456;
    const safariRecord = { url: "https://example.com/article", title: "Synthetic article", time_usec: microseconds, visit_count: 3 };

    it.each(["Browser History", "history", "records", "items", "visits", "data"])("unwraps the recognized %s array", (key) => {
        const parsed = jsonProvider.parse(JSON.stringify({ metadata: { schema_version: 1 }, [key]: [raw] }));
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].url).toBe(raw.url);
        expect(parsed.warnings.some((warning) => warning.includes("export wrapper"))).toBe(true);
    });
    it("reads Safari metadata/history and converts Unix microseconds without using export time", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ metadata: { browser_name: "Safari", browser_version: "27.0.1", data_type: "history", schema_version: 1, export_time_usec: Date.parse("2026-11-01T00:00:00Z") * 1000 }, history: [safariRecord] }));
        expect(parsed.issues).toEqual([]);
        expect(parsed.records[0]).toMatchObject({ url: safariRecord.url, title: safariRecord.title, visited_at: visitedAt, visit_count: 3 });
        expect(parsed.records[0]).not.toHaveProperty("metadata");
        expect(parsed.records[0]).not.toHaveProperty("time_usec");
    });
    it("converts string microseconds exactly before dropping sub-millisecond precision", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ "Browser History": [{ ...safariRecord, time_usec: String(microseconds) }] }));
        expect(parsed.records[0].visited_at).toBe(visitedAt);
    });
    it("normalizes extension fields with their explicit millisecond units", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ history: [{ url: safariRecord.url, title: safariRecord.title, lastVisitTime: Date.parse(visitedAt), visitCount: 5 }] }));
        expect(parsed.records[0]).toMatchObject({ visited_at: visitedAt, visit_count: 5 });
        expect(parsed.issues).toEqual([]);
    });
    it("supports a recognized history array inside a data envelope", () => {
        expect(jsonProvider.parse(JSON.stringify({ data: { history: [safariRecord] } })).records[0].visited_at).toBe(visitedAt);
    });
    it("does not choose arbitrarily between multiple history arrays", () => {
        expect(() => jsonProvider.parse(JSON.stringify({ history: [raw], records: [raw] }))).toThrowError(expect.objectContaining({ code: "ambiguous_json" }));
    });
    it("reports unsupported structures without echoing outer keys or contents", () => {
        try {
            jsonProvider.parse(JSON.stringify({ PRIVATE_EXPORT_KEY: "DO-NOT-ECHO" }));
            expect.fail("Unsupported structures must be rejected");
        } catch (error) {
            expect((error as Error).message).toContain("export wrapped");
            expect((error as Error).message).not.toContain("PRIVATE_EXPORT_KEY");
            expect((error as Error).message).not.toContain("DO-NOT-ECHO");
        }
    });
    it("reports untitled Safari rows while keeping titled rows available for valid-only import", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ metadata: { browser_name: "Safari" }, history: [{ ...safariRecord, title: undefined }, safariRecord] }));
        expect(parsed.rowCount).toBe(2);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.issues).toEqual([expect.objectContaining({ row: 1, field: "title" })]);
        expect(parsed.issues[0].message).toContain("nonblank page title");
    });
    it("does not manufacture visits from redirect URLs or their timestamps", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ history: [{ ...safariRecord, destination_url: "https://example.com/redirect?token=DO-NOT-RETAIN", destination_time_usec: microseconds + 1000000, source_time_usec: microseconds - 1000000 }] }));
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].url).toBe(safariRecord.url);
        expect(parsed.records[0].visited_at).toBe(visitedAt);
        expect(JSON.stringify(parsed)).not.toContain("DO-NOT-RETAIN");
        expect(parsed.records[0]).not.toHaveProperty("destination_time_usec");
    });
    it.each([null, "not-a-time", -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "9".repeat(80)])("rejects malformed browser timestamp %s without guessing", (time_usec) => {
        const parsed = jsonProvider.parse(JSON.stringify({ history: [{ ...safariRecord, time_usec }] }));
        expect(parsed.records).toHaveLength(0);
        expect(parsed.issues[0].field).toBe("visited_at");
    });
    it("never replaces an explicitly provided invalid canonical date with an alias", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ history: [{ ...safariRecord, visited_at: "invalid" }] }));
        expect(parsed.records).toHaveLength(0);
        expect(parsed.issues[0].field).toBe("visited_at");
    });
    it("rejects conflicting browser times instead of choosing a visit", () => {
        const parsed = jsonProvider.parse(JSON.stringify({ history: [{ ...safariRecord, lastVisitTime: Date.parse(visitedAt) + 1000 }] }));
        expect(parsed.records).toHaveLength(0);
        expect(parsed.issues[0].field).toBe("visited_at");
    });
    it("retains the record limit after unwrapping an export", () => {
        expect(() => jsonProvider.parse(JSON.stringify({ history: Array.from({ length: maxHistoryRecords + 1 }, () => ({})) }))).toThrowError(expect.objectContaining({ code: "row_limit" }));
    });
});

describe("bounded large history imports", () => {
    it.each(["json", "csv"] as const)("accepts a generated 28 MiB %s history without Cloud access", (format) => {
        const pageContent = "x".repeat(28 * 1024);
        const rows = Array.from({ length: 1024 }, (_, index) => ({ url: `https://example.com/synthetic/${index}`, title: `Synthetic page ${index}`, visited_at: "2026-10-25T10:00:00Z", page_content: pageContent }));
        const text = format === "json" ? JSON.stringify(rows) : "url,title,visited_at,page_content\n" + rows.map((row) => `${row.url},${row.title},${row.visited_at},${row.page_content}`).join("\n");
        expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(28 * 1024 * 1024);
        const parsed = (format === "json" ? jsonProvider : csvProvider).parse(text);
        expect(parsed.records).toHaveLength(1024);
        expect(parsed.issues).toEqual([]);
    }, 15000);
    it.each(["json", "csv"] as const)("accepts more than the old 5,000-record %s limit", (format) => {
        const rows = Array.from({ length: 5001 }, (_, index) => ({ ...raw, url: `https://example.com/synthetic/${index}` }));
        const text = format === "json" ? JSON.stringify(rows) : "url,title,visited_at\n" + rows.map((row) => `${row.url},${row.title},${row.visited_at}`).join("\n");
        expect((format === "json" ? jsonProvider : csvProvider).parse(text).records).toHaveLength(5001);
    });
    it.each([jsonProvider, csvProvider])("rejects files above 50 MiB before parsing", (provider) => {
        expect(() => provider.parse(" ".repeat(maxHistoryFileBytes + 1))).toThrowError(expect.objectContaining({ code: "file_limit", status: 413 }));
    });
    it("measures the byte limit in UTF-8, not character count", () => {
        const text = "é".repeat(maxHistoryFileBytes / 2 + 1);
        expect(text.length).toBeLessThan(maxHistoryFileBytes);
        expect(() => jsonProvider.parse(text)).toThrowError(expect.objectContaining({ code: "file_limit" }));
    });
    it("retains the bounded record-count guard", () => {
        expect(() => jsonProvider.parse(JSON.stringify(Array.from({ length: maxHistoryRecords + 1 }, () => ({}))))).toThrowError(expect.objectContaining({ code: "row_limit" }));
    });
    it("groups large repeated-visit histories without dropping or reordering visits", () => {
        const visits = Array.from({ length: 20000 }, () => record());
        const groups = groupRecords(visits);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toHaveLength(visits.length);
        expect(groups[0][0]).toBe(visits[0]);
        expect(groups[0].at(-1)).toBe(visits.at(-1));
    });
});

describe("URL policy", () => {
    it("removes trackers/anchors but preserves distinct resources", () => {
        expect(normalizeUrl("https://EXAMPLE.com:443/Path/?x=1&utm_source=a#section").href).toBe("https://example.com/Path/?x=1");
        expect(normalizeUrl("https://example.com/#/route").hash).toBe("#/route");
        expect(normalizeUrl("http://example.com/Path").href).not.toBe(normalizeUrl("https://example.com/Path/").href);
    });
    it.each(["http://127.1/a", "http://2130706433", "http://[::1]", "http://192.168.1.2", "file:///a", "chrome://history", "https://user:pass@example.com", "https://example.com/?access_token=abc", "https://example.com/#access_token=abc"])("blocks %s", (url) => expect(() => normalizeUrl(url)).toThrow());
    it("blocks fetching protected paths and nonstandard ports", () => {
        expect(fetchEligibility("https://example.com/%61ccount/settings")).toBe("protected_path");
        expect(fetchEligibility("https://example.com:9000/page")).toBe("nonstandard_port");
        expect(fetchEligibility(raw.url)).toBeNull();
    });
    it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:8.8.8.8", "2001:db8::1"])("classifies nonpublic/mapped address %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("visit and content merge", () => {
    it("reimports idempotently and never sums aggregate counts", () => {
        const first = mergeRecords(undefined, [record()], "demo", "2026-10-25T00:00:00Z");
        const again = mergeRecords(first.document, [record()], "demo", "2026-10-26T00:00:00Z");
        expect(again.changed).toBe(false);
        expect(again.document.visit_count).toBe(7);
        expect(again.document.visited_at).toHaveLength(1);
    });
    it("retains old visits after revisiting without changing inference input", () => {
        const first = mergeRecords(undefined, [record()], "demo");
        const later = { ...record(), visited_at: "2026-10-24T10:00:00.001Z", visit_count: 9 };
        const merged = mergeRecords(first.document, [later], "demo");
        expect(merged.document.visited_at).toEqual(["2026-07-14T10:00:00.000Z", later.visited_at]);
        expect(merged.document.visit_count).toBe(9);
        expect(merged.semanticChanged).toBe(false);
        expect(merged.changed).toBe(true);
    });
    it("does not erase available text with blank optional fields", () => {
        const first = mergeRecords(undefined, [record()], "personal");
        expect(mergeRecords(first.document, [{ ...record(), page_content: "" }], "personal").document.content).toBe(raw.page_content);
    });
});