import { AppError, errorStatus } from "../src/lib/errors";
import { configuration } from "../src/lib/elastic/client";

export function requireCloudConsent() {
    const config = configuration();
    if (!config.configured) throw new AppError("setup_required", "Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY in .env.local. No Cloud requests were made.", 503);
    if (!process.argv.includes("--consent")) throw new AppError("consent_required", "This command transmits synthetic text to Elastic Cloud / paid ELSER inference. Rerun with --consent to approve.", 403);
    return config;
}

export async function runCli(task: () => Promise<void>) {
    try { await task(); }
    catch (error) {
        console.error(JSON.stringify({ outcome: "blocked_or_failed", code: error instanceof AppError ? error.code : `cloud_error_${errorStatus(error) ?? "unknown"}`, message: error instanceof AppError ? error.message : "Cloud validation failed. Check endpoint, license, network and API-key permissions. Raw errors are not logged." }));
        process.exitCode = 2;
    }
}