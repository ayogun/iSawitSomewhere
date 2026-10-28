import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { AppError, errorStatus } from "./errors";

export function protectRequest(request: Request) {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    let external: URL;
    try { external = new URL(`${url.protocol}//${host}`); }
    catch { throw new AppError("host_rejected", "This API is available only through the local application.", 403); }
    const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
    if (!host || external.host !== host || !loopback.has(url.hostname) || !loopback.has(external.hostname) || external.port !== url.port) throw new AppError("host_rejected", "This API is available only through the local application.", 403);
    const origin = request.headers.get("origin");
    if ((origin && origin !== external.origin) || (request.method !== "GET" && origin !== external.origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new AppError("origin_rejected", "Use the application from the same local origin.", 403);
}

export async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
    if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new AppError("body_limit", "Request exceeds the size limit.", 413);
    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) { await reader.cancel(); throw new AppError("body_limit", "Request exceeds the size limit.", 413); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
}

export async function jsonBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("content_type", "Send application/json.");
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(request, 65536))); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError("invalid_json", "Request is not valid JSON."); }
    return schema.parse(raw);
}

export function safeFailure(error: unknown, requestId: string) {
    if (error instanceof ZodError) return { status: 422, body: { error: { code: "validation_failed", message: "Some fields are missing, malformed, or outside the supported range.", requestId, issues: error.issues.map((issue) => ({ field: issue.path.join("."), code: issue.code, message: "Check this field against the documented format." })) } } };
    const safe = error instanceof AppError ? error : new AppError(errorStatus(error) === 401 || errorStatus(error) === 403 ? "cloud_access_denied" : "service_unavailable", errorStatus(error) === 401 || errorStatus(error) === 403 ? "Check the Elastic API key and its application-index/inference permissions." : "The search service could not complete the request. Check configuration and try again.", 503);
    return { status: safe.status, body: { error: { code: safe.code, message: safe.message, requestId, ...(safe.issues ? { issues: safe.issues } : {}) } } };
}

export async function apiResponse(request: Request, operation: string, handler: () => Promise<unknown>) {
    const requestId = randomUUID();
    const started = performance.now();
    let code = "ok";
    const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-ID": requestId };
    try {
        protectRequest(request);
        return Response.json(await handler(), { headers });
    } catch (error) {
        const failure = safeFailure(error, requestId);
        code = failure.body.error.code;
        return Response.json(failure.body, { status: failure.status, headers });
    } finally {
        console.info(JSON.stringify({ requestId, operation, latencyMs: Math.round(performance.now() - started), code }));
    }
}