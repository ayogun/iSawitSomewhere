import type { estypes } from "@elastic/elasticsearch";
import type { PageDocument } from "../history/schema";
import { semanticInput } from "../history/merge";
import { meaningfulTerms, type Clues } from "./clues";

export type SearchResult = {
    id: string; title: string; url: string; domain: string; lastVisitedAt: string;
    matchingVisitAt: string | null; observedVisitCount: number; reportedVisitCount: number;
    snippet: string; evidenceSource: "matching_passage" | "indexed_excerpt";
    why: string; matchedClues: string[]; fetchStatus: string; label: "Possible match";
};

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

export function toResult(hit: estypes.SearchHit<PageDocument>, clues: Clues): SearchResult | null {
    const doc = hit._source;
    if (!doc) return null;
    const indexed = clean(semanticInput(doc.title, doc.description ?? "", doc.content ?? ""));
    const highlights = [...(hit.highlight?.semantic_text ?? []), ...(hit.highlight?.content ?? []), ...(hit.highlight?.description ?? []), ...(hit.highlight?.title ?? [])];
    const passage = highlights.map(clean).find((fragment) => fragment && indexed.includes(fragment));
    const snippet = (passage ?? clean(doc.description || doc.content || doc.title)).slice(0, 320);
    const matchingVisitAt = clues.time ? doc.visited_at.find((date) => date >= clues.time!.start && date < clues.time!.end) ?? null : null;
    const matchedClues: string[] = [];
    if (clues.domain === doc.domain) matchedClues.push(`Source: ${doc.domain}`);
    if (matchingVisitAt) matchedClues.push("Visited in the approximate time period");
    return {
        id: doc.id, title: doc.title, url: doc.url, domain: doc.domain, lastVisitedAt: doc.last_visited_at,
        matchingVisitAt, observedVisitCount: doc.visited_at.length, reportedVisitCount: doc.imported_visit_count_max,
        snippet, evidenceSource: passage ? "matching_passage" : "indexed_excerpt",
        why: passage ? "A related passage in this indexed page:" : "From this page's indexed text:",
        matchedClues, fetchStatus: doc.fetch_status, label: "Possible match",
    };
}

export function hasLexicalEvidence(result: SearchResult, clues: Clues): boolean {
    const terms = meaningfulTerms(clues.concept);
    const evidence = new Set(meaningfulTerms(`${result.title} ${result.snippet}`));
    return terms.filter((term) => evidence.has(term)).length >= Math.min(2, terms.length || 2);
}

type SearchExplanation = NonNullable<estypes.SearchHit<PageDocument>["_explanation"]>["details"][number];

export function findRrfExplanation(explanation?: SearchExplanation): SearchExplanation | null {
    const pending = explanation ? [explanation] : [];
    while (pending.length) {
        const node = pending.shift()!;
        if (node.description?.startsWith("rrf score") && !/for rank \[\d+\]/.test(node.description)) return node;
        pending.push(...(node.details ?? []));
    }
    return null;
}

export function scoreTrace(hit: estypes.SearchHit<PageDocument>, clues: Clues) {
    const explanation = hit._explanation;
    const fusion = findRrfExplanation(explanation);
    const children = fusion ? (fusion.details ?? []).map((child) => {
        const rank = child.description?.match(/for rank \[(\d+)\]/)?.[1];
        const contribution = child.description?.match(/rrf score: \[([\d.eE+-]+)\]/)?.[1];
        const queryIndex = child.description?.match(/query at index \[(\d+)\]/)?.[1];
        const stage = /\bbm25\b/.test(child.description ?? "") ? "bm25" : /\belser\b/.test(child.description ?? "") ? "elser" : queryIndex === "0" ? "bm25" : queryIndex === "1" ? "elser" : null;
        const adjusted = child.details?.[0];
        const raw = adjusted?.description?.startsWith("function score,") ? adjusted.details?.[0]?.value : null;
        return { stage, rank: rank ? Number(rank) : null, contribution: contribution ? Number(contribution) : null, adjustedScore: adjusted?.value ?? null, rawContentScore: raw ?? null };
    }) : null;
    return {
        id: hit._id, finalScore: hit._score ?? null, children,
        metadataMultipliers: { domain: hit._source?.domain === clues.domain ? 1.25 : 1, time: clues.time && hit._source?.visited_at.some((date) => date >= clues.time!.start && date < clues.time!.end) ? 1.15 : 1 },
        explanation: explanation ?? null,
    };
}