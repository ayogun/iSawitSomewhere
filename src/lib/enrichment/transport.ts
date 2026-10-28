import { lookup } from "node:dns/promises";
import { setTimeout as pause } from "node:timers/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Agent, request } from "undici";
import { AppError } from "../errors";
import { fetchEligibility, isPublicAddress, normalizeUrl } from "../history/url";

export type Target = { url: URL; address: string; family: number };
export type PublicResponse = { status: number; headers: Record<string, string>; text: string };
type RequestOptions = { signal: AbortSignal; maxBytes: number; timeoutMs: number; robots?: boolean };
export type TransportDependencies = {
    resolve: (host: string) => Promise<{ address: string; family: number }[]>;
    send: (target: Target, options: RequestOptions) => Promise<PublicResponse>;
    wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    now: () => number;
};

export async function sendPinned(target: Target, options: RequestOptions): Promise<PublicResponse> {
    const dispatcher = new Agent({
        connect: {
            lookup: (hostname, lookupOptions, callback) => {
                if (hostname !== target.url.hostname.replace(/^\[|\]$/g, "")) return callback(new Error("Unexpected hostname"), "", 0);
                if (lookupOptions.all) callback(null, [{ address: target.address, family: target.family }]);
                else callback(null, target.address, target.family);
            }
        }
    });
    let body: Awaited<ReturnType<typeof request>>["body"] | undefined;
    try {
        const response = await request(target.url, {
            dispatcher, signal: options.signal, headersTimeout: options.timeoutMs, bodyTimeout: options.timeoutMs,
            headers: { "user-agent": "ISawItSomewhere/0.1 (explicit personal-history enrichment)", accept: options.robots ? "text/plain" : "text/html, application/xhtml+xml", "accept-encoding": "identity" },
        });
        body = response.body;
        const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""]));
        if (response.statusCode < 200 || response.statusCode >= 300) return { status: response.statusCode, headers, text: "" };
        const mime = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!options.robots && !["text/html", "application/xhtml+xml"].includes(mime)) throw new AppError("policy_content_type", "Only public HTML pages can be enriched.", 422);
        const encoding = headers["content-encoding"]?.toLowerCase();
        if (encoding && !["identity", "gzip", "deflate", "br"].includes(encoding)) throw new AppError("policy_encoding", "Unsupported response encoding.", 422);
        const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
        const stream = decoder ? response.body.pipe(decoder) : response.body;
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
            for await (const chunk of stream) {
                options.signal.throwIfAborted();
                const buffer = Buffer.from(chunk);
                bytes += buffer.length;
                if (bytes > options.maxBytes) throw new AppError("policy_response_limit", "The decompressed response exceeds the size limit.", 422);
                chunks.push(buffer);
            }
        } finally { decoder?.destroy(); }
        return { status: response.statusCode, headers, text: Buffer.concat(chunks).toString("utf8") };
    } finally {
        if (body && !body.destroyed) { body.once("error", () => { }); body.destroy(); }
        await dispatcher.close();
    }
}

export class PublicTransport {
    private queue: Promise<unknown> = Promise.resolve();
    private next = new Map<string, number>();
    private delays = new Map<string, number>();
    private retryAfter = new Map<string, number>();
    private globalRetryUntil = 0;
    constructor(private deps: TransportDependencies = {
        resolve: (host) => lookup(host, { all: true, verbatim: true }), send: sendPinned,
        wait: async (milliseconds, signal) => { await pause(milliseconds, undefined, { signal }); }, now: Date.now,
    }) { }

    setCrawlDelay(origin: string, seconds: number) {
        if (Number.isFinite(seconds) && seconds > 0) this.delays.set(origin, Math.max(1000, seconds * 1000));
    }

    clear() { this.next.clear(); this.delays.clear(); this.retryAfter.clear(); this.globalRetryUntil = 0; }

    async get(value: string, approvedDomains: ReadonlySet<string>, options: RequestOptions): Promise<PublicResponse> {
        const run = this.queue.then(async () => {
            options.signal.throwIfAborted();
            const url = normalizeUrl(value);
            if (!approvedDomains.has(url.hostname)) throw new AppError("policy_unapproved_domain", "The hostname has not been approved.", 422);
            const ineligible = fetchEligibility(url.href);
            if (ineligible) throw new AppError(`policy_${ineligible}`, "This URL is not eligible for public fetching.", 422);
            for (const [origin, until] of this.retryAfter) if (until <= this.deps.now()) this.retryAfter.delete(origin);
            if (Math.max(this.globalRetryUntil, this.retryAfter.get(url.origin) ?? 0) > this.deps.now()) throw new AppError("policy_rate_limited", "The site asked to retry later. No request was made.", 422);
            const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]);
            const previous = this.next.get(url.origin);
            const spacing = this.delays.get(url.origin) ?? 1000;
            if (previous !== undefined) {
                const wait = previous + spacing - this.deps.now();
                if (wait > 0) await this.deps.wait(wait, signal);
            }
            signal.throwIfAborted();
            const answers = await this.deps.resolve(url.hostname.replace(/^\[|\]$/g, ""));
            signal.throwIfAborted();
            if (!answers.length || answers.some((answer) => !isPublicAddress(answer.address))) throw new AppError("policy_private_address", "DNS resolved to a nonpublic address.", 422);
            this.next.set(url.origin, this.deps.now());
            if (this.next.size > 128) { const oldest = this.next.keys().next().value!; this.next.delete(oldest); this.delays.delete(oldest); }
            const response = await this.deps.send({ url, ...answers[0] }, { ...options, signal });
            if (response.status === 429 || (response.status === 503 && response.headers["retry-after"])) {
                const retry = response.headers["retry-after"] ?? "60";
                const until = /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? this.deps.now() + Number(retry) * 1000 : Date.parse(retry);
                const safeUntil = Number.isFinite(until) ? until : this.deps.now() + 60000;
                if (this.retryAfter.size >= 128 && !this.retryAfter.has(url.origin)) this.globalRetryUntil = Math.max(this.globalRetryUntil, safeUntil);
                else this.retryAfter.set(url.origin, safeUntil);
            }
            return response;
        });
        this.queue = run.then(() => undefined, () => undefined);
        return run;
    }
}