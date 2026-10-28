import { describe, expect, it, vi } from "vitest";
import type { Client } from "@elastic/elasticsearch";
import { HistoryRepository } from "../../src/lib/elastic/repository";
import { mergeRecords } from "../../src/lib/history/merge";
import { jsonProvider } from "../../src/lib/history/providers";

const records = jsonProvider.parse('[{"url":"https://example.com/page","title":"A page","visited_at":"2026-07-14T10:00:00Z","page_content":"Original synthetic page content."}]').records;
const document = mergeRecords(undefined, records, "demo").document;
function setup(existing = true, status = 200) {
    const bulk = vi.fn(async () => ({ items: [{ [existing ? "update" : "create"]: { status, ...(status >= 300 ? { error: { type: "test_failure" } } : {}) } }] }));
    const client = {
        indices: { exists: vi.fn(async () => true), getMapping: vi.fn(async () => ({ data: { mappings: { _meta: { schema_version: 1, inference_id: ".elser-2-elastic" } } } })) },
        mget: vi.fn(async () => ({ docs: existing ? [{ _id: document.id, found: true, _source: document, _seq_no: 7, _primary_term: 1 }] : [{ _id: document.id, found: false }] })), bulk,
    };
    return { repository: new HistoryRepository(client as unknown as Client, "isis-test", ".elser-2-elastic"), bulk };
}

describe("alias-protected Elastic writes", () => {
    it("does not write or infer for an identical import", async () => {
        const { repository, bulk } = setup();
        expect((await repository.importGroups("demo", [records])).unchanged).toBe(1);
        expect(bulk).not.toHaveBeenCalled();
    });
    it("uses bulk partial update without semantic_text for a new visit", async () => {
        const { repository, bulk } = setup();
        await repository.importGroups("demo", [[{ ...records[0], visited_at: "2026-10-25T00:00:00.000Z" }]]);
        const request = bulk.mock.calls[0] as unknown as [{ operations: { doc?: { semantic_text?: string } }[]; require_alias: boolean }];
        expect(request[0].require_alias).toBe(true);
        expect(request[0].operations[1].doc?.semantic_text).toBeUndefined();
        expect(JSON.stringify(request[0].operations[0])).toContain('"if_seq_no":7');
    });
    it("reports failed bulk items rather than claiming successful indexing", async () => {
        const { repository } = setup(false, 500);
        const report = await repository.importGroups("demo", [records]);
        expect(report.failed).toBe(1); expect(report.persisted).toBe(0); expect(report.pageIds).toHaveLength(0);
    });
});