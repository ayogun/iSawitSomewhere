import { AppError, errorStatus } from "../errors";
import type { HistoryRepository } from "../elastic/repository";
import type { PageDocument } from "../history/schema";
import { meaningfulTerms, parseClues } from "./clues";
import { candidateWindow, buildSearch, type RetrievalMode, type SearchInput } from "./query";
import { hasLexicalEvidence, scoreTrace, toResult, type SearchResult } from "./evidence";

export async function searchHistory(repository: HistoryRepository, input: SearchInput, now = new Date(), requestedMode: RetrievalMode = input.mode) {
    const started = performance.now();
    const clues = parseClues(input.query, now);
    if (!meaningfulTerms(clues.concept).length) throw new AppError("subject_required", "Add what the page was about, not just a source or date.", 422);
    const signal = AbortSignal.timeout(10000);
    let mode = requestedMode;
    let query = buildSearch(repository.index(input.dataset), input, clues, mode);
    const warnings = [...clues.warnings];
    let response;
    try { response = await repository.client.search<PageDocument>(query, { signal }); }
    catch (error) {
        if (errorStatus(error) === 404) return { mode, status: "no_matches" as const, clues, results: [], warnings, latencyMs: Math.round(performance.now() - started), elasticTook: 0 };
        const status = errorStatus(error);
        const detail = error && typeof error === "object" && "meta" in error ? JSON.stringify((error as { meta?: { body?: { error?: unknown } } }).meta?.body?.error ?? "") : "";
        const inferenceFailure = mode === "hybrid" && (status === 429 || status === 502 || status === 503 || status === 504 || ((status === 400 || status === 500) && /inference|model.*unavailable/i.test(detail)));
        if (!inferenceFailure || signal.aborted) throw error;
        mode = "lexical";
        query = buildSearch(repository.index(input.dataset), input, clues, mode);
        warnings.push("Semantic search is unavailable. These results use keyword search only.");
        response = await repository.client.search<PageDocument>(query, { signal });
    }
    if (response.timed_out || response._shards.failed) throw new AppError("search_incomplete", "Search did not finish completely. Please retry.", 504);
    const results = response.hits.hits.map((hit) => toResult(hit, clues)).filter((result): result is SearchResult => result !== null).slice(0, 10);
    const status = !results.length ? "no_matches" : results.some((result) => hasLexicalEvidence(result, clues)) ? "possible_matches" : "no_confident_matches";
    return {
        mode, status, clues, results, warnings, latencyMs: Math.round(performance.now() - started), elasticTook: response.took,
        ...(input.debug ? { trace: { requestedCandidateWindow: mode === "hybrid" ? candidateWindow : query.size ?? null, returnedCandidates: response.hits.hits.length, stages: mode === "hybrid" ? ["bm25", "elser", "metadata", "rrf"] : [mode === "lexical" ? "bm25" : "elser", "metadata"], query, scores: response.hits.hits.slice(0, 10).map((hit) => scoreTrace(hit, clues)) } } : {}),
    };
}

export type SearchResponse = Awaited<ReturnType<typeof searchHistory>>;