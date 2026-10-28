import { createHash } from "node:crypto";
import ipaddr from "ipaddr.js";
import { AppError } from "../errors";

const secretKey = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|code|session(?:id)?|sid|password|passwd|secret|api[_-]?key|signature|sig|x-amz-.+|x-goog-.+)$/i;
const protectedSegment = /^(?:login|log-in|signin|sign-in|signup|sign-up|logout|auth|oauth2?|account|accounts|settings|preferences|password|reset-password|admin)$/i;

export function isPublicAddress(address: string): boolean {
    try {
        const parsed = ipaddr.parse(address.replace(/^\[|\]$/g, ""));
        if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) return false;
        return parsed.range() === "unicast";
    } catch {
        return false;
    }
}

function decoded(value: string): string {
    let result = value;
    for (let pass = 0; pass < 3; pass++) {
        try {
            const next = decodeURIComponent(result);
            if (next === result) return result;
            result = next;
        } catch {
            throw new AppError("unsafe_url", "URL contains malformed encoding.", 422);
        }
    }
    if (/%[0-9a-f]{2}/i.test(result)) throw new AppError("unsafe_url", "URL encoding is too deeply nested.", 422);
    return result;
}

export function normalizeUrl(value: string): URL {
    let url: URL;
    try { url = new URL(value); } catch { throw new AppError("invalid_url", "Use an absolute HTTP or HTTPS URL.", 422); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new AppError("unsafe_url", "Unsupported scheme or credentials in URL.", 422);
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const isIp = ipaddr.isValid(host);
    if ((isIp && !isPublicAddress(host)) || (!isIp && (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(host)))) {
        throw new AppError("private_url", "Local or nonpublic addresses are not accepted.", 422);
    }
    for (const key of url.searchParams.keys()) {
        if (secretKey.test(decoded(key))) throw new AppError("secret_url", "URL may contain authentication or signed credentials.", 422);
    }
    const hash = decoded(url.hash);
    if (/(?:token|session|password|secret|api[_-]?key|authorization|signature|(?:^|[?#&])code)\s*=/i.test(hash)) {
        throw new AppError("secret_url", "URL fragment may contain credentials.", 422);
    }
    const trackers = [...url.searchParams.keys()].filter((key) => /^utm_/i.test(key) || /^(?:fbclid|gclid)$/i.test(key));
    for (const key of trackers) url.searchParams.delete(key);
    if (!url.hash.startsWith("#/") && !url.hash.startsWith("#!")) url.hash = "";
    return url;
}

export function fetchEligibility(value: string): string | null {
    try {
        const url = normalizeUrl(value);
        if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) return "nonstandard_port";
        const segments = decoded(url.pathname).split(/[\/?#;]/);
        if (segments.some((segment) => protectedSegment.test(segment))) return "protected_path";
        return null;
    } catch {
        return "unsafe_url";
    }
}

export function pageId(url: string): string {
    return createHash("sha256").update(url).digest("hex");
}