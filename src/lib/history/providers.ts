import { parse } from "csv-parse/sync";
import { AppError } from "../errors";
import { type HistoryRecord, type ParsedHistory, maxHistoryFileBytes, maxHistoryFileMiB, maxHistoryRecords, recordSchema } from "./schema";
import { normalizeUrl, pageId } from "./url";

export interface HistoryProvider { parse(text: string): ParsedHistory }
const fields = new Set(["url", "title", "visited_at", "visit_count", "domain", "description", "page_content"]);
const historyWrappers = ["Browser History", "history", "records", "items", "visits", "data"] as const;

function exportTimestamp(value: unknown, microseconds: boolean): string | undefined {
    let milliseconds: number;
    if (microseconds) {
        if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) milliseconds = Math.floor(value / 1000);
        else if (typeof value === "string" && /^\d{1,18}$/.test(value)) milliseconds = Number(BigInt(value) / BigInt(1000));
        else return undefined;
    } else {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.trunc(value))) milliseconds = value;
        else if (typeof value === "string" && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value))) milliseconds = Number(value);
        else return undefined;
    }
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function normalizeExportRow(raw: unknown): { value: unknown; converted: boolean } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, converted: false };
    const value = { ...raw } as Record<string, unknown>;
    let converted = false;
    if (!Object.hasOwn(value, "visited_at")) {
        const dates: (string | undefined)[] = [];
        if (Object.hasOwn(value, "time_usec")) dates.push(exportTimestamp(value.time_usec, true));
        if (Object.hasOwn(value, "lastVisitTime")) dates.push(exportTimestamp(value.lastVisitTime, false));
        if (dates.length) {
            value.visited_at = dates.every((date) => date !== undefined && date === dates[0]) ? dates[0] : undefined;
            converted = true;
        }
    }
    if (!Object.hasOwn(value, "visit_count") && Object.hasOwn(value, "visitCount")) { value.visit_count = value.visitCount; converted = true; }
    if (converted) { delete value.time_usec; delete value.lastVisitTime; delete value.visitCount; }
    return { value, converted };
}

function exportRows(value: unknown): { rows: unknown[]; warning?: string } {
    if (Array.isArray(value)) return { rows: value };
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        const candidates: { rows: unknown[]; path: string }[] = [];
        for (const key of historyWrappers) {
            const entry = object[key];
            if (Array.isArray(entry)) candidates.push({ rows: entry, path: key });
            else if (key === "data" && entry && typeof entry === "object") {
                for (const nested of historyWrappers) {
                    const rows = (entry as Record<string, unknown>)[nested];
                    if (Array.isArray(rows)) candidates.push({ rows, path: `data.${nested}` });
                }
            }
        }
        if (candidates.length === 1) return { rows: candidates[0].rows, warning: `Read records from the ${candidates[0].path} export wrapper.` };
        if (candidates.length > 1) throw new AppError("ambiguous_json", "This JSON contains multiple supported history arrays. Keep one history array or wrapper before importing.", 422);
    }
    throw new AppError("invalid_json", 'Expected a history array or an export wrapped in "Browser History", "history", "records", "items", "visits", or "data". Share only the export tool name or outer key names when asking for help.', 422);
}

function normalizeRows(rows: unknown[], source: "json" | "csv"): ParsedHistory {
    if (!rows.length || rows.length > maxHistoryRecords) throw new AppError("row_limit", `Provide between 1 and ${maxHistoryRecords.toLocaleString("en-US")} history records.`, 422);
    const result: ParsedHistory = { records: [], issues: [], warnings: [], rowCount: rows.length };
    const unknownFields = new Set<string>();
    let convertedRows = 0;
    rows.forEach((raw, index) => {
        const row = index + 1;
        const normalized = source === "json" ? normalizeExportRow(raw) : { value: raw, converted: false };
        if (normalized.converted) convertedRows++;
        if (normalized.value && typeof normalized.value === "object" && !Array.isArray(normalized.value)) {
            Object.keys(normalized.value).filter((key) => !fields.has(key)).forEach((key) => unknownFields.add(key));
        }
        const parsed = recordSchema.safeParse(normalized.value);
        if (!parsed.success) {
            for (const issue of parsed.error.issues) {
                const field = String(issue.path[0] ?? "record");
                const message = field === "title" ? "A nonblank page title is required; untitled browser entries can be skipped." : field === "visited_at" ? "Use a valid RFC3339 visited_at, Unix-microsecond time_usec, or Unix-millisecond lastVisitTime. Multiple browser timestamps must agree." : "Field is missing, malformed, or exceeds its documented limit.";
                result.issues.push({ row, field, code: issue.code, message });
            }
            return;
        }
        try {
            const url = normalizeUrl(parsed.data.url);
            if (parsed.data.domain && parsed.data.domain.toLowerCase() !== url.hostname) throw new AppError("domain_mismatch", "Domain must agree with the URL hostname.", 422);
            result.records.push({ ...parsed.data, id: pageId(url.href), url: url.href, domain: url.hostname, visited_at: new Date(parsed.data.visited_at).toISOString(), source });
        } catch (error) {
            const safe = error instanceof AppError ? error : new AppError("invalid_url", "Invalid URL.", 422);
            result.issues.push({ row, field: safe.code === "domain_mismatch" ? "domain" : "url", code: safe.code, message: safe.message });
        }
    });
    if (unknownFields.size) result.warnings.push(`${unknownFields.size} unrecognized field(s) were ignored.`);
    if (convertedRows) result.warnings.push(`Normalized browser-export fields in ${convertedRows} record(s); timestamp units were taken from field names, not guessed.`);
    return result;
}

function checkSize(text: string) {
    if (Buffer.byteLength(text, "utf8") > maxHistoryFileBytes) throw new AppError("file_limit", `History files are limited to ${maxHistoryFileMiB} MiB.`, 413);
}

export const jsonProvider: HistoryProvider = {
    parse(text) {
        checkSize(text);
        let value: unknown;
        try { value = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new AppError("invalid_json", "File is not valid JSON.", 422); }
        const extracted = exportRows(value);
        const parsed = normalizeRows(extracted.rows, "json");
        if (extracted.warning) parsed.warnings.unshift(extracted.warning);
        return parsed;
    },
};

export const csvProvider: HistoryProvider = {
    parse(text) {
        checkSize(text);
        let rows: Record<string, unknown>[];
        try {
            rows = parse(text, {
                bom: true, skip_empty_lines: true, trim: true,
                columns(headers: string[]) {
                    if (new Set(headers).size !== headers.length) throw new Error("duplicate headers");
                    if (!["url", "title", "visited_at"].every((field) => headers.includes(field))) throw new Error("missing headers");
                    return headers;
                },
            }) as Record<string, unknown>[];
        } catch { throw new AppError("invalid_csv", "CSV must have unique url, title, visited_at headers and well-formed rows.", 422); }
        const normalized = rows.map((raw) => {
            const record = { ...raw };
            for (const field of ["visit_count", "domain", "description", "page_content"]) if (record[field] === "") delete record[field];
            if (typeof record.visit_count === "string" && /^\d+$/.test(record.visit_count)) record.visit_count = Number(record.visit_count);
            return record;
        });
        return normalizeRows(normalized, "csv");
    },
};

export function groupRecords(records: HistoryRecord[]): HistoryRecord[][] {
    const groups = new Map<string, HistoryRecord[]>();
    for (const record of records) {
        const group = groups.get(record.id);
        if (group) group.push(record);
        else groups.set(record.id, [record]);
    }
    return [...groups.values()];
}