import { describe, expect, it, vi } from "vitest";
import { createServer, type RequestListener } from "node:http";
import { gzipSync } from "node:zlib";
import { PublicTransport, sendPinned, type PublicResponse, type Target, type TransportDependencies } from "../../src/lib/enrichment/transport";
import { extractReadable, PublicPageEnricher } from "../../src/lib/enrichment/enricher";

const signal = () => AbortSignal.timeout(5000);
const approved = new Set(["example.com"]);
function setup(replies: PublicResponse[] = []) {
    const send = vi.fn(async (target: Target) => { expect(target.address).toBeTruthy(); return replies.shift() ?? { status: 404, headers: {}, text: "" }; });
    const resolve = vi.fn(async () => [{ address: "93.184.215.14", family: 4 }]);
    const deps: TransportDependencies = { resolve, send, wait: async () => { }, now: () => 1000000 };
    return { send, resolve, transport: new PublicTransport(deps) };
}

describe("public fetching safety", () => {
    it("makes zero DNS/HTTP requests for unapproved hosts", async () => {
        const { transport, resolve, send } = setup();
        await expect(transport.get("https://example.com/page", new Set(), { signal: signal(), timeoutMs: 5000, maxBytes: 100 })).rejects.toThrow("not been approved");
        expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    });
    it("rejects private or mixed DNS answers before connecting", async () => {
        const { transport, resolve, send } = setup();
        resolve.mockResolvedValue([{ address: "93.184.215.14", family: 4 }, { address: "127.0.0.1", family: 4 }]);
        await expect(transport.get("https://example.com/page", approved, { signal: signal(), timeoutMs: 5000, maxBytes: 100 })).rejects.toThrow("nonpublic");
        expect(send).not.toHaveBeenCalled();
    });
    it("passes the validated address to the pinned connector", async () => {
        const { transport, send } = setup();
        await transport.get("https://example.com/page", approved, { signal: signal(), timeoutMs: 5000, maxBytes: 100 });
        expect(send.mock.calls[0][0].address).toBe("93.184.215.14");
        expect(send.mock.calls[0][0].url.hostname).toBe("example.com");
    });
    it("does not contact an unapproved redirect host", async () => {
        const { transport, send } = setup([{ status: 404, headers: {}, text: "" }, { status: 302, headers: { location: "https://unapproved.com/private" }, text: "" }]);
        const result = await new PublicPageEnricher(transport).enrich("https://example.com/page", approved, signal());
        expect(result).toMatchObject({ status: "skipped", reason: "unapproved_domain" });
        expect(send).toHaveBeenCalledTimes(2);
    });
    it("enforces robots denial and does not fetch the page", async () => {
        const { transport, send } = setup([{ status: 200, headers: {}, text: "User-agent: *\nDisallow: /" }]);
        expect(await new PublicPageEnricher(transport).enrich("https://example.com/page", approved, signal())).toMatchObject({ status: "skipped", reason: "robots_denied" });
        expect(send).toHaveBeenCalledTimes(1);
    });
    it("fails closed when robots is rate-limited or malformed", async () => {
        for (const reply of [{ status: 429, headers: {}, text: "" }, { status: 200, headers: {}, text: "<html>Error page</html>" }]) {
            const { transport, send } = setup([reply]);
            expect((await new PublicPageEnricher(transport).enrich("https://example.com/page", approved, signal())).status).toBe("skipped");
            expect(send).toHaveBeenCalledTimes(1);
        }
    });
    it("revalidates protected redirect paths", async () => {
        const { transport, send } = setup([{ status: 404, headers: {}, text: "" }, { status: 302, headers: { location: "/account/login" }, text: "" }]);
        const outcome = await new PublicPageEnricher(transport).enrich("https://example.com/page", approved, signal());
        expect(outcome.status).toBe("skipped"); expect(send).toHaveBeenCalledTimes(2);
    });
    it("honors Retry-After without issuing another request", async () => {
        const { transport, send } = setup([{ status: 429, headers: { "retry-after": "120" }, text: "" }]);
        await transport.get("https://example.com/page", approved, { signal: signal(), timeoutMs: 5000, maxBytes: 100 });
        await expect(transport.get("https://example.com/page", approved, { signal: signal(), timeoutMs: 5000, maxBytes: 100 })).rejects.toThrow("retry later");
        expect(send).toHaveBeenCalledTimes(1);
    });
});

async function controlledServer(handler: RequestListener, run: (target: Target) => Promise<void>) {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture did not bind");
    try { await run({ url: new URL(`http://example.com:${address.port}/fixture`), address: "127.0.0.1", family: 4 }); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

describe("low-level pinned connector against a controlled HTTP fixture", () => {
    it("preserves Host while connecting only to the validated address", async () => {
        await controlledServer((request, response) => {
            expect(request.headers.host).toContain("example.com:");
            expect(request.headers.cookie).toBeUndefined();
            response.writeHead(200, { "content-type": "text/html" }); response.end("<p>fixture</p>");
        }, async (target) => {
            const response = await sendPinned(target, { signal: signal(), maxBytes: 1000, timeoutMs: 1000 });
            expect(response.text).toBe("<p>fixture</p>");
        });
    });
    it("limits decompressed bytes even when the server ignores identity encoding", async () => {
        await controlledServer((_request, response) => { response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }); response.end(gzipSync("a".repeat(10000))); }, async (target) => {
            await expect(sendPinned(target, { signal: signal(), maxBytes: 100, timeoutMs: 1000 })).rejects.toThrow("decompressed response");
        });
    });
    it("rejects non-HTML content and does not follow redirects automatically", async () => {
        await controlledServer((_request, response) => { response.writeHead(200, { "content-type": "application/pdf" }); response.end("not html"); }, async (target) => {
            await expect(sendPinned(target, { signal: signal(), maxBytes: 100, timeoutMs: 1000 })).rejects.toThrow("Only public HTML");
        });
        await controlledServer((_request, response) => { response.writeHead(302, { location: "https://unapproved.example/path" }); response.end(); }, async (target) => {
            expect((await sendPinned(target, { signal: signal(), maxBytes: 100, timeoutMs: 1000 })).status).toBe(302);
        });
    });
    it("aborts stalled response bodies", async () => {
        await controlledServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.write("initial"); }, async (target) => {
            await expect(sendPinned(target, { signal: AbortSignal.timeout(50), maxBytes: 1000, timeoutMs: 1000 })).rejects.toThrow();
        });
    });
});

describe("readable extraction", () => {
    it("never executes scripts and discards forms/navigation", () => {
        const html = `<html><head><title>Browser automation</title></head><body><nav>UNRELATED NAVIGATION</nav><form><input value="PRIVATE FORM VALUE"></form><article><h1>Browser automation</h1><p>${"An AI agent uses a browser to navigate public websites and complete useful tasks. ".repeat(8)}</p><script>throw new Error('executed');</script></article></body></html>`;
        const outcome = extractReadable(html, "https://example.com/page");
        expect(outcome.status).toBe("fetched"); expect(outcome.content).toContain("AI agent");
        expect(outcome.content).not.toContain("PRIVATE FORM"); expect(outcome.content).not.toContain("UNRELATED NAVIGATION");
        expect(outcome.content).not.toContain("throw new Error");
    });
    it("does not store an empty page or known protection page", () => {
        expect(extractReadable("<html><title>Verify you are human</title><body>blocked</body></html>", "https://example.com").status).toBe("skipped");
        expect(extractReadable("<html><body>small</body></html>", "https://example.com").status).toBe("failed");
    });
});