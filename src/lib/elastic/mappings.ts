import type { estypes } from "@elastic/elasticsearch";

export function pageMappings(inferenceId: string): estypes.MappingTypeMapping {
    const keyword: estypes.MappingProperty = { type: "keyword", ignore_above: 8192 };
    const text: estypes.MappingProperty = { type: "text", analyzer: "english" };
    const date: estypes.MappingProperty = { type: "date", format: "strict_date_optional_time" };
    return {
        dynamic: "strict", _meta: { schema_version: 1, inference_id: inferenceId },
        properties: {
            schema_version: { type: "integer" }, id: keyword, url: keyword, domain: keyword,
            dataset: keyword, source: keyword, content_type: keyword,
            title: { ...text, fields: { keyword } }, description: text, content: text, url_search: { type: "text" },
            visited_at: date, first_visited_at: date, last_visited_at: date, created_at: date, updated_at: date, fetched_at: date,
            visit_count: { type: "long" }, imported_visit_count_max: { type: "long" },
            fetch_status: keyword, fetch_reason: keyword, content_provenance: keyword, content_hash: keyword,
            canonical_url: keyword, content_truncated: { type: "boolean" },
            semantic_text: { type: "semantic_text", inference_id: inferenceId },
        },
    };
}