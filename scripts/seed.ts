import { historyRepository } from "../src/lib/elastic/repository";
import { groupRecords } from "../src/lib/history/providers";
import { demoRecords, semanticShowcaseRecords } from "../src/lib/sample";
import { AppError } from "../src/lib/errors";
import { requireCloudConsent, runCli } from "./cli";

void runCli(async () => {
    requireCloudConsent();
    const showcaseOnly = process.argv.includes("--semantic-showcase");
    const groups = groupRecords(showcaseOnly ? semanticShowcaseRecords() : demoRecords());
    if (showcaseOnly && groups.length !== 5) throw new AppError("invalid_showcase", "The semantic showcase must contain exactly five synthetic pages.", 500);
    const repository = historyRepository();
    let completed = 0;
    for (let cursor = 0; cursor < groups.length; cursor += 25) {
        const report = await repository.importGroups("demo", groups.slice(cursor, cursor + 25));
        if (report.failed) throw new AppError("seed_failed", "Some synthetic pages could not be indexed. Check Cloud setup; repeat seeding is idempotent for identical visit timestamps.", 503);
        completed += report.processed;
    }
    console.info(JSON.stringify({ outcome: "synthetic_demo_seeded", corpus: showcaseOnly ? "semantic_showcase" : "sample", pages: completed, personalHistoryTouched: false, websitesContacted: false }));
});