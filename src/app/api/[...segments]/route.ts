import { z } from "zod";
import { configuration } from "@/lib/elastic/client";
import { historyRepository } from "@/lib/elastic/repository";
import { AppError } from "@/lib/errors";
import { apiResponse, boundedBody, jsonBody } from "@/lib/http";
import { csvProvider, jsonProvider } from "@/lib/history/providers";
import { datasetSchema, maxHistoryFileBytes, maxHistoryFileMiB, maxHistoryRecords } from "@/lib/history/schema";
import { demoRecords } from "@/lib/sample";
import { workflows } from "@/lib/workflows";
import { publicEnricher, runEnrichment } from "@/lib/enrichment/coordinator";
import { searchHistory } from "@/lib/search/service";
import { searchSchema } from "@/lib/search/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const cursor = z.number().int().min(0).max(maxHistoryRecords);
const pageIds = z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(100);
const globalApi = globalThis as typeof globalThis & { isisSearches?: number };

async function route(request: Request, context: { params: Promise<{ segments: string[] }> }) {
    const { segments } = await context.params;
    const path = segments.join("/");
    const operation = ["health", "imports", "enrichment", "search", "history"].includes(segments[0]) ? segments[0] : "unknown";
    return apiResponse(request, operation, async () => {
        if (request.method === "GET" && path === "health") {
            const config = configuration();
            return { configured: config.configured, profile: "Elastic Cloud Hosted 9.2+ / ELSER on EIS", inferenceId: config.inferenceId };
        }
        if (request.method === "GET" && path === "history/stats") {
            const repository = historyRepository();
            return { datasets: await Promise.all((["demo", "personal"] as const).map((dataset) => repository.stats(dataset))) };
        }
        if (request.method === "POST" && path === "imports/preview") {
            const generation = workflows.generation;
            if (request.headers.get("content-type")?.startsWith("application/json")) {
                await jsonBody(request, z.object({ sample: z.literal(true) }));
                const records = demoRecords();
                return workflows.createPreview({ records, issues: [], warnings: ["All text and visits are synthetic. Sample loading uses Cloud storage and paid inference."], rowCount: records.length }, "demo", Date.now(), generation);
            }
            const bytes = await boundedBody(request, maxHistoryFileBytes + 65536);
            let form: FormData;
            try { form = await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body: bytes as BodyInit }).formData(); }
            catch { throw new AppError("invalid_upload", "Choose a JSON or CSV history file.", 422); }
            const file = form.get("file");
            if (!(file instanceof File) || !/\.(?:json|csv)$/i.test(file.name)) throw new AppError("invalid_upload", "Choose a .json or .csv history file.", 422);
            if (file.size > maxHistoryFileBytes) throw new AppError("file_limit", `History files are limited to ${maxHistoryFileMiB} MiB.`, 413);
            if (form.get("dataset") !== "personal") throw new AppError("invalid_dataset", "File uploads belong to the personal dataset.", 422);
            let text: string;
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
            catch { throw new AppError("invalid_encoding", "History files must use UTF-8 encoding.", 422); }
            const parsed = /\.csv$/i.test(file.name) ? csvProvider.parse(text) : jsonProvider.parse(text);
            return workflows.createPreview(parsed, "personal", Date.now(), generation);
        }
        if (request.method === "POST" && segments[0] === "imports" && segments.length === 3 && segments[2] === "commit") {
            const body = await jsonBody(request, z.object({ cloudConsent: z.literal(true), validOnly: z.boolean(), cursor }));
            return workflows.commit(historyRepository(), segments[1], body.cursor, body.validOnly);
        }
        if (request.method === "DELETE" && segments[0] === "imports" && segments.length === 2) {
            workflows.discardPreview(segments[1]);
            return { discarded: true };
        }
        if (request.method === "POST" && path === "enrichment/preview") {
            const body = await jsonBody(request, z.object({ dataset: datasetSchema, pageIds }));
            return workflows.enrichmentPreview(historyRepository(), body.dataset, body.pageIds);
        }
        if (request.method === "POST" && segments[0] === "enrichment" && segments.length === 3 && segments[2] === "run") {
            const body = await jsonBody(request, z.object({ approvedDomains: z.array(z.string().max(253)).max(100), cursor }));
            return runEnrichment(workflows, historyRepository(), segments[1], body.approvedDomains, body.cursor);
        }
        if (request.method === "POST" && path === "search") {
            const input = await jsonBody(request, searchSchema);
            if ((globalApi.isisSearches ?? 0) >= 2) throw new AppError("search_capacity", "Wait for the current searches to finish.", 429);
            globalApi.isisSearches = (globalApi.isisSearches ?? 0) + 1;
            try {
                const response = await searchHistory(historyRepository(), input);
                console.info(JSON.stringify({ operation: "retrieval", latencyMs: response.latencyMs, elasticTook: response.elasticTook, returned: response.results.length, mode: response.mode, stages: response.mode === "hybrid" ? ["bm25", "elser", "metadata", "rrf"] : [response.mode === "lexical" ? "bm25" : "elser", "metadata"] }));
                return response;
            } finally { globalApi.isisSearches--; }
        }
        if (request.method === "DELETE" && path === "history") {
            await jsonBody(request, z.object({ confirmation: z.literal("DELETE ALL HISTORY") }));
            return workflows.deleteAll(historyRepository(), () => publicEnricher.clear());
        }
        throw new AppError("not_found", "API endpoint not found.", 404);
    });
}

export { route as GET, route as POST, route as DELETE };