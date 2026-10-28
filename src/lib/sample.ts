import fixture from "../../fixtures/history.json";
import showcaseFixture from "../../fixtures/semantic-showcase.json";
import { jsonProvider } from "./history/providers";

export const sampleAnchor = new Date("2026-10-25T12:00:00Z");
export const semanticShowcaseCases = showcaseFixture.map(({ query, url }) => ({ query, url }));
const topics = [
    ["A CSS grid notebook", "Responsive web layouts with grid tracks, spacing, typography and accessible controls."],
    ["A hiking trail beside the lake", "A walking route with a forest, a lake and a mountain view."],
    ["Understanding database transactions", "Relational database isolation, write conflicts, indexes and SQL query plans."],
    ["A Warsaw neighbourhood guide", "Public transport, local parks and places to live in the city of Warsaw."],
    ["Testing a web checkout", "Scripted browser testing checks forms and buttons without autonomous reasoning."],
    ["Building an AI task planner", "An agent schedules tasks and calls calendar tools without controlling a browser."],
    ["Keeping applications reliable", "Incident response, cloud outage timelines and retry storms in distributed systems."],
    ["Apple Silicon performance notes", "A Mac uses unified memory for efficient local machine learning workloads."],
    ["A keyword relevance workshop", "Full-text search uses analyzers and BM25 to score terms in document fields."],
    ["Cooking with seasonal vegetables", "A collection of recipes with tomatoes, herbs and home-grown vegetables."],
];

export function sampleRecords(now = new Date()) {
    const shift = now.getTime() - sampleAnchor.getTime();
    const core = fixture.map((record) => ({ ...record, visited_at: new Date(Date.parse(record.visited_at) + shift).toISOString() }));
    const extras = Array.from({ length: 49 }, (_, index) => {
        const [title, text] = topics[index % topics.length];
        return {
            url: `https://example.com/synthetic/notebook-${index + 1}`, title: `${title} ${index + 1}`,
            visited_at: new Date(now.getTime() - (index + 5) * 86400000).toISOString(),
            description: `Synthetic notebook entry ${index + 1}.`, page_content: `Original synthetic text: ${text} Notebook observation ${index + 1}.`,
        };
    });
    const revisits = extras.slice(0, 40).map((record, index) => ({ ...record, visited_at: new Date(now.getTime() - (index + 1) * 3600000).toISOString() }));
    return jsonProvider.parse(JSON.stringify([...core, ...extras, ...revisits])).records.map((record) => ({ ...record, source: "synthetic" as const }));
}

export function semanticShowcaseRecords(now = new Date()) {
    const shift = now.getTime() - sampleAnchor.getTime();
    const records = showcaseFixture.map(({ url, title, visited_at, description, page_content }) => ({
        url, title, description, page_content,
        visited_at: new Date(Date.parse(visited_at) + shift).toISOString(),
    }));
    return jsonProvider.parse(JSON.stringify(records)).records.map((record) => ({ ...record, source: "synthetic" as const }));
}

export function demoRecords(now = new Date()) {
    return [...sampleRecords(now), ...semanticShowcaseRecords(now)];
}