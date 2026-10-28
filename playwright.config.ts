import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e", fullyParallel: false, workers: 1,
    reporter: [["line"], ["json", { outputFile: "test-results/report.json" }]],
    use: { baseURL: "http://127.0.0.1:3210", trace: "off", screenshot: "only-on-failure", reducedMotion: "reduce" },
    webServer: {
        command: "npm run dev -- --port 3210", url: "http://127.0.0.1:3210", reuseExistingServer: false,
        env: { NEXT_TELEMETRY_DISABLED: "1", ELASTICSEARCH_URL: "", ELASTICSEARCH_API_KEY: "" }, timeout: 120000,
    },
});