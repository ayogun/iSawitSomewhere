"use client";

import { startTransition, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, Braces, Check, ChevronDown, Clock3, Database, ExternalLink, History, LoaderCircle, Plus, Search, ShieldCheck, SlidersHorizontal, TriangleAlert } from "lucide-react";
import type { Dataset } from "@/lib/history/schema";
import type { SearchResponse } from "@/lib/search/service";
import type { RetrievalMode } from "@/lib/search/query";
import showcaseFixture from "../../fixtures/semantic-showcase.json";
import { api, post } from "./api";
import { ImportDialog } from "./import-dialog";
import { DataDialog } from "./data-dialog";

type Health = { configured: boolean; profile: string; inferenceId: string };
type Stats = { datasets: { dataset: Dataset; pages: number; knownVisits: number; fetch: { key: string; doc_count: number }[] }[] };
const examples = showcaseFixture.map(({ query }, index) => ({
    category: `Synthetic example ${index + 1}`, query, caption: query.charAt(0).toUpperCase() + query.slice(1),
}));
const date = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const modeLabels: Record<RetrievalMode, string> = { lexical: "Keyword", semantic: "Semantic", hybrid: "Hybrid" };
const modeDescriptions: Record<RetrievalMode, string> = { lexical: "Keyword matching with BM25", semantic: "Concept matching with ELSER", hybrid: "Keyword and semantic retrieval combined with RRF" };

