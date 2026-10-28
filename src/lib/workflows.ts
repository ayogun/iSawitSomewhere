import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import type { HistoryRepository } from "./elastic/repository";
import { groupRecords } from "./history/providers";
import type { Dataset, HistoryRecord, ParsedHistory } from "./history/schema";
import { fetchEligibility } from "./history/url";

type Preview = { id: string; dataset: Dataset; expiresAt: number; parsed: ParsedHistory; groups: HistoryRecord[][]; nextCursor: number; reports: Map<number, unknown> };
export type EnrichmentTicket = { id: string; dataset: Dataset; expiresAt: number; generation: number; pages: { id: string; url: string; domain: string }[]; approved: string[] | null; nextCursor: number; reports: Map<number, unknown> };

export class WorkflowState {
    preview: Preview | null = null;
    enrichment: EnrichmentTicket | null = null;
    generation = 0;
    deleting = false;
    private active: Promise<unknown> | null = null;
    private controller: AbortController | null = null;
    private previewTimer: ReturnType<typeof setTimeout> | null = null;
    private enrichmentTimer: ReturnType<typeof setTimeout> | null = null;

    private renewPreview(preview: Preview, now = Date.now()) {
        if (this.preview !== preview) return;
        if (this.previewTimer) clearTimeout(this.previewTimer);
        preview.expiresAt = now + 600000;
        const id = preview.id;
        this.previewTimer = setTimeout(() => { if (this.preview?.id === id) this.preview = null; }, Math.max(0, preview.expiresAt - Date.now()));
        this.previewTimer.unref();
    }

