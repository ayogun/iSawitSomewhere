import { randomBytes } from "node:crypto";
import queries from "../fixtures/queries.json";
import { elasticClient } from "../src/lib/elastic/client";
import { HistoryRepository } from "../src/lib/elastic/repository";
import { groupRecords, jsonProvider } from "../src/lib/history/providers";
import type { HistoryRecord } from "../src/lib/history/schema";
import { pageId } from "../src/lib/history/url";
import { sampleAnchor, sampleRecords } from "../src/lib/sample";
import { searchHistory } from "../src/lib/search/service";
import { searchSchema, type RetrievalMode } from "../src/lib/search/query";
import { AppError } from "../src/lib/errors";
import { runCli, requireCloudConsent } from "./cli";

const modes: RetrievalMode[] = ["lexical", "semantic", "hybrid"];
function judgment(ids: string[], relevant: string[]) {
    const wanted = new Set(relevant.map(pageId));
    const first = ids.findIndex((id) => wanted.has(id));
    const dcg = ids.slice(0, 10).reduce((sum, id, rank) => sum + (wanted.has(id) ? 1 / Math.log2(rank + 2) : 0), 0);
    const ideal = Array.from({ length: Math.min(wanted.size, 10) }, (_, rank) => 1 / Math.log2(rank + 2)).reduce((sum, value) => sum + value, 0);
    return { recall5: wanted.size ? ids.slice(0, 5).filter((id) => wanted.has(id)).length / wanted.size : 0, mrr10: first >= 0 && first < 10 ? 1 / (first + 1) : 0, ndcg10: ideal ? dcg / ideal : 0, rank: first < 0 ? 100 : first + 1 };
}

void runCli(async () => {
    const config = requireCloudConsent();
    const prefix = `isis-eval-${randomBytes(6).toString("hex")}`;
    const repository = new HistoryRepository(elasticClient(), prefix, config.inferenceId);
    const performanceRun = process.argv.includes("--performance");
    try {
        const records: HistoryRecord[] = sampleRecords(sampleAnchor);
        if (performanceRun) {
            for (let batch = 0; batch < 2; batch++) {
                const generated = Array.from({ length: 4970 }, (_, index) => ({
                    url: `https://example.com/benchmark/${index + batch * 4970}`,
                    title: `Synthetic maintenance note ${index + batch * 4970}`,
                    visited_at: sampleAnchor.toISOString(),
                    page_content: "Original synthetic benchmark note about organising a workshop, cataloguing supplies and planning maintenance.",
                }));
                records.push(...jsonProvider.parse(JSON.stringify(generated)).records.map((record) => ({ ...record, source: "synthetic" as const })));
            }
        }
        const groups = groupRecords(records);
        for (let cursor = 0; cursor < groups.length; cursor += 25) {
            const report = await repository.importGroups("demo", groups.slice(cursor, cursor + 25));
            if (report.failed) throw new AppError("evaluation_indexing_failed", "Synthetic evaluation indexing was incomplete.", 503);
        }
        const judgments = new Map<string, ReturnType<typeof judgment>>();
        let hybridHoldoutRecall = 0;
        let hybridParaphraseImprovements = 0;
        for (const mode of modes) {
            const holdout: ReturnType<typeof judgment>[] = [];
            let negativeCandidates = 0;
            for (const [index, query] of queries.entries()) {
                const response = await searchHistory(repository, searchSchema.parse({ query: query.query, dataset: "demo", debug: false }), sampleAnchor, mode);
                if (response.mode !== mode) throw new AppError("evaluation_degraded", "A retrieval stage was unavailable. Degraded lexical results cannot be counted as a hybrid benchmark.", 503);
                const result = judgment(response.results.map((item) => item.id), query.relevant);
                judgments.set(`${mode}:${index}`, result);
                if (query.split === "holdout" && query.relevant.length) holdout.push(result);
                if (!query.relevant.length) negativeCandidates += response.results.length;
                if (mode === "hybrid" && query.split === "holdout" && query.relevant.length && query.query !== "Browser Use" && result.rank < (judgments.get(`lexical:${index}`)?.rank ?? 100)) hybridParaphraseImprovements++;
                if (mode === "hybrid" && query.query === "Browser Use" && result.rank > 3) throw new AppError("exact_title_failed", "The exact-title golden query did not place the expected page in the top three.", 422);
                if (mode === "hybrid" && index < 2 && result.rank > 3) throw new AppError("golden_query_failed", `Golden synthetic query ${index + 1} did not place the expected page in the top three.`, 422);
            }
            const mean = (field: "recall5" | "mrr10" | "ndcg10") => holdout.reduce((sum, value) => sum + value[field], 0) / holdout.length;
            if (mode === "hybrid") hybridHoldoutRecall = mean("recall5");
            console.info(JSON.stringify({ mode, holdoutRecall5: mean("recall5"), holdoutMrr10: mean("mrr10"), holdoutNdcg10: mean("ndcg10"), positiveHoldoutQueries: holdout.length, negativeCandidateCount: negativeCandidates, labels: "possible_only_not_confidence", pages: groups.length, model: config.inferenceId }));
        }
        if (performanceRun) {
            const durations: number[] = [];
            for (let index = 0; index < 101; index++) {
                const started = performance.now();
                await searchHistory(repository, searchSchema.parse({ query: queries[index % queries.length].query, dataset: "demo" }), sampleAnchor);
                if (index) durations.push(performance.now() - started);
            }
            durations.sort((left, right) => left - right);
            console.info(JSON.stringify({ benchmark: "warm_service_latency_not_browser_e2e", requests: durations.length, pages: groups.length, p95Ms: Math.round(durations[Math.ceil(durations.length * 0.95) - 1]), inferenceId: config.inferenceId }));
        }
        console.info(JSON.stringify({ hybridParaphraseImprovements, required: 2, holdoutTarget: 0.85 }));
        if (hybridHoldoutRecall < 0.85 || hybridParaphraseImprovements < 2) throw new AppError("retrieval_gate_failed", "Measured retrieval does not yet meet the specification. Do not tune against holdout silently; record findings before changing the search contract.", 422);
    } finally { await repository.deleteAll(); console.info(JSON.stringify({ outcome: "evaluation_indices_deleted", prefix })); }
});