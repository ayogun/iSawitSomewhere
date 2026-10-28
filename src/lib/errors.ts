const appErrorBrand = Symbol.for("i-saw-it-somewhere.AppError");

export class AppError extends Error {
    readonly [appErrorBrand] = true;

    static [Symbol.hasInstance](value: unknown): boolean {
        return Boolean(value && typeof value === "object" && (value as Record<symbol, unknown>)[appErrorBrand] === true);
    }

    constructor(public code: string, message: string, public status = 400, public issues?: { row?: number; field: string; code: string; message: string }[]) {
        super(message);
        this.name = "AppError";
    }
}

export function errorStatus(error: unknown): number | undefined {
    if (error && typeof error === "object" && "meta" in error) {
        return (error as { meta?: { statusCode?: number } }).meta?.statusCode;
    }
    return undefined;
}