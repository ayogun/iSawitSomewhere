import { describe, expect, it, vi } from "vitest";
import { WorkflowState, workflows } from "../../src/lib/workflows";
import { jsonProvider } from "../../src/lib/history/providers";
import type { HistoryRepository } from "../../src/lib/elastic/repository";
import { sampleRecords, sampleAnchor } from "../../src/lib/sample";

const parsed = () => jsonProvider.parse('[{"url":"https://example.com/page","title":"Page","visited_at":"2026-10-25T00:00:00Z"}]');

describe("ephemeral consent and mutation coordination", () => {
    it("previews without a repository or network calls", () => {
        const state = new WorkflowState();
        const preview = state.createPreview(parsed(), "personal");
        expect(preview.uniqueUrls).toBe(1); expect(preview.domains).toEqual([{ domain: "example.com", count: 1, eligible: 1 }]);
    });
    it("invalidates a previous preview and expires tickets", () => {
        const state = new WorkflowState();
        const previous = state.createPreview(parsed(), "personal");
        const current = state.createPreview(parsed(), "personal");
        expect(() => state.getPreview(previous.previewId)).toThrow();
        expect(state.getPreview(current.previewId).id).toBe(current.previewId);
        const expired = state.createPreview(parsed(), "personal", Date.now() - 700000);
        expect(() => state.getPreview(expired.previewId)).toThrow();
    });
    it("serializes writes and blocks overlaps", async () => {
        const state = new WorkflowState();
        let finish!: () => void;
        const first = state.mutate(() => new Promise<void>((resolve) => { finish = resolve; }));
        await Promise.resolve();
        await expect(state.mutate(async () => undefined)).rejects.toThrow("Another data operation");
        finish(); await first;
    });
    it("releases preview contents on expiry without another request", async () => {
        vi.useFakeTimers();
        try {
            const state = new WorkflowState();
            state.createPreview(parsed(), "personal");
            await vi.advanceTimersByTimeAsync(600001);
            expect(state.preview).toBeNull();
        } finally { vi.useRealTimers(); }
    });
    it("keeps active batched imports alive beyond ten minutes but expires idle previews", async () => {
        vi.useFakeTimers();
        try {
            const state = new WorkflowState();
            const history = jsonProvider.parse(JSON.stringify(Array.from({ length: 26 }, (_, index) => ({ url: `https://example.com/synthetic/${index}`, title: "Synthetic page", visited_at: "2026-10-25T00:00:00Z" }))));
            const preview = state.createPreview(history, "personal");
            const importGroups = vi.fn(async () => ({ processed: 25, persisted: 25, unchanged: 0, failed: 0, pageIds: [], errors: [] }));
            const repository = { importGroups } as unknown as HistoryRepository;
            await vi.advanceTimersByTimeAsync(590000);
            await state.commit(repository, preview.previewId, 0, false);
            await vi.advanceTimersByTimeAsync(590000);
            expect(state.getPreview(preview.previewId).nextCursor).toBe(25);
            await state.commit(repository, preview.previewId, 25, false);
            expect(importGroups).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(600001);
            expect(state.preview).toBeNull();
        } finally { vi.useRealTimers(); }
    });
    it("does not restore a preview discarded while a batch was running", async () => {
        const state = new WorkflowState();
        const preview = state.createPreview(parsed(), "personal");
        const repository = { importGroups: async () => { state.discardPreview(preview.previewId); return { processed: 1, persisted: 1, unchanged: 0, failed: 0, pageIds: [], errors: [] }; } } as unknown as HistoryRepository;
        await state.commit(repository, preview.previewId, 0, false);
        expect(state.preview).toBeNull();
    });
    it("deletion aborts fetches and waits for the active writer", async () => {
        const state = new WorkflowState();
        state.createPreview(parsed(), "personal");
        const events: string[] = [];
        const active = state.mutate(async (signal) => {
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => { events.push("aborted"); resolve(); }));
            events.push("writer-settled");
        });
        await Promise.resolve();
        const repository = { deleteAll: vi.fn(async () => { events.push("deleted"); }) } as unknown as HistoryRepository;
        await state.deleteAll(repository); await active;
        expect(events).toEqual(["aborted", "writer-settled", "deleted"]);
        expect(state.preview).toBeNull(); expect(state.enrichment).toBeNull();
    });
    it("creates reproducible original synthetic history with >=60 pages and >=100 visits", () => {
        const records = sampleRecords(sampleAnchor);
        expect(new Set(records.map((record) => record.id)).size).toBe(60);
        expect(records.length).toBeGreaterThanOrEqual(100);
        expect(records.every((record) => record.source === "synthetic")).toBe(true);
    });
    it("does not recreate a preview when upload parsing finishes after deletion", async () => {
        const state = new WorkflowState();
        const generation = state.generation;
        await state.deleteAll({ deleteAll: async () => { } } as unknown as HistoryRepository);
        expect(() => state.createPreview(parsed(), "personal", Date.now(), generation)).toThrow("deleted while this upload");
        expect(state.preview).toBeNull();
    });
    it("upgrades cached workflow methods after reload without discarding the preview", async () => {
        const preview = workflows.createPreview(parsed(), "personal");
        try {
            vi.resetModules();
            const reloaded = await import("../../src/lib/workflows");
            expect(reloaded.workflows).toBe(workflows);
            expect(Object.getPrototypeOf(reloaded.workflows)).toBe(reloaded.WorkflowState.prototype);
            expect(reloaded.workflows.getPreview(preview.previewId).id).toBe(preview.previewId);
        } finally { workflows.discardPreview(preview.previewId); }
    });
});