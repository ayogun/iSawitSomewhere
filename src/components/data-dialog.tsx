"use client";

import { useState } from "react";
import { LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { Dialog } from "./dialog";
import { api } from "./api";

export function DataDialog({ configured, onClose, onDeleted }: { configured: boolean; onClose: () => void; onDeleted: () => void }) {
    const [confirmation, setConfirmation] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [deleted, setDeleted] = useState(false);
    async function remove() {
        setBusy(true); setError("");
        try { await api("history", { method: "DELETE", body: JSON.stringify({ confirmation }) }); setDeleted(true); onDeleted(); }
        catch (reason) { setError((reason as Error).message); }
        finally { setBusy(false); }
    }
    return <Dialog title="Privacy & data" onClose={onClose}>
        <div className="privacy-heading"><ShieldCheck size={24} /><strong>Your history stays under your control.</strong></div>
        <p>Uploads are previewed in this app&apos;s memory. Only an explicit import stores URLs, titles, visits and supplied content in your Elastic Cloud deployment. Elastic-hosted ELSER processes searchable text and query concepts. No external LLM is used.</p>
        <p>Enrichment is separate and contacts only approved public domains, without your browser cookies. Cloud snapshots and provider retention may outlive deletion from the active indices. Verify inference region and retention in your Elastic account.</p>
        <details className="format-help" open={!configured}><summary>Local setup</summary><p>Use Node 24 LTS. Create .env.local from .env.example, configure your Cloud URL/API key and restart the app. Keep credentials out of Git and browser code.</p><pre>{"ELASTICSEARCH_URL=https://your-deployment...\nELASTICSEARCH_API_KEY=your-private-api-key\nELASTICSEARCH_INFERENCE_ID=.elser-2-elastic"}</pre><p>Run npm run preflight -- --consent to verify the paid retrieval capabilities using synthetic text. Configuration alone is not a successful capability check.</p></details>
        <section className="delete-section"><h3>Delete all history</h3><p>Removes both synthetic and personal app indices, enriched content, previews and approvals. This cannot be undone in the app.</p>{deleted ? <div className="notice success" role="status">All app history was deleted and absence was verified.</div> : <><label htmlFor="delete-confirmation">Type DELETE ALL HISTORY</label><input id="delete-confirmation" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />{error && <div className="notice error" role="alert">{error}</div>}<button type="button" className="danger-button" onClick={remove} disabled={!configured || confirmation !== "DELETE ALL HISTORY" || busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}Delete all history</button></>}</section>
    </Dialog>;
}