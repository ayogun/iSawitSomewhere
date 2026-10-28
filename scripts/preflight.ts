import { randomBytes, createHash } from "node:crypto";
import { elasticClient } from "../src/lib/elastic/client";
import { HistoryRepository } from "../src/lib/elastic/repository";
import { groupRecords } from "../src/lib/history/providers";
import { sampleAnchor, sampleRecords } from "../src/lib/sample";
import { parseClues } from "../src/lib/search/clues";
import { buildSearch, searchSchema } from "../src/lib/search/query";
import { findRrfExplanation } from "../src/lib/search/evidence";
import { runCli, requireCloudConsent } from "./cli";
import { AppError } from "../src/lib/errors";

function requireCapability(condition: unknown, code: string, message: string): asserts condition {
    if (!condition) throw new AppError(code, message, 503);
}

function stage(name: string) {
    console.info(JSON.stringify({ stage: name }));
}

void runCli(async () => {
    const config = requireCloudConsent();
    const client = elasticClient();
    stage("deployment_and_endpoint");
    const info = await client.info();
    const [major, minor] = info.version.number.split(".").map(Number);
    if (major !== 9 || minor < 2) throw new AppError("unsupported_version", "Use the documented Elasticsearch Hosted 9.2+ capability profile.", 503);
    const endpoint = await client.inference.get({ inference_id: config.inferenceId });
    const elser = endpoint.endpoints.find((item) => item.inference_id === config.inferenceId);
    if (!elser || elser.service !== "elastic" || elser.task_type !== "sparse_embedding") throw new AppError("endpoint_mismatch", "The configured endpoint must be Elastic-hosted ELSER sparse inference.", 503);
    const prefix = `isis-check-${randomBytes(6).toString("hex")}`;
    const repository = new HistoryRepository(client, prefix, config.inferenceId);
    try {
        stage("synthetic_indexing");
        const records = sampleRecords(sampleAnchor).filter((record) => record.url.includes("/browser-use/") || record.url.includes("/sourdough"));
        const groups = groupRecords(records);
        const imported = await repository.importGroups("demo", groups);
        requireCapability(imported.failed === 0, "probe_indexing_failed", "Synthetic probe indexing was incomplete. No private history was used.");
        stage("repeat_import");
        const repeated = await repository.importGroups("demo", groups);
        requireCapability(repeated.unchanged === groups.length, "probe_idempotency_failed", "Repeated synthetic import unexpectedly changed an indexed page.");
        stage("hybrid_retrieval");
        const input = searchSchema.parse({ query: "AI agent that controls a browser probably GitHub a few months ago", dataset: "demo", debug: true });
        const response = await client.search(buildSearch(repository.index("demo"), input, parseClues(input.query, sampleAnchor)));
        requireCapability(!response.timed_out && !response._shards.failed, "probe_search_incomplete", "The synthetic retrieval probe did not complete.");
        requireCapability(response.hits.hits.some((hit) => findRrfExplanation(hit._explanation)), "probe_explanation_missing", "The deployment did not return the expected RRF explanation.");
        requireCapability(response.hits.hits.some((hit) => Object.keys(hit.highlight ?? {}).length), "probe_highlights_missing", "The deployment did not return indexed highlight evidence.");
        stage("bulk_embedding_preservation");
        const id = records[0].id;
        const embeddings = async () => {
            const snapshot = await client.search<Record<string, unknown>>({ index: repository.index("demo"), query: { ids: { values: [id] } }, _source: { exclude_vectors: false }, size: 1 });
            const value = snapshot.hits.hits[0]?._source?._inference_fields;
            requireCapability(value, "probe_embeddings_missing", "Stored inference fields are not inspectable in this deployment profile.");
            return createHash("sha256").update(JSON.stringify(value)).digest("hex");
        };
        const before = await embeddings();
        await repository.importGroups("demo", [[{ ...records[0], visited_at: "2026-10-25T12:00:00.001Z" }]]);
        requireCapability(await embeddings() === before, "probe_embeddings_changed", "A metadata-only Bulk update unexpectedly changed stored embeddings.");
        stage("historical_visit_filter");
        const filtered = searchSchema.parse({ ...input, filters: { start: "2026-07-01T00:00:00Z", end: "2026-08-01T00:00:00Z" } });
        const historical = await client.search(buildSearch(repository.index("demo"), filtered, parseClues(input.query, sampleAnchor)));
        requireCapability(historical.hits.hits.some((hit) => hit._id === id), "probe_historical_visit_missing", "The historical visit was not retrievable after a synthetic revisit.");
        console.info(JSON.stringify({ outcome: "capabilities_passed", version: info.version.number, inferenceId: config.inferenceId, probe: prefix, capabilities: ["semantic_text", "elser", "bm25", "function_score", "rrf", "explain", "highlights", "any_visit_filter", "bulk_embedding_preservation"] }));
    } finally {
        await repository.deleteAll();
        console.info(JSON.stringify({ outcome: "probe_indices_deleted", prefix }));
    }
});