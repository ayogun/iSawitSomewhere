export type TimeClue = { phrase: string; start: string; end: string };
export type Clues = { concept: string; domain: string | null; time: TimeClue | null; referenceTime: string; warnings: string[] };
const day = 86400000;
const aliases: Record<string, string> = { github: "github.com", elastic: "elastic.co", aws: "aws.amazon.com" };
const stopWords = new Set("a an the that this those i it saw see think read thing where probably sometime last recently ago on in at of for from to and or was is with my me about some somewhere few months weeks days year".split(" "));

export function meaningfulTerms(text: string): string[] {
    return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((term) => term.length > 1 && !stopWords.has(term));
}

function monthsBefore(date: Date, months: number): number {
    const target = new Date(date);
    const dateOfMonth = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() - months);
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(dateOfMonth, last));
    return target.getTime();
}

export function parseClues(query: string, now = new Date()): Clues {
    let concept = query;
    const domains = new Set<string>();
    const warnings: string[] = [];
    concept = concept.replace(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|dev|co|ai|edu|gov|pl)\b/gi, (domain) => { domains.add(domain.toLowerCase()); return " "; });
    concept = concept.replace(/\b(github|elastic|aws)\b/gi, (alias) => { domains.add(aliases[alias.toLowerCase()]); return " "; });
    const timePattern = /\b(?:a\s+)?few\s+(?:weeks|months)\s+ago\b|\blast year\b|\bpast month\b|\brecently\b|\b\d+\s+(?:days?|weeks?|months?)\s+ago\b/gi;
    const phrases = [...concept.matchAll(timePattern)].map((match) => match[0]);
    let time: TimeClue | null = null;
    if (phrases.length === 1) {
        const phrase = phrases[0];
        const normalized = phrase.toLowerCase();
        let start = now.getTime() - 30 * day;
        let end = now.getTime() + 1;
        if (normalized.includes("few weeks")) { start = now.getTime() - 42 * day; end = now.getTime() - 14 * day; }
        else if (normalized.includes("few months")) { start = now.getTime() - 180 * day; end = now.getTime() - 60 * day; }
        else if (normalized === "last year") { start = Date.UTC(now.getUTCFullYear() - 1, 0, 1); end = Date.UTC(now.getUTCFullYear(), 0, 1); }
        else {
            const numeric = normalized.match(/^(\d+)\s+(day|week|month)s?\s+ago$/);
            if (numeric) {
                const amount = Number(numeric[1]);
                if (amount > 1200) warnings.push("Time clue is outside the supported range; it was not applied.");
                else {
                    const unit = numeric[2];
                    const target = unit === "month" ? monthsBefore(now, amount) : now.getTime() - amount * (unit === "week" ? 7 : 1) * day;
                    const spread = (unit === "month" ? 30 : unit === "week" ? 7 : 2) * day;
                    start = target - spread; end = target + spread;
                }
            }
        }
        if (!warnings.length) time = { phrase, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    } else if (phrases.length > 1) warnings.push("Multiple time clues were found; no inferred time restriction was applied.");
    concept = concept.replace(timePattern, " ").replace(/\b(?:I\s+(?:saw|think|read)|that thing|probably|where|sometime)\b/gi, " ").replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
    if (domains.size > 1) warnings.push("Multiple source clues were found; no source boost was applied.");
    return { concept, domain: domains.size === 1 ? [...domains][0] : null, time, referenceTime: now.toISOString(), warnings };
}