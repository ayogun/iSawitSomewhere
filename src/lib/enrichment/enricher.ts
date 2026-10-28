import robotsParser from "robots-parser";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { AppError } from "../errors";
import { normalizeUrl } from "../history/url";
import { PublicTransport } from "./transport";

export type EnrichmentOutcome = {
    status: "fetched" | "skipped" | "failed"; reason: string;
    title?: string; description?: string; content?: string; canonicalUrl?: string; truncated?: boolean;
};
export interface PageEnricher { enrich(url: string, approved: ReadonlySet<string>, signal: AbortSignal): Promise<EnrichmentOutcome> }

export function extractReadable(html: string, url: string): EnrichmentOutcome {
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
    try {
        const document = dom.window.document;
        if (/just a moment|access denied|verify you are human|sign in to continue|subscribe to continue/i.test(document.title) || document.querySelector('[itemprop="isAccessibleForFree"][content="false"], [data-paywall], .cf-challenge, #challenge-form')) {
            return { status: "skipped", reason: "restricted_content" };
        }
        const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute("content")?.trim().slice(0, 10000);
        const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
        let canonicalUrl: string | undefined;
        if (canonical) { try { canonicalUrl = normalizeUrl(new URL(canonical, url).href).href; } catch { canonicalUrl = undefined; } }
        document.querySelectorAll("script,style,noscript,iframe,object,embed,form,input,textarea,select,button,nav,header,footer,aside,[role=navigation],[role=banner],.advertisement,.ad,.ads,[data-ad]").forEach((node) => node.remove());
        const article = new Readability(document, { charThreshold: 80 }).parse();
        const text = article?.textContent?.replace(/\s+/g, " ").trim();
        if (!text || text.length < 80) return { status: "failed", reason: "no_readable_content" };
        return { status: "fetched", reason: "ok", title: article?.title?.trim().slice(0, 2000) || undefined, description, content: text.slice(0, 100000), canonicalUrl, truncated: text.length > 100000 };
    } finally { dom.window.close(); }
}

export class PublicPageEnricher implements PageEnricher {
    private robots = new Map<string, { expiresAt: number; parser: ReturnType<typeof robotsParser> }>();
    constructor(readonly transport = new PublicTransport()) { }
    clear() { this.robots.clear(); this.transport.clear(); }

    private async allow(url: URL, approved: ReadonlySet<string>, signal: AbortSignal) {
        let cached = this.robots.get(url.origin);
        if (!cached || cached.expiresAt <= Date.now()) {
            const response = await this.transport.get(new URL("/robots.txt", url).href, approved, { signal, maxBytes: 256 * 1024, timeoutMs: 5000, robots: true });
            if (![200, 404, 410].includes(response.status)) throw new AppError("policy_robots_unavailable", "Robots policy is unavailable or restricted.", 422);
            if (response.status === 200 && response.text.trim() && (!/^\s*user-agent\s*:/im.test(response.text) || /<html|<!doctype/i.test(response.text))) throw new AppError("policy_robots_invalid", "Robots policy could not be interpreted safely.", 422);
            const text = response.status !== 200 || !response.text.trim() ? "User-agent: *\nAllow: /" : response.text;
            cached = { parser: robotsParser(new URL("/robots.txt", url).href, text), expiresAt: Date.now() + 300000 };
            for (const [origin, entry] of this.robots) if (entry.expiresAt <= Date.now()) this.robots.delete(origin);
            if (this.robots.size >= 128) this.robots.delete(this.robots.keys().next().value!);
            this.robots.set(url.origin, cached);
        }
        if (cached.parser.isAllowed(url.href, "ISawItSomewhere") !== true) throw new AppError("policy_robots_denied", "The site's robots policy does not allow this request.", 422);
        const delay = cached.parser.getCrawlDelay("ISawItSomewhere");
        if (delay) this.transport.setCrawlDelay(url.origin, delay);
    }

    async enrich(value: string, approved: ReadonlySet<string>, signal: AbortSignal): Promise<EnrichmentOutcome> {
        const deadline = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
        let url = normalizeUrl(value);
        try {
            for (let redirect = 0; redirect <= 3; redirect++) {
                if (!approved.has(url.hostname)) return { status: "skipped", reason: "unapproved_domain" };
                await this.allow(url, approved, deadline);
                const response = await this.transport.get(url.href, approved, { signal: deadline, maxBytes: 2 * 1024 * 1024, timeoutMs: 12000 });
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    if (redirect === 3 || !response.headers.location) return { status: "skipped", reason: "redirect_limit" };
                    url = normalizeUrl(new URL(response.headers.location, url).href);
                    continue;
                }
                if ([401, 403, 429].includes(response.status)) return { status: "skipped", reason: response.status === 429 ? "rate_limited" : "authentication_or_protection" };
                if (response.status !== 200) return { status: "failed", reason: "http_error" };
                return extractReadable(response.text, url.href);
            }
            return { status: "skipped", reason: "redirect_limit" };
        } catch (error) {
            if (error instanceof AppError && error.code.startsWith("policy_")) return { status: "skipped", reason: error.code.replace(/^policy_/, "") };
            return { status: "failed", reason: deadline.aborted ? "request_timeout_or_cancelled" : "fetch_failed" };
        }
    }
}