export function SearchApp() {
    const [health, setHealth] = useState<Health | null>(null);
    const [stats, setStats] = useState<Stats | null>(null);
    const [dataset, setDataset] = useState<Dataset>("demo");
    const [mode, setMode] = useState<RetrievalMode>("hybrid");
    const [query, setQuery] = useState("");
    const [domain, setDomain] = useState("");
    const [start, setStart] = useState("");
    const [end, setEnd] = useState("");
    const [debug, setDebug] = useState(false);
    const [searching, setSearching] = useState(false);
    const [response, setResponse] = useState<SearchResponse | null>(null);
    const [error, setError] = useState("");
    const [dialog, setDialog] = useState<"import" | "sample" | "data" | null>(null);
    const controller = useRef<AbortController | null>(null);
    const requestId = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const activeStats = stats?.datasets.find((item) => item.dataset === dataset);

    useEffect(() => {
        const abort = new AbortController();
        api<Health>("health", { signal: abort.signal }).then(async (result) => {
            setHealth(result);
            if (result.configured) setStats(await api<Stats>("history/stats", { signal: abort.signal }));
        }).catch((reason: Error) => { if (!abort.signal.aborted) setError(reason.message); });
        return () => { abort.abort(); controller.current?.abort(); };
    }, []);

    function resetSearch() {
        controller.current?.abort(); requestId.current++; setResponse(null); setError(""); setSearching(false);
    }

    function changeDataset(next: Dataset) { resetSearch(); setDataset(next); setQuery(""); setDomain(""); setStart(""); setEnd(""); }

    async function refresh(next?: Dataset) {
        if (next) { changeDataset(next); }
        try { setStats(await api<Stats>("history/stats")); } catch (reason) { setError((reason as Error).message); }
    }

    async function search(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        controller.current?.abort();
        const abort = new AbortController(); controller.current = abort;
        const identity = ++requestId.current;
        setSearching(true); setResponse(null); setError("");
        try {
            const result = await post<SearchResponse>("search", { query, dataset, mode, debug, filters: { ...(domain.trim() ? { domain: domain.trim() } : {}), ...(start ? { start: `${start}T00:00:00Z` } : {}), ...(end ? { end: `${end}T00:00:00Z` } : {}) } }, { signal: abort.signal });
            if (identity === requestId.current) startTransition(() => setResponse(result));
        } catch (reason) { if (!abort.signal.aborted && identity === requestId.current) setError((reason as Error).message); }
        finally { if (identity === requestId.current) setSearching(false); }
    }

    function tryExample(text: string) { resetSearch(); setQuery(text); inputRef.current?.focus(); }
    const trace = response && "trace" in response ? response.trace : null;

    return <>
        <main id="main" className="main-shell">
            <div className="workspace-bar"><div className="dataset-switch" role="group" aria-label="History dataset"><button type="button" aria-pressed={dataset === "demo"} onClick={() => changeDataset("demo")}>Demo history</button><button type="button" aria-pressed={dataset === "personal"} onClick={() => changeDataset("personal")}>My history</button></div><button type="button" className="text-button import-trigger" onClick={() => setDialog("import")}><Plus size={17} />Import history</button></div>
            <section className="search-section" aria-labelledby="product-name"><div className="eyebrow"><span className="tiny-square" />{dataset === "demo" ? "SYNTHETIC DEMO" : "YOUR PERSONAL HISTORY"}{activeStats && <span className="eyebrow-count">{activeStats.pages} pages</span>}</div><h1 id="product-name">I Saw It <em>Somewhere</em></h1><p className="subtitle">Search the Internet you&apos;ve already seen.</p>
                <form className="memory-form" onSubmit={search}><label htmlFor="memory-query">What do you remember?</label><div className="search-box"><Search size={23} aria-hidden="true" /><input ref={inputRef} id="memory-query" type="search" autoComplete="off" minLength={3} maxLength={1000} required value={query} onChange={(event) => { resetSearch(); setQuery(event.target.value); }} placeholder="That GitHub project where an AI agent controlled a browser. I think I saw it a few months ago..." /><button className="primary-button find-button" type="submit" disabled={searching}>{searching ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}<span>{searching ? "Finding..." : "Find it"}</span></button></div>
                    <div className="search-options"><div className="dataset-switch search-mode-switch" role="group" aria-label="Search mode">{(Object.keys(modeLabels) as RetrievalMode[]).map((value) => <button key={value} type="button" aria-pressed={mode === value} title={modeDescriptions[value]} onClick={() => { resetSearch(); setMode(value); }}>{modeLabels[value]}</button>)}</div><details className="filters"><summary><SlidersHorizontal size={14} />Filters<ChevronDown size={12} /></summary><div className="filter-fields"><label>Domain<input type="text" value={domain} placeholder="github.com" onChange={(event) => { resetSearch(); setDomain(event.target.value); }} /></label><label>Visited from<input type="date" value={start} onChange={(event) => { resetSearch(); setStart(event.target.value); }} /></label><label>Before<input type="date" value={end} onChange={(event) => { resetSearch(); setEnd(event.target.value); }} /></label></div></details><label className="debug-toggle"><input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} /><Braces size={14} />Under the hood</label></div>
                </form>
            </section>

            {error && <div className="notice error search-notice" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>}
            {searching && <div className="search-status" role="status"><span className="searching-line" /><p>Looking through your trail...</p></div>}
            {health && !health.configured && <div className="connection-notice"><span className="status-dot" /><span>Elastic Cloud isn&apos;t connected.</span><button type="button" className="text-button" onClick={() => setDialog("data")}>View setup <ArrowUpRight size={14} /></button></div>}

            {!response && !searching && <section className="starting-point" aria-label="History starting point"><div className="section-line"><span>{dataset === "demo" ? "A FEW THINGS YOU MIGHT REMEMBER" : "YOUR BROWSING TRAIL"}</span><span className="line" /></div>{dataset === "demo" ? <div className="example-grid">{examples.map((example) => <button type="button" className="example" key={example.category} onClick={() => tryExample(example.query)}><span>{example.category}</span><strong>{example.caption}</strong><ArrowUpRight size={17} /></button>)}</div> : <div className="personal-empty"><History size={24} /><p>{activeStats?.pages ? `${activeStats.pages} pages in your personal history.` : "Your personal history is empty."}</p><button type="button" className="text-button" onClick={() => setDialog("import")}><FileImportIcon />Choose a history file</button></div>}<div className="sample-line">{dataset === "demo" && <button type="button" className="text-button" onClick={() => setDialog("sample")}><Database size={15} />{activeStats?.pages ? "Reload synthetic history" : "Load sample history"}<ArrowRight size={14} /></button>}<span className="muted">{activeStats ? `${activeStats.knownVisits} known visits` : "No history uploaded automatically"}</span></div></section>}

            {response && <section className="results-section" aria-label="Search results"><div className="results-heading"><h2>{response.results.length ? "Possible matches." : "No matches this time."}</h2><span>{modeLabels[response.mode]} <span className="separator">/</span> {response.results.length} possible match{response.results.length === 1 ? "" : "es"} <span className="separator">/</span> {response.latencyMs} ms</span></div>{response.warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}{response.results.length === 0 && <p className="empty-copy">Nothing in this history matched that memory. Try a different detail or a wider time period.</p>}
                <div className="results-list">{response.results.map((result, index) => <article className="result" key={result.id}><span className="result-number">{String(index + 1).padStart(2, "0")}</span><div className="result-body"><div className="result-domain"><span>{result.domain}</span><span className="match-label">{result.label}</span></div><a className="result-title" href={result.url} target="_blank" rel="noopener noreferrer">{result.title}<ArrowUpRight size={20} /></a><p className="result-url">{result.url.replace(/^https?:\/\//, "")}</p><div className="visit-line"><Clock3 size={13} /><span>Visited {date(result.lastVisitedAt)}</span>{result.matchingVisitAt && result.matchingVisitAt !== result.lastVisitedAt && <span>Also seen {date(result.matchingVisitAt)}</span>}<span>{result.observedVisitCount} known visit{result.observedVisitCount === 1 ? "" : "s"}{result.reportedVisitCount > result.observedVisitCount ? ` / ${result.reportedVisitCount} reported` : ""}</span></div><div className="result-evidence"><h3>Why this matches</h3><p className="evidence-source">{result.why}</p><blockquote>{result.snippet}</blockquote></div>{result.matchedClues.length > 0 && <div className="clue-list">{result.matchedClues.map((clue) => <span key={clue}><Check size={13} />{clue}</span>)}</div>}<a className="open-page" href={result.url} target="_blank" rel="noopener noreferrer">Open page <ExternalLink size={12} /></a></div></article>)}</div>
                {trace && <details className="developer-panel" open={debug}><summary><Braces size={18} />Under the hood<span>Elasticsearch retrieval</span></summary><div className="developer-content"><div className="trace-metrics"><div><span>Mode</span><strong>{response.mode}</strong></div><div><span>Elasticsearch</span><strong>{response.elasticTook} ms</strong></div><div><span>Candidate window</span><strong>{trace.requestedCandidateWindow ?? "n/a"}</strong></div><div><span>Returned candidates</span><strong>{trace.returnedCandidates}</strong></div></div><h3>Extracted clues</h3><pre>{JSON.stringify(response.clues, null, 2)}</pre><h3>Executed stages</h3><p>{trace.stages.join(" → ")}</p><h3>Actual score explanations</h3><p className="muted">Raw scores use different scales. Metadata adjusts retriever scores; Hybrid combines ranks, not raw scores. Scores are not probabilities; unavailable details are null.</p><pre>{JSON.stringify(trace.scores, null, 2)}</pre><details><summary>Elasticsearch request</summary><pre>{JSON.stringify(trace.query, null, 2)}</pre></details></div></details>}
            </section>}
        </main>
        <footer className="site-footer"><span><span className="status-dot connected" />Local application{dataset === "demo" ? " / Synthetic data" : " / Personal history"}</span><button type="button" className="text-button" onClick={() => setDialog("data")}><ShieldCheck size={15} />Privacy & data</button></footer>
        {(dialog === "import" || dialog === "sample") && <ImportDialog sample={dialog === "sample"} configured={health?.configured ?? false} onClose={() => setDialog(null)} onComplete={(next) => void refresh(next)} />}
        {dialog === "data" && <DataDialog configured={health?.configured ?? false} onClose={() => setDialog(null)} onDeleted={() => { resetSearch(); setQuery(""); setDataset("demo"); setStats({ datasets: ["demo", "personal"].map((item) => ({ dataset: item as Dataset, pages: 0, knownVisits: 0, fetch: [] })) }); }} />}
    </>;
}

function FileImportIcon() { return <Plus size={15} />; }