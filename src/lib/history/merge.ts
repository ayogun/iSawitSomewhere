import { createHash } from "node:crypto";
import { AppError } from "../errors";
import { type Dataset, type HistoryRecord, type PageDocument } from "./schema";

export function semanticInput(title: string, description: string, content: string): string {
    return `Title: ${title}\nDescription: ${description}\nContent: ${content}`;
}

export function withContentHash(document: PageDocument): PageDocument {
    const text = semanticInput(document.title, document.description, document.content);
    return { ...document, semantic_text: text, content_hash: createHash("sha256").update(text).digest("hex") };
}

export function mergeRecords(existing: PageDocument | undefined, records: HistoryRecord[], dataset: Dataset, now = new Date().toISOString()) {
    const first = records[0];
    if (!first || records.some((record) => record.id !== first.id)) throw new AppError("invalid_group", "Records must identify one page.", 422);
    const visits = [...new Set([...(existing?.visited_at ?? []), ...records.map((record) => record.visited_at)])].sort();
    if (visits.length > 10000) throw new AppError("visit_limit", "This page exceeds the 10,000 known visit limit.", 422);
    const reported = Math.max(existing?.imported_visit_count_max ?? 0, ...records.map((record) => record.visit_count ?? 0));
    const document: PageDocument = existing ? { ...existing } : {
        schema_version: 1, id: first.id, url: first.url, domain: first.domain, dataset,
        source: first.source, content_type: first.domain === "github.com" ? "repository" : "page",
        title: first.title, description: "", content: "", url_search: first.url.replace(/[^\p{L}\p{N}]+/gu, " "),
        visited_at: [], first_visited_at: first.visited_at, last_visited_at: first.visited_at,
        visit_count: 0, imported_visit_count_max: 0, semantic_text: "", content_hash: "",
        content_provenance: dataset === "demo" ? "synthetic" : "imported", content_truncated: false,
        fetch_status: "not_requested", created_at: now, updated_at: now,
    };
    for (const record of records) {
        document.title = record.title;
        if (record.description?.trim()) document.description = record.description;
        if (record.page_content?.trim()) {
            document.content = record.page_content;
            document.content_provenance = dataset === "demo" ? "synthetic" : "imported";
            document.content_truncated = false;
        }
    }
    Object.assign(document, { visited_at: visits, first_visited_at: visits[0], last_visited_at: visits.at(-1), imported_visit_count_max: reported, visit_count: Math.max(visits.length, reported) });
    const result = withContentHash(document);
    const changed = !existing || JSON.stringify({ ...result, updated_at: "" }) !== JSON.stringify({ ...existing, updated_at: "" });
    if (changed) result.updated_at = now;
    return { document: result, changed, semanticChanged: result.content_hash !== existing?.content_hash };
}