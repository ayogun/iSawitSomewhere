import { z } from "zod";

export const maxHistoryFileMiB = 50;
export const maxHistoryFileBytes = maxHistoryFileMiB * 1024 * 1024;
export const maxHistoryRecords = 100000;

export const datasetSchema = z.enum(["demo", "personal"]);
export type Dataset = z.infer<typeof datasetSchema>;
export type FetchStatus = "not_requested" | "pending" | "fetched" | "skipped" | "failed";

export function validTimestamp(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false;
    if (!Number.isFinite(Date.parse(value))) return false;
    const datePart = value.slice(0, 10);
    const calendar = new Date(`${datePart}T00:00:00Z`);
    return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === datePart;
}

export const timestampSchema = z.string().refine(validTimestamp, "Use a valid RFC3339 timestamp with timezone and at most milliseconds.");
export const recordSchema = z.object({
    url: z.string().trim().min(1).max(8192),
    title: z.string().trim().min(1).max(2000),
    visited_at: timestampSchema,
    visit_count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    description: z.string().max(10000).optional(),
    page_content: z.string().max(100000).optional(),
});

export type HistoryRecord = z.infer<typeof recordSchema> & { id: string; domain: string; source: "json" | "csv" | "synthetic" };
export type RowIssue = { row: number; field: string; code: string; message: string };
export type ParsedHistory = { records: HistoryRecord[]; issues: RowIssue[]; rowCount: number; warnings: string[] };

export interface PageDocument {
    schema_version: number;
    id: string;
    url: string;
    domain: string;
    dataset: Dataset;
    source: string;
    content_type: string;
    title: string;
    description: string;
    content: string;
    url_search: string;
    visited_at: string[];
    first_visited_at: string;
    last_visited_at: string;
    visit_count: number;
    imported_visit_count_max: number;
    semantic_text: string;
    content_hash: string;
    content_provenance: string;
    content_truncated: boolean;
    fetch_status: FetchStatus;
    fetch_reason?: string;
    fetched_at?: string;
    canonical_url?: string;
    created_at: string;
    updated_at: string;
}