"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowRight, Check, FileUp, Globe, LoaderCircle } from "lucide-react";
import { type Dataset, maxHistoryFileBytes, maxHistoryFileMiB, maxHistoryRecords } from "@/lib/history/schema";
import type { WorkflowState } from "@/lib/workflows";
import type { BatchReport } from "@/lib/elastic/repository";
import { api, post } from "./api";
import { Dialog } from "./dialog";

type Preview = ReturnType<WorkflowState["previewSummary"]>;
type FetchPreview = { ticket: string; uniqueUrls: number; domains: Preview["domains"]; expiresAt: string };
type Commit = BatchReport & { nextCursor: number; complete: boolean };
type FetchReport = { results: { id: string; status: string; reason: string }[]; nextCursor: number; complete: boolean };

export function ImportDialog({ sample, configured, onClose, onComplete }: { sample: boolean; configured: boolean; onClose: () => void; onComplete: (dataset: Dataset) => void }) {
    const [preview, setPreview] = useState<Preview | null>(null);
    const [busy, setBusy] = useState(sample);
    const [error, setError] = useState("");
    const [consent, setConsent] = useState(false);
    const [validOnly, setValidOnly] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [done, setDone] = useState(false);
    const [fetchPreview, setFetchPreview] = useState<FetchPreview | null>(null);
    const [approved, setApproved] = useState<string[]>([]);
    const [fetchResults, setFetchResults] = useState<FetchReport["results"]>([]);
    const [fetchCursor, setFetchCursor] = useState(0);
    const [fetchDone, setFetchDone] = useState(false);
    const [groupStart, setGroupStart] = useState(0);
    const ids = useRef<string[]>([]);
    const cancelled = useRef(false);
    const previewId = useRef<string | null>(null);

    useEffect(() => {
        cancelled.current = false;
        let active = true;
        if (sample) post<Preview>("imports/preview", { sample: true }).then((result) => { if (active) { setPreview(result); previewId.current = result.previewId; } }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; cancelled.current = true; };
    }, [sample]);

    function close() {
        cancelled.current = true;
        if (previewId.current) void api(`imports/${previewId.current}`, { method: "DELETE" }).catch(() => { });
        onClose();
    }

    async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        setError(""); setConsent(false); setValidOnly(false); setPreview(null);
        if (file.size > maxHistoryFileBytes) { setError(`History files are limited to ${maxHistoryFileMiB} MiB.`); return; }
        setBusy(true);
        const form = new FormData(); form.set("file", file); form.set("dataset", "personal");
        try {
            const result = await api<Preview>("imports/preview", { method: "POST", body: form });
            if (!cancelled.current) { setPreview(result); previewId.current = result.previewId; }
        } catch (reason) { if (!cancelled.current) setError((reason as Error).message); }
        finally { if (!cancelled.current) setBusy(false); }
    }

    async function commit() {
        if (!preview) return;
        setBusy(true); setError("");
        let next = cursor;
        try {
            while (!cancelled.current) {
                const result = await post<Commit>(`imports/${preview.previewId}/commit`, { cloudConsent: consent, validOnly, cursor: next });
                ids.current = [...new Set([...ids.current, ...result.pageIds])];
                if (cancelled.current) break;
                setCursor(result.nextCursor); next = result.nextCursor;
                if (result.failed) throw new Error(`${result.failed} page(s) could not be indexed. Completed pages are retained; retry this batch after checking Cloud setup.`);
                if (result.complete) { setDone(true); onComplete(preview.dataset); break; }
            }
        } catch (reason) { if (!cancelled.current) setError((reason as Error).message); }
        finally { if (!cancelled.current) setBusy(false); }
    }

    async function prepareFetch(start = groupStart) {
        if (!preview) return;
        setBusy(true); setError("");
        try {
            const result = await post<FetchPreview>("enrichment/preview", { dataset: preview.dataset, pageIds: ids.current.slice(start, start + 100) });
            if (!cancelled.current) { setFetchPreview(result); setApproved([]); setFetchCursor(0); setFetchResults([]); setFetchDone(false); setGroupStart(start); }
        } catch (reason) { if (!cancelled.current) setError((reason as Error).message); }
        finally { if (!cancelled.current) setBusy(false); }
    }

    async function fetchPages() {
        if (!fetchPreview) return;
        setBusy(true); setError("");
        let next = fetchCursor;
        try {
            while (!cancelled.current) {
                const result = await post<FetchReport>(`enrichment/${fetchPreview.ticket}/run`, { approvedDomains: approved, cursor: next });
                if (cancelled.current) break;
                setFetchResults((previous) => [...previous.filter((item) => !result.results.some((updated) => updated.id === item.id)), ...result.results]);
                setFetchCursor(result.nextCursor); next = result.nextCursor;
                if (result.complete) { setFetchDone(true); if (preview) onComplete(preview.dataset); break; }
            }
        } catch (reason) { if (!cancelled.current) setError((reason as Error).message); }
        finally { if (!cancelled.current) setBusy(false); }
    }

    return <Dialog title={fetchPreview ? "Enrich public pages" : done ? "History imported" : sample ? "Load synthetic history" : "Import your history"} onClose={close}>
        {error && <div className="notice error" role="alert">{error}</div>}
        {!sample && !preview && <label className="file-picker"><FileUp size={28} /><strong>Choose a history file</strong><span>JSON or CSV, up to {maxHistoryFileMiB} MiB / {maxHistoryRecords.toLocaleString("en-US")} records</span><input type="file" accept=".json,.csv,application/json,text/csv" onChange={chooseFile} disabled={busy} aria-label="History JSON or CSV file" /></label>}
        {!preview && !busy && <details className="format-help"><summary>Import format</summary><p>Canonical JSON/CSV: url, title, visited_at. Optional: visit_count, domain, description, page_content.</p><p>Safari and Google Takeout JSON exports are accepted. Browser time_usec and lastVisitTime timestamps are normalized automatically. Rows without titles appear in validation errors.</p><pre>{'[{"url":"https://example.com/page",\n  "title":"A page I saw",\n  "visited_at":"2026-10-25T10:00:00Z"}]'}</pre></details>}
        {busy && !preview && <p className="busy-line" role="status"><LoaderCircle className="spin" size={18} /> Preparing a local preview...</p>}
        {preview && !done && <>
            <div className="preview-counts"><div><strong>{preview.uniqueUrls}</strong><span>unique URLs</span></div><div><strong>{preview.validCount}</strong><span>valid visits</span></div><div><strong>{preview.invalidCount}</strong><span>rejected rows</span></div></div>
            {preview.dataset === "demo" && <div className="badge demo-badge">Synthetic text and visits</div>}
            <div className="domain-list" aria-label="Domains in this import">{preview.domains.map((domain) => <div key={domain.domain}><span>{domain.domain}</span><span>{domain.count} URL{domain.count === 1 ? "" : "s"}</span></div>)}</div>
            <details className="format-help"><summary>Preview and validation</summary>{preview.samples.map((item) => <p key={item.url}><strong>{item.title}</strong><br /><span className="break-url">{item.url}</span></p>)}{preview.issues.slice(0, 12).map((issue, index) => <p className="validation-error" key={index}>Row {issue.row}, {issue.field}: {issue.message}</p>)}{preview.issues.length > 12 && <p>{preview.issues.length - 12} more field errors.</p>}{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>
            {preview.invalidCount > 0 && <label className="check-row"><input type="checkbox" checked={validOnly} onChange={(event) => setValidOnly(event.target.checked)} disabled={busy} /><span>Import only the {preview.validCount} valid records; skip rejected rows.</span></label>}
            <div className="consent-box"><strong>Before anything leaves this computer</strong><p>Indexing stores this history in your Elastic Cloud deployment. Page text and search concepts are processed by Elastic-hosted ELSER inference, which may be billable and may use a different region. No visited website will be contacted during import.</p><label className="check-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={busy} /><span>I approve Cloud storage and Elastic inference processing.</span></label></div>
            {!configured && <p className="notice">Cloud setup is required to index. Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY in .env.local and restart.</p>}
            <div className="dialog-actions"><span className="muted" role="status">{cursor ? `${cursor} / ${preview.uniqueUrls} pages completed` : "No websites contacted"}</span><button className="primary-button" type="button" onClick={commit} disabled={!consent || !configured || busy || (preview.invalidCount > 0 && !validOnly)}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{busy ? "Indexing..." : cursor ? "Resume import" : "Index history"}</button></div>
        </>}
        {done && !fetchPreview && <div className="import-done"><div className="success-icon"><Check size={26} /></div><h3>{preview?.uniqueUrls} pages, ready to rediscover.</h3><p>The import is complete. No visited websites were contacted.</p><div className="dialog-actions"><button type="button" className="text-button" onClick={() => prepareFetch()}>Review public-page enrichment <Globe size={16} /></button><button type="button" className="primary-button" onClick={close}>Search history <ArrowRight size={16} /></button></div></div>}
        {fetchPreview && <>
            <p className="muted">{fetchPreview.uniqueUrls} unique URLs. Approve each domain before any website request.</p>
            <div className="domain-list approval-list">{fetchPreview.domains.map((domain) => <label className="check-row" key={domain.domain}><input type="checkbox" checked={approved.includes(domain.domain)} disabled={busy || fetchCursor > 0 || domain.eligible === 0} onChange={(event) => setApproved((previous) => event.target.checked ? [...previous, domain.domain] : previous.filter((item) => item !== domain.domain))} /><span>{domain.domain}<small>{domain.count} URLs / {domain.eligible} eligible</small></span></label>)}</div>
            <p className="privacy-note">Only public HTML, without browser cookies. Robots restrictions, protected URLs, private networks, and unapproved redirects are never bypassed. The site receives your network IP. A failed fetch keeps the original history.</p>
            <div className="fetch-outcomes" role="status">{["fetched", "skipped", "failed"].map((status) => <span key={status}>{fetchResults.filter((result) => result.status === status).length} {status}</span>)}</div>
            <div className="dialog-actions"><span className="muted">{fetchCursor} / {fetchPreview.uniqueUrls}</span>{!fetchDone ? <button type="button" className="primary-button" disabled={busy} onClick={fetchPages}>{busy ? <LoaderCircle className="spin" size={17} /> : <Globe size={17} />}{busy ? "Processing..." : approved.length ? "Fetch approved pages" : "Skip these pages"}</button> : groupStart + 100 < (preview?.uniqueUrls ?? 0) ? <button type="button" className="primary-button" disabled={busy} onClick={() => prepareFetch(groupStart + 100)}>Review next URLs <ArrowRight size={17} /></button> : <button type="button" className="primary-button" onClick={close}>Done <Check size={17} /></button>}</div>
        </>}
    </Dialog>;
}