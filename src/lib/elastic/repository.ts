import type { Client, estypes } from "@elastic/elasticsearch";
import { AppError, errorStatus } from "../errors";
import { mergeRecords, withContentHash } from "../history/merge";
import type { Dataset, HistoryRecord, PageDocument } from "../history/schema";
import { configuration, elasticClient, indexName } from "./client";
import { pageMappings } from "./mappings";

export type BatchReport = { processed: number; persisted: number; unchanged: number; failed: number; pageIds: string[]; errors: { id: string; code: string }[] };
type Snapshot = { document: PageDocument; sequence: number; primary: number };

export class HistoryRepository {
    private initialized = new Set<string>();
    public uncertainWrite = false;
    constructor(readonly client: Client, readonly prefix: string, readonly inferenceId: string) { }
    index(dataset: Dataset) { return indexName(dataset, this.prefix); }

    async ensure(dataset: Dataset) {
        const alias = this.index(dataset);
        if (this.initialized.has(alias)) return;
        const backing = `${alias}-data`;
        if (!(await this.client.indices.exists({ index: alias }))) {
            try { await this.client.indices.create({ index: backing, mappings: pageMappings(this.inferenceId), aliases: { [alias]: { is_write_index: true } } }); }
            catch (error) { if (errorStatus(error) !== 400) throw error; }
        }
        const response = await this.client.indices.getMapping({ index: alias });
        const mappings = Object.values(response);
        if (mappings.length !== 1 || mappings[0].mappings._meta?.schema_version !== 1 || mappings[0].mappings._meta?.inference_id !== this.inferenceId) {
            throw new AppError("mapping_mismatch", "The application index uses an incompatible mapping or model. Use a separate index prefix.", 503);
        }
        this.initialized.add(alias);
    }

    async snapshots(dataset: Dataset, ids: string[]): Promise<Map<string, Snapshot>> {
        const result = new Map<string, Snapshot>();
        if (!ids.length) return result;
        try {
            const response = await this.client.mget<PageDocument>({ index: this.index(dataset), ids, _source_excludes: ["_inference_fields"] });
            for (const doc of response.docs) {
                if ("found" in doc && doc.found && doc._source) result.set(doc._id, { document: doc._source, sequence: doc._seq_no!, primary: doc._primary_term! });
                else if ("error" in doc && doc.error) throw new AppError("read_failed", "An indexed page could not be read safely.", 503);
            }
        } catch (error) { if (errorStatus(error) !== 404) throw error; }
        return result;
    }

    async getMany(dataset: Dataset, ids: string[]) {
        return [...(await this.snapshots(dataset, ids)).values()].map((snapshot) => snapshot.document);
    }

    private async bulk(operations: estypes.BulkRequest["operations"]) {
        try {
            return await this.client.bulk({ operations, require_alias: true, refresh: "wait_for" }, { requestTimeout: 55000 });
        } catch (error) {
            if (errorStatus(error) === undefined) this.uncertainWrite = true;
            throw error;
        }
    }

