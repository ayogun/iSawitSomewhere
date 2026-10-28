import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiResponse, boundedBody, jsonBody, protectRequest } from "../../src/lib/http";
import { POST, DELETE } from "../../src/app/api/[...segments]/route";
import { historyRepository, type HistoryRepository } from "../../src/lib/elastic/repository";
import type { estypes } from "@elastic/elasticsearch";
import { AppError } from "../../src/lib/errors";

vi.mock("../../src/lib/elastic/repository", () => ({ historyRepository: vi.fn(() => { throw new Error("Cloud must not be accessed during local preview."); }) }));

const local = (options: RequestInit = {}) => new Request("http://127.0.0.1:3000/api/search", { ...options, headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", ...options.headers } });

describe("local request boundary", () => {
    it("accepts local same-origin requests", () => expect(() => protectRequest(local({ method: "POST" }))).not.toThrow());
    it("accepts Next's internal localhost URL with the real loopback browser Host", () => {
        expect(() => protectRequest(new Request("http://localhost:3000/api/search", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }))).not.toThrow();
        expect(() => protectRequest(new Request("http://localhost:3000/api/search", { method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://localhost:3000" } }))).toThrow();
    });
    it("rejects rebinding hosts and cross-origin requests", () => {
        expect(() => protectRequest(new Request("http://evil.example/api/search", { headers: { host: "evil.example" } }))).toThrow();
        expect(() => protectRequest(local({ method: "POST", headers: { origin: "https://evil.example" } }))).toThrow();
        expect(() => protectRequest(local({ headers: { "sec-fetch-site": "cross-site" } }))).toThrow();
        expect(() => protectRequest(new Request("http://127.0.0.1:3000/api/search", { method: "POST", headers: { host: "127.0.0.1:3000" } }))).toThrow();
    });
    it("enforces streamed limits even without content length", async () => {
        await expect(boundedBody(local({ method: "POST", body: "0123456789" }), 5)).rejects.toThrow("size limit");
    });
    it("parses schemas without arbitrary coercion", async () => {
        const request = local({ method: "POST", headers: { "content-type": "application/json" }, body: '{"consent":"true"}' });
        await expect(jsonBody(request, z.object({ consent: z.literal(true) }))).rejects.toThrow();
    });
    it("does not log or expose raw query/history/service errors", async () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => { });
        try {
            const response = await apiResponse(local(), "search", async () => { throw new Error("PRIVATE HISTORY SECRET"); });
            expect(response.status).toBe(503);
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.text()).not.toContain("PRIVATE");
            expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
        } finally { log.mockRestore(); }
    });
    it("preserves safe session errors across development module reloads", async () => {
        const error = new AppError("preview_expired", "This preview expired. Select the file again.", 409);
        vi.resetModules();
        const { AppError: ReloadedAppError } = await import("../../src/lib/errors");
        const { safeFailure: reloadedSafeFailure } = await import("../../src/lib/http");
        expect(error).toBeInstanceOf(ReloadedAppError);
        const response = reloadedSafeFailure(error, "synthetic-request");
        expect(response.status).toBe(409);
        expect(response.body.error).toMatchObject({ code: "preview_expired", message: "This preview expired. Select the file again." });
        expect(reloadedSafeFailure(new Error("PRIVATE RAW ERROR"), "synthetic-request").body.error.message).not.toContain("PRIVATE RAW ERROR");
    });
    it("previews all 65 synthetic demo pages without Cloud access", async () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => { });
        let previewId: string | undefined;
        try {
            const response = await POST(local({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sample: true }) }), { params: Promise.resolve({ segments: ["imports", "preview"] }) });
            const result = await response.json();
            previewId = result.previewId;
            expect(response.status).toBe(200);
            expect(result).toMatchObject({ rowCount: 106, validCount: 106, invalidCount: 0, uniqueUrls: 65 });
            expect(historyRepository).not.toHaveBeenCalled();
        } finally {
            if (previewId) await DELETE(local({ method: "DELETE" }), { params: Promise.resolve({ segments: ["imports", previewId] }) });
            log.mockRestore();
        }
    });
    it("previews a Safari export with valid and untitled rows without Cloud access", async () => {
        const timeUsec = Date.parse("2026-10-25T10:00:00Z") * 1000;
        const payload = { metadata: { browser_name: "Safari", schema_version: 1, data_type: "history" }, history: [{ url: "https://example.com/article", title: "Synthetic article", time_usec: timeUsec, visit_count: 2 }, { url: "https://example.com/redirect", time_usec: timeUsec, destination_url: "https://example.com/destination", destination_time_usec: timeUsec + 1000 }] };
        const form = new FormData();
        form.set("file", new File([JSON.stringify(payload)], "synthetic-safari.json", { type: "application/json" }));
        form.set("dataset", "personal");
        const log = vi.spyOn(console, "info").mockImplementation(() => { });
        let previewId: string | undefined;
        try {
            const response = await POST(local({ method: "POST", body: form }), { params: Promise.resolve({ segments: ["imports", "preview"] }) });
            const result = await response.json();
            previewId = result.previewId;
            expect(response.status).toBe(200);
            expect(result).toMatchObject({ rowCount: 2, validCount: 1, invalidCount: 1, uniqueUrls: 1 });
            expect(result.issues).toEqual([expect.objectContaining({ row: 2, field: "title" })]);
            expect(result.warnings.some((warning: string) => warning.includes("history export wrapper"))).toBe(true);
            expect(historyRepository).not.toHaveBeenCalled();
        } finally {
            if (previewId) await DELETE(local({ method: "DELETE" }), { params: Promise.resolve({ segments: ["imports", previewId] }) });
            log.mockRestore();
        }
    });
    it("previews a generated 28 MiB multipart upload and discards it without Cloud access", async () => {
        const content = "x".repeat(28 * 1024);
        const payload = JSON.stringify(Array.from({ length: 1024 }, (_, index) => ({ url: `https://example.com/synthetic/${index}`, title: "Synthetic page", visited_at: "2026-10-25T10:00:00Z", page_content: content })));
        expect(Buffer.byteLength(payload)).toBeGreaterThan(28 * 1024 * 1024);
        const form = new FormData();
        form.set("file", new File([payload], "synthetic-large.json", { type: "application/json" }));
        form.set("dataset", "personal");
        const log = vi.spyOn(console, "info").mockImplementation(() => { });
        let previewId: string | undefined;
        try {
            const response = await POST(local({ method: "POST", body: form }), { params: Promise.resolve({ segments: ["imports", "preview"] }) });
            const result = await response.json();
            previewId = result.previewId;
            expect(response.status).toBe(200);
            expect(result.validCount).toBe(1024);
            expect(result.uniqueUrls).toBe(1024);
            expect(result.invalidCount).toBe(0);
            expect(historyRepository).not.toHaveBeenCalled();
        } finally {
            if (previewId) {
                const discarded = await DELETE(local({ method: "DELETE" }), { params: Promise.resolve({ segments: ["imports", previewId] }) });
                expect(discarded.status).toBe(200);
            }
            log.mockRestore();
        }
    }, 15000);
    it.each(["lexical", "semantic", "hybrid"] as const)("routes a %s API search to its actual retriever", async (mode) => {
        const search = vi.fn(async () => ({ took: 1, timed_out: false, _shards: { failed: 0 }, hits: { hits: [] } }));
        vi.mocked(historyRepository).mockReturnValueOnce({ index: () => "synthetic-mode-test", client: { search } } as unknown as HistoryRepository);
        const log = vi.spyOn(console, "info").mockImplementation(() => { });
        try {
            const response = await POST(local({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "synthetic browser agent", dataset: "demo", mode, debug: true }) }), { params: Promise.resolve({ segments: ["search"] }) });
            const result = await response.json();
            expect(response.status).toBe(200);
            expect(result.mode).toBe(mode);
            expect(result.trace.stages).toEqual(mode === "hybrid" ? ["bm25", "elser", "metadata", "rrf"] : [mode === "lexical" ? "bm25" : "elser", "metadata"]);
            const query = (search.mock.calls[0] as unknown as [estypes.SearchRequest])[0];
            expect(JSON.stringify(query.retriever)).toContain(mode === "hybrid" ? '"rrf"' : mode === "lexical" ? '"multi_match"' : '"semantic_text"');
        } finally { log.mockRestore(); vi.mocked(historyRepository).mockClear(); }
    });
    it("rejects an unsupported API mode before accessing the repository", async () => {
        const log = vi.spyOn(console, "info").mockImplementation(() => { });
        try {
            const response = await POST(local({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "synthetic browser agent", dataset: "demo", mode: "unknown" }) }), { params: Promise.resolve({ segments: ["search"] }) });
            expect(response.status).toBe(422);
            expect(historyRepository).not.toHaveBeenCalled();
        } finally { log.mockRestore(); }
    });
});