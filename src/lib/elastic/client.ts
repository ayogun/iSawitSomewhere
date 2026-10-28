import { Client } from "@elastic/elasticsearch";
import { AppError } from "../errors";
import type { Dataset } from "../history/schema";

export function configuration() {
    const url = process.env.ELASTICSEARCH_URL;
    const apiKey = process.env.ELASTICSEARCH_API_KEY;
    const prefix = process.env.ELASTICSEARCH_INDEX_PREFIX ?? "isis";
    const inferenceId = process.env.ELASTICSEARCH_INFERENCE_ID ?? ".elser-2-elastic";
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(prefix)) throw new AppError("invalid_configuration", "Use a lowercase alphanumeric index prefix.", 503);
    if (inferenceId !== ".elser-2-elastic") throw new AppError("invalid_configuration", "V1 requires the explicit Elastic-hosted .elser-2-elastic endpoint.", 503);
    if (url) {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
        } catch { throw new AppError("invalid_configuration", "Configure an HTTPS Elastic Cloud URL without credentials in the URL.", 503); }
    }
    return { url, apiKey, prefix, inferenceId, configured: Boolean(url && apiKey) };
}

let client: Client | undefined;
export function elasticClient(): Client {
    const config = configuration();
    if (!config.configured) throw new AppError("setup_required", "Add your Elastic Cloud URL and API key to .env.local, then restart the app.", 503);
    client ??= new Client({ node: config.url!, auth: { apiKey: config.apiKey! }, maxRetries: 0, requestTimeout: 10000 });
    return client;
}

export function indexName(dataset: Dataset, prefix = configuration().prefix) {
    return `${prefix}-${dataset}-v1`;
}