    async importGroups(dataset: Dataset, groups: HistoryRecord[][], retries = 2): Promise<BatchReport> {
        await this.ensure(dataset);
        const snapshots = await this.snapshots(dataset, groups.map((group) => group[0].id));
        const operations: NonNullable<estypes.BulkRequest["operations"]> = [];
        const pending: HistoryRecord[][] = [];
        const report: BatchReport = { processed: groups.length, persisted: 0, unchanged: 0, failed: 0, pageIds: [], errors: [] };
        for (const group of groups) {
            const id = group[0].id;
            const snapshot = snapshots.get(id);
            try {
                const merged = mergeRecords(snapshot?.document, group, dataset);
                if (!merged.changed) { report.unchanged++; report.pageIds.push(id); continue; }
                if (snapshot) {
                    const patch: Partial<PageDocument> = { ...merged.document };
                    if (!merged.semanticChanged) delete patch.semantic_text;
                    operations.push({ update: { _index: this.index(dataset), _id: id, if_seq_no: snapshot.sequence, if_primary_term: snapshot.primary } }, { doc: patch });
                } else operations.push({ create: { _index: this.index(dataset), _id: id } }, merged.document);
                pending.push(group);
            } catch (error) {
                report.failed++; report.errors.push({ id, code: error instanceof AppError ? error.code : "merge_failed" });
            }
        }
        if (operations.length) {
            const response = await this.bulk(operations);
            for (const [position, item] of response.items.entries()) {
                const outcome = item.create ?? item.update;
                const group = pending[position];
                if (!outcome || !group) throw new AppError("bulk_response", "Elasticsearch returned an incomplete write result.", 503);
                if (outcome.status === 409 && retries > 0) {
                    const retry = await this.importGroups(dataset, [group], retries - 1);
                    report.persisted += retry.persisted; report.unchanged += retry.unchanged; report.failed += retry.failed;
                    report.errors.push(...retry.errors); report.pageIds.push(...retry.pageIds);
                } else if (outcome.error || outcome.status >= 300) {
                    report.failed++; report.errors.push({ id: group[0].id, code: outcome.status === 409 ? "write_conflict" : "index_write_failed" });
                } else { report.persisted++; report.pageIds.push(group[0].id); }
            }
            if (response.items.length !== pending.length) throw new AppError("bulk_response", "Elasticsearch returned an incomplete write result.", 503);
        }
        return report;
    }

    async patch(dataset: Dataset, id: string, update: Partial<PageDocument>, retries = 2): Promise<void> {
        const snapshot = (await this.snapshots(dataset, [id])).get(id);
        if (!snapshot) throw new AppError("page_missing", "The page is no longer available.", 409);
        const next = withContentHash({ ...snapshot.document, ...update, updated_at: new Date().toISOString() });
        const patch: Partial<PageDocument> = { ...next };
        if (next.content_hash === snapshot.document.content_hash) delete patch.semantic_text;
        const response = await this.bulk([{ update: { _index: this.index(dataset), _id: id, if_seq_no: snapshot.sequence, if_primary_term: snapshot.primary } }, { doc: patch }]);
        const outcome = response.items[0]?.update;
        if (outcome?.status === 409 && retries) return this.patch(dataset, id, update, retries - 1);
        if (!outcome || outcome.error || outcome.status >= 300) throw new AppError("patch_failed", "The enrichment outcome could not be stored.", 503);
    }

    async stats(dataset: Dataset) {
        try {
            const response = await this.client.search({ index: this.index(dataset), size: 0, track_total_hits: true, aggs: { visits: { value_count: { field: "visited_at" } }, fetch: { terms: { field: "fetch_status", size: 5 } } } });
            const aggregations = response.aggregations as { visits: { value: number }; fetch: { buckets: { key: string; doc_count: number }[] } };
            return { dataset, pages: typeof response.hits.total === "object" ? response.hits.total.value : 0, knownVisits: aggregations.visits.value, fetch: aggregations.fetch.buckets };
        } catch (error) { if (errorStatus(error) === 404) return { dataset, pages: 0, knownVisits: 0, fetch: [] }; throw error; }
    }

    async deleteAll() {
        if (this.uncertainWrite) throw new AppError("write_uncertain", "A previous Cloud write timed out. Verify outstanding writes in Elastic before restarting and deleting; deletion cannot yet be confirmed.", 503);
        for (const dataset of ["demo", "personal"] as const) {
            const backing = `${this.index(dataset)}-data`;
            try { await this.client.indices.delete({ index: backing }); } catch (error) { if (errorStatus(error) !== 404) throw error; }
            if (await this.client.indices.exists({ index: backing })) throw new AppError("delete_unverified", "Elasticsearch deletion could not be verified.", 503);
        }
        this.initialized.clear();
    }
}

let repository: HistoryRepository | undefined;
export function historyRepository() {
    const config = configuration();
    repository ??= new HistoryRepository(elasticClient(), config.prefix, config.inferenceId);
    return repository;
}