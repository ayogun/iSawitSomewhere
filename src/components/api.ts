export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/${path}`, { ...options, cache: "no-store", headers: { ...(typeof options.body === "string" ? { "Content-Type": "application/json" } : {}), ...options.headers } });
    const body = await response.json();
    if (!response.ok) {
        const details = (body.error?.issues ?? []).slice(0, 4).map((issue: { row?: number; field: string; message: string }) => `${issue.row ? `Row ${issue.row}, ` : ""}${issue.field}: ${issue.message}`).join(" ");
        throw new Error(`${body.error?.message ?? "The request could not be completed."}${details ? ` ${details}` : ""}`);
    }
    return body as T;
}

export function post<T>(path: string, body: unknown, options: RequestInit = {}) {
    return api<T>(path, { method: "POST", body: JSON.stringify(body), ...options });
}