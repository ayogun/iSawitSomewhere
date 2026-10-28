import { AppError } from "../errors";
import type { HistoryRepository } from "../elastic/repository";
import { fetchEligibility } from "../history/url";
import { WorkflowState } from "../workflows";
import { PublicPageEnricher, type EnrichmentOutcome, type PageEnricher } from "./enricher";

export const publicEnricher = new PublicPageEnricher();

export async function runEnrichment(state: WorkflowState, repository: HistoryRepository, ticketId: string, approvedDomains: string[], cursor: number, enricher: PageEnricher = publicEnricher) {
    return state.mutate(async (signal) => {
        const ticket = state.getEnrichment(ticketId, approvedDomains);
        if (ticket.reports.has(cursor)) return ticket.reports.get(cursor);
        if (cursor !== ticket.nextCursor || cursor >= ticket.pages.length) throw new AppError("invalid_cursor", "Continue from the next fetch batch.", 409);
        const batch = ticket.pages.slice(cursor, cursor + 5);
        const approved = new Set(ticket.approved!);
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
        const results: { id: string; status: string; reason: string }[] = [];
        for (const page of batch) {
            deadline.throwIfAborted();
            const ineligible = fetchEligibility(page.url);
            let outcome: EnrichmentOutcome;
            if (!approved.has(page.domain) || ineligible) outcome = { status: "skipped", reason: ineligible ?? "unapproved_domain" };
            else {
                await repository.patch(ticket.dataset, page.id, { fetch_status: "pending", fetch_reason: "approved_batch" });
                outcome = await enricher.enrich(page.url, approved, deadline);
            }
            deadline.throwIfAborted();
            await repository.patch(ticket.dataset, page.id, {
                fetch_status: outcome.status, fetch_reason: outcome.reason,
                ...(outcome.status === "fetched" ? {
                    ...(outcome.title ? { title: outcome.title } : {}), ...(outcome.description ? { description: outcome.description } : {}),
                    ...(outcome.content ? { content: outcome.content } : {}), ...(outcome.canonicalUrl ? { canonical_url: outcome.canonicalUrl } : {}),
                    content_provenance: "fetched", content_truncated: outcome.truncated ?? false, fetched_at: new Date().toISOString(),
                } : {}),
            });
            results.push({ id: page.id, status: outcome.status, reason: outcome.reason });
        }
        ticket.nextCursor += batch.length;
        const report = { results, nextCursor: ticket.nextCursor, complete: ticket.nextCursor >= ticket.pages.length };
        ticket.reports.set(cursor, report);
        return report;
    });
}