    async mutate<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
        if (this.deleting || this.active) throw new AppError("busy", "Another data operation is running. Try again when it finishes.", 409);
        const controller = new AbortController();
        const active = Promise.resolve().then(() => task(controller.signal));
        this.controller = controller; this.active = active;
        try { return await active; } finally { if (this.active === active) { this.active = null; this.controller = null; } }
    }

    createPreview(parsed: ParsedHistory, dataset: Dataset, now = Date.now(), generation = this.generation) {
        if (generation !== this.generation) throw new AppError("preview_cancelled", "Data was deleted while this upload was being read. Choose the file again.", 409);
        if (this.deleting || this.active) throw new AppError("busy", "Wait for the active data operation before choosing another file.", 409);
        if (!parsed.records.length) throw new AppError("no_valid_records", "No valid records were found. Fix the reported schema errors and try again.", 422, parsed.issues);
        const groups = groupRecords(parsed.records);
        this.preview = { id: randomUUID(), dataset, parsed, groups, expiresAt: now + 600000, nextCursor: 0, reports: new Map() };
        this.renewPreview(this.preview, now);
        return this.previewSummary(this.preview);
    }

    previewSummary(preview: Preview) {
        const urls = preview.groups.map((group) => group[0]);
        return {
            previewId: preview.id, dataset: preview.dataset, expiresAt: new Date(preview.expiresAt).toISOString(), rowCount: preview.parsed.rowCount,
            validCount: preview.parsed.records.length, invalidCount: new Set(preview.parsed.issues.map((issue) => issue.row)).size,
            duplicateCount: preview.parsed.records.length - urls.length, uniqueUrls: urls.length,
            domains: this.domains(urls), issues: preview.parsed.issues, warnings: preview.parsed.warnings,
            samples: urls.slice(0, 3).map(({ title, url }) => ({ title, url })),
        };
    }

    domains(pages: { url: string; domain: string }[]) {
        const domains = new Map<string, { domain: string; count: number; eligible: number }>();
        for (const page of pages) {
            const current = domains.get(page.domain) ?? { domain: page.domain, count: 0, eligible: 0 };
            current.count++; if (!fetchEligibility(page.url)) current.eligible++;
            domains.set(page.domain, current);
        }
        return [...domains.values()].sort((left, right) => left.domain.localeCompare(right.domain));
    }

    getPreview(id: string) {
        if (!this.preview || this.preview.id !== id) throw new AppError("preview_expired", "This preview expired. Select the file again.", 409);
        if (this.preview.expiresAt < Date.now()) { this.discardPreview(id); throw new AppError("preview_expired", "This preview expired. Select the file again.", 409); }
        return this.preview;
    }

    discardPreview(id: string) {
        if (this.preview?.id === id) { this.preview = null; if (this.previewTimer) clearTimeout(this.previewTimer); }
    }

    async commit(repository: HistoryRepository, id: string, cursor: number, validOnly: boolean) {
        return this.mutate(async () => {
            const preview = this.getPreview(id);
            if (preview.parsed.issues.length && !validOnly) throw new AppError("valid_only_required", "Acknowledge that invalid rows will not be imported.", 422);
            if (preview.reports.has(cursor)) { this.renewPreview(preview); return preview.reports.get(cursor); }
            if (cursor !== preview.nextCursor || cursor >= preview.groups.length) throw new AppError("invalid_cursor", "Continue from the next import batch.", 409);
            const batch = preview.groups.slice(cursor, cursor + 25);
            this.renewPreview(preview);
            const report = await repository.importGroups(preview.dataset, batch);
            this.renewPreview(preview);
            const nextCursor = report.failed ? cursor : cursor + batch.length;
            const response = { ...report, nextCursor, complete: nextCursor >= preview.groups.length };
            if (!report.failed) { preview.nextCursor = nextCursor; preview.reports.set(cursor, response); }
            return response;
        });
    }

    async enrichmentPreview(repository: HistoryRepository, dataset: Dataset, ids: string[]) {
        return this.mutate(async () => {
            const pages = await repository.getMany(dataset, [...new Set(ids)]);
            if (pages.length !== new Set(ids).size) throw new AppError("page_missing", "Some selected pages are no longer available.", 409);
            for (const page of pages) if (page.fetch_status === "pending") await repository.patch(dataset, page.id, { fetch_status: "failed", fetch_reason: "interrupted" });
            if (this.enrichmentTimer) clearTimeout(this.enrichmentTimer);
            this.enrichment = { id: randomUUID(), dataset, pages: pages.map(({ id, url, domain }) => ({ id, url, domain })), expiresAt: Date.now() + 600000, generation: this.generation, approved: null, nextCursor: 0, reports: new Map() };
            const id = this.enrichment.id;
            this.enrichmentTimer = setTimeout(() => { if (this.enrichment?.id === id) this.enrichment = null; }, 600000);
            this.enrichmentTimer.unref();
            return { ticket: this.enrichment.id, uniqueUrls: pages.length, domains: this.domains(pages), expiresAt: new Date(this.enrichment.expiresAt).toISOString() };
        });
    }

    getEnrichment(id: string, approved: string[]) {
        const ticket = this.enrichment;
        if (!ticket || ticket.id !== id || ticket.expiresAt < Date.now() || ticket.generation !== this.generation) throw new AppError("consent_expired", "Fetch approval expired. Create a new preview.", 409);
        const domains = new Set(ticket.pages.map((page) => page.domain));
        const unique = [...new Set(approved)].sort();
        if (unique.some((domain) => !domains.has(domain))) throw new AppError("unapproved_domain", "Approval must refer to a hostname in this preview.", 422);
        if (ticket.approved && JSON.stringify(ticket.approved) !== JSON.stringify(unique)) throw new AppError("consent_changed", "Domain approvals cannot change during an active run.", 409);
        ticket.approved = unique;
        return ticket;
    }

    async deleteAll(repository: HistoryRepository, clearCache: () => void = () => { }) {
        if (this.deleting) throw new AppError("busy", "Deletion is already running.", 409);
        this.deleting = true;
        this.preview = null; this.enrichment = null; this.generation++;
        if (this.previewTimer) clearTimeout(this.previewTimer);
        if (this.enrichmentTimer) clearTimeout(this.enrichmentTimer);
        this.controller?.abort();
        try {
            await this.active?.catch(() => undefined);
            await repository.deleteAll();
            clearCache();
            return { deleted: true };
        } finally { this.deleting = false; }
    }
}

const globalState = globalThis as typeof globalThis & { isisWorkflows?: WorkflowState };
if (globalState.isisWorkflows) Object.setPrototypeOf(globalState.isisWorkflows, WorkflowState.prototype);
export const workflows = globalState.isisWorkflows ??= new WorkflowState();