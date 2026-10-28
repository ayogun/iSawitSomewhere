import type { estypes } from "@elastic/elasticsearch";
import { z } from "zod";
import { datasetSchema, timestampSchema } from "../history/schema";
import type { Clues } from "./clues";

export const retrievalModeSchema = z.enum(["hybrid", "lexical", "semantic"]);
export type RetrievalMode = z.infer<typeof retrievalModeSchema>;

export const searchSchema = z.object({
    query: z.string().trim().min(3).max(1000),
    dataset: datasetSchema,
    mode: retrievalModeSchema.default("hybrid"),
    debug: z.boolean().default(false),
    filters: z.object({ domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+$/).max(253).optional(), start: timestampSchema.optional(), end: timestampSchema.optional() }).optional(),
}).refine((input) => !input.filters?.start || !input.filters?.end || Date.parse(input.filters.start) < Date.parse(input.filters.end), { message: "Start must precede end.", path: ["filters"] });

export type SearchInput = z.infer<typeof searchSchema>;
export const rankConstant = 60;
export const candidateWindow = 100;

export function buildSearch(index: string, input: SearchInput, clues: Clues, mode: RetrievalMode = input.mode): estypes.SearchRequest {
    const filters: estypes.QueryDslQueryContainer[] = [];
    if (input.filters?.domain) filters.push({ term: { domain: input.filters.domain } });
    if (input.filters?.start || input.filters?.end) filters.push({ range: { visited_at: { ...(input.filters.start ? { gte: input.filters.start } : {}), ...(input.filters.end ? { lt: input.filters.end } : {}) } } });
    const modifiers: estypes.QueryDslFunctionScoreContainer[] = [];
    if (clues.domain) modifiers.push({ filter: { term: { domain: clues.domain } }, weight: 1.25 });
    if (clues.time) modifiers.push({ filter: { range: { visited_at: { gte: clues.time.start, lt: clues.time.end } } }, weight: 1.15 });
    const child = (query: estypes.QueryDslQueryContainer, name: string): estypes.RetrieverContainer => ({
        standard: {
            query: {
                function_score: {
                    _name: name,
                    query: { bool: { must: [query], filter: filters } },
                    functions: modifiers, score_mode: "multiply", boost_mode: "multiply",
                }
            }
        },
    });
    const lexical = child({ multi_match: { query: clues.concept, fields: ["title^4", "description^2", "content", "url_search"], type: "best_fields" } }, "bm25");
    const semantic = child({ match: { semantic_text: { query: clues.concept } } }, "elser");
    return {
        index, size: 30, timeout: "8s", explain: true, track_total_hits: false,
        retriever: mode === "hybrid" ? { rrf: { retrievers: [lexical, semantic], rank_constant: rankConstant, rank_window_size: candidateWindow } } : mode === "lexical" ? lexical : semantic,
        _source: { excludes: ["semantic_text", "_inference_fields", "url_search"] },
        highlight: { pre_tags: [""], post_tags: [""], fields: { title: { number_of_fragments: 0 }, description: { fragment_size: 260, number_of_fragments: 1 }, content: { fragment_size: 260, number_of_fragments: 1 }, ...(mode === "lexical" ? {} : { semantic_text: { type: "semantic", number_of_fragments: 1, order: "score" } }) } },
    };
}