/**
 * Search across a person's settings.
 *
 * The index is a hand-written list of every section and control, each with
 * the words people actually use for it. Two kinds of result come back:
 *
 * - "exact": the query is the name of a section, a tab, or one of its
 *   controls, or a whole phrase inside one. These rank first.
 * - "related": the query means the same thing by other words ("api key" for
 *   Bring Your Own Keys, "dark" for Appearance, "2fa" for Security), or is
 *   close enough in spelling to count as a typo. Matching goes through the
 *   entry's vocabulary (its description and keywords), word prefixes, and a
 *   character-bigram similarity so a mistyped word still lands.
 *
 * Everything runs in the browser against this static list, so results are
 * instant and need no key or network.
 */

import { sourceTranslator } from "@mike/client";
import type { Translate } from "@/i18n/Translate";

export type SettingsSearchEntry = {
    /** Stable id, also the React key. */
    id: string;
    /** The tab's id in the settings layout, for hiding entries with their tab. */
    tabId: string;
    /** The tab's label, shown as the result's trail. */
    tab: string;
    /** The section or control the result opens. */
    title: string;
    /** One sentence about what it does; shown and searched. */
    description: string;
    /** Other words for the same thing: synonyms, jargon, related nouns. */
    keywords: readonly string[];
    /** Where it is, with a hash for the section heading when there is one. */
    href: string;
    /** The same entry in English, searched too when the text above is in another language. */
    source?: SettingsSearchEntry;
};

export type SettingsSearchMatchKind = "exact" | "related";

export type SettingsSearchResult = {
    entry: SettingsSearchEntry;
    kind: SettingsSearchMatchKind;
    score: number;
};

/** A message with a keyword list: the words are separated by "|". */
function keywordList(text: string): string[] {
    return text
        .split("|")
        .map((word) => word.trim())
        .filter(Boolean);
}

function buildEntries(t: Translate): SettingsSearchEntry[] {
    return [
        {
            id: "account-profile",
            tabId: "account",
            tab: t("settings.map.tab.account.title"),
            title: t("settings.searchIndex.accountProfile.title"),
            description: t("settings.searchIndex.accountProfile.description"),
            keywords: keywordList(t("settings.searchIndex.accountProfile.keywords")),
            href: "/settings#profile",
        },
        {
            id: "account-email",
            tabId: "account",
            tab: t("settings.map.tab.account.title"),
            title: t("settings.searchIndex.accountEmail.title"),
            description: t("settings.searchIndex.accountEmail.description"),
            keywords: keywordList(t("settings.searchIndex.accountEmail.keywords")),
            href: "/settings#email",
        },
        {
            id: "account-plan",
            tabId: "account",
            tab: t("settings.map.tab.account.title"),
            title: t("settings.searchIndex.accountPlan.title"),
            description: t("settings.searchIndex.accountPlan.description"),
            keywords: keywordList(t("settings.searchIndex.accountPlan.keywords")),
            href: "/settings#usage-plan",
        },
        {
            id: "account-delete",
            tabId: "account",
            tab: t("settings.map.tab.account.title"),
            title: t("settings.searchIndex.accountDelete.title"),
            description: t("settings.searchIndex.accountDelete.description"),
            keywords: keywordList(t("settings.searchIndex.accountDelete.keywords")),
            href: "/settings#danger-zone",
        },
        {
            id: "account-source-code",
            tabId: "account",
            tab: t("settings.map.tab.account.title"),
            title: t("settings.searchIndex.accountSourceCode.title"),
            description: t("settings.searchIndex.accountSourceCode.description"),
            keywords: keywordList(t("settings.searchIndex.accountSourceCode.keywords")),
            href: "/settings#acerca-de",
        },
        {
            id: "personalisation-background",
            tabId: "personalisation",
            tab: t("settings.map.tab.personalisation.title"),
            title: t("settings.searchIndex.personalisationBackground.title"),
            description: t("settings.searchIndex.personalisationBackground.description"),
            keywords: keywordList(t("settings.searchIndex.personalisationBackground.keywords")),
            href: "/settings/personalisation#your-background",
        },
        {
            id: "personalisation-response-style",
            tabId: "personalisation",
            tab: t("settings.map.tab.personalisation.title"),
            title: t("settings.searchIndex.personalisationResponseStyle.title"),
            description: t("settings.searchIndex.personalisationResponseStyle.description"),
            keywords: keywordList(t("settings.searchIndex.personalisationResponseStyle.keywords")),
            href: "/settings/personalisation#response-style-heading",
        },
        {
            id: "memory",
            tabId: "memory",
            tab: t("settings.map.tab.memory.title"),
            title: t("settings.searchIndex.memory.title"),
            description: t("settings.searchIndex.memory.description"),
            keywords: keywordList(t("settings.searchIndex.memory.keywords")),
            href: "/settings/memory#app-memory-settings-heading",
        },
        {
            id: "memory-file",
            tabId: "memory",
            tab: t("settings.map.tab.memory.title"),
            title: t("settings.searchIndex.memoryFile.title"),
            description: t("settings.searchIndex.memoryFile.description"),
            keywords: keywordList(t("settings.searchIndex.memoryFile.keywords")),
            href: "/settings/memory#app-memory-file-heading",
        },
        {
            id: "appearance-theme",
            tabId: "appearance",
            tab: t("settings.map.tab.appearance.title"),
            title: t("settings.searchIndex.appearanceTheme.title"),
            description: t("settings.searchIndex.appearanceTheme.description"),
            keywords: keywordList(t("settings.searchIndex.appearanceTheme.keywords")),
            href: "/settings/appearance#theme",
        },
        {
            id: "appearance-text-size",
            tabId: "appearance",
            tab: t("settings.map.tab.appearance.title"),
            title: t("settings.searchIndex.appearanceTextSize.title"),
            description: t("settings.searchIndex.appearanceTextSize.description"),
            keywords: keywordList(t("settings.searchIndex.appearanceTextSize.keywords")),
            href: "/settings/appearance#text-size",
        },
        {
            id: "assistant-quick-actions",
            tabId: "assistant",
            tab: t("settings.map.tab.assistant.title"),
            title: t("settings.searchIndex.featuresQuickActions.title"),
            description: t("settings.searchIndex.featuresQuickActions.description"),
            keywords: keywordList(t("settings.searchIndex.featuresQuickActions.keywords")),
            href: "/settings/assistant#assistant-features",
        },
        {
            id: "assistant-response-details",
            tabId: "assistant",
            tab: t("settings.map.tab.assistant.title"),
            title: t("settings.searchIndex.featuresResponseDetails.title"),
            description: t("settings.searchIndex.featuresResponseDetails.description"),
            keywords: keywordList(t("settings.searchIndex.featuresResponseDetails.keywords")),
            href: "/settings/assistant#assistant-features",
        },
        {
            id: "privacy-export",
            tabId: "privacy-data",
            tab: t("settings.map.tab.privacyData.title"),
            title: t("settings.searchIndex.privacyExport.title"),
            description: t("settings.searchIndex.privacyExport.description"),
            keywords: keywordList(t("settings.searchIndex.privacyExport.keywords")),
            href: "/settings/privacy-data#export-data",
        },
        {
            id: "privacy-delete",
            tabId: "privacy-data",
            tab: t("settings.map.tab.privacyData.title"),
            title: t("settings.searchIndex.privacyDelete.title"),
            description: t("settings.searchIndex.privacyDelete.description"),
            keywords: keywordList(t("settings.searchIndex.privacyDelete.keywords")),
            href: "/settings/privacy-data#delete-data",
        },
        {
            id: "my-activity",
            tabId: "my-activity",
            tab: t("settings.map.tab.myActivity.title"),
            title: t("settings.searchIndex.myActivity.title"),
            description: t("settings.searchIndex.myActivity.description"),
            keywords: keywordList(t("settings.searchIndex.myActivity.keywords")),
            href: "/settings/my-activity",
        },
        {
            id: "security-mfa",
            tabId: "security",
            tab: t("settings.map.tab.security.title"),
            title: t("settings.searchIndex.securityMfa.title"),
            description: t("settings.searchIndex.securityMfa.description"),
            keywords: keywordList(t("settings.searchIndex.securityMfa.keywords")),
            href: "/settings/security#multi-factor-authentication",
        },
        {
            id: "security-password",
            tabId: "security",
            tab: t("settings.map.tab.security.title"),
            title: t("settings.searchIndex.securityPassword.title"),
            description: t("settings.searchIndex.securityPassword.description"),
            keywords: keywordList(t("settings.searchIndex.securityPassword.keywords")),
            href: "/settings/security#password",
        },
        {
            id: "models-chat-title",
            tabId: "models",
            tab: t("settings.map.tab.models.title"),
            title: t("settings.searchIndex.modelsChatTitle.title"),
            description: t("settings.searchIndex.modelsChatTitle.description"),
            keywords: keywordList(t("settings.searchIndex.modelsChatTitle.keywords")),
            href: "/settings/models#model-preferences",
        },
        {
            id: "models-tabular",
            tabId: "models",
            tab: t("settings.map.tab.models.title"),
            title: t("settings.searchIndex.modelsTabular.title"),
            description: t("settings.searchIndex.modelsTabular.description"),
            keywords: keywordList(t("settings.searchIndex.modelsTabular.keywords")),
            href: "/settings/models#model-preferences",
        },
        {
            id: "models-memory",
            tabId: "models",
            tab: t("settings.map.tab.models.title"),
            title: t("settings.searchIndex.modelsMemory.title"),
            description: t("settings.searchIndex.modelsMemory.description"),
            keywords: keywordList(t("settings.searchIndex.modelsMemory.keywords")),
            href: "/settings/models#model-preferences",
        },
        {
            id: "models-subagents",
            tabId: "models",
            tab: t("settings.map.tab.models.title"),
            title: t("settings.searchIndex.modelsSubagents.title"),
            description: t("settings.searchIndex.modelsSubagents.description"),
            keywords: keywordList(t("settings.searchIndex.modelsSubagents.keywords")),
            href: "/settings/models#subagents-heading",
        },
        {
            id: "byok",
            tabId: "byok",
            tab: t("settings.map.tab.byok.title"),
            title: t("settings.searchIndex.byok.title"),
            description: t("settings.searchIndex.byok.description"),
            keywords: keywordList(t("settings.searchIndex.byok.keywords")),
            href: "/settings/byok",
        },
        {
            id: "web-search",
            tabId: "web-search",
            tab: t("settings.map.tab.webSearch.title"),
            title: t("settings.searchIndex.webSearch.title"),
            description: t("settings.searchIndex.webSearch.description"),
            keywords: keywordList(t("settings.searchIndex.webSearch.keywords")),
            href: "/settings/web-search#web-search-heading",
        },
        {
            id: "scan-reading",
            tabId: "scan-reading",
            tab: t("settings.map.tab.scanReading.title"),
            title: t("settings.searchIndex.scanReading.title"),
            description: t("settings.searchIndex.scanReading.description"),
            keywords: keywordList(t("settings.searchIndex.scanReading.keywords")),
            href: "/settings/scan-reading",
        },
        {
            id: "split-classes",
            tabId: "scan-reading",
            tab: t("settings.map.tab.scanReading.title"),
            title: t("settings.searchIndex.splitClasses.title"),
            description: t("settings.searchIndex.splitClasses.description"),
            keywords: keywordList(t("settings.searchIndex.splitClasses.keywords")),
            href: "/settings/scan-reading",
        },
        {
            id: "connectors-installed",
            tabId: "connectors",
            tab: t("settings.map.tab.connectors.title"),
            title: t("settings.searchIndex.connectorsInstalled.title"),
            description: t("settings.searchIndex.connectorsInstalled.description"),
            keywords: keywordList(t("settings.searchIndex.connectorsInstalled.keywords")),
            href: "/settings/connectors#installed-connectors-heading",
        },
        {
            id: "connectors-discover",
            tabId: "connectors",
            tab: t("settings.map.tab.connectors.title"),
            title: t("settings.searchIndex.connectorsDiscover.title"),
            description: t("settings.searchIndex.connectorsDiscover.description"),
            keywords: keywordList(t("settings.searchIndex.connectorsDiscover.keywords")),
            href: "/settings/connectors#discover-connectors-heading",
        },
        {
            id: "training",
            tabId: "training",
            tab: t("settings.map.tab.training.title"),
            title: t("settings.searchIndex.training.title"),
            description: t("settings.searchIndex.training.description"),
            keywords: keywordList(t("settings.searchIndex.training.keywords")),
            href: "/settings/training#mi-formacion",
        },
        {
            id: "training-pupils",
            tabId: "training",
            tab: t("settings.map.tab.training.title"),
            title: t("settings.searchIndex.trainingPupils.title"),
            description: t("settings.searchIndex.trainingPupils.description"),
            keywords: keywordList(t("settings.searchIndex.trainingPupils.keywords")),
            href: "/settings/training#mis-pupilos",
        },
        {
            id: "training-mentor-panel",
            tabId: "training",
            tab: t("settings.map.tab.training.title"),
            title: t("settings.searchIndex.trainingMentorPanel.title"),
            description: t("settings.searchIndex.trainingMentorPanel.description"),
            keywords: keywordList(t("settings.searchIndex.trainingMentorPanel.keywords")),
            href: "/settings/training/mentor#panel-del-mentor",
        },
        {
            id: "organizations",
            tabId: "organizations",
            tab: t("settings.map.tab.organizations.title"),
            title: t("settings.searchIndex.organizations.title"),
            description: t("settings.searchIndex.organizations.description"),
            keywords: keywordList(t("settings.searchIndex.organizations.keywords")),
            href: "/settings/organizations#my-organizations-heading",
        },
        {
            id: "organizations-invitations",
            tabId: "organizations",
            tab: t("settings.map.tab.organizations.title"),
            title: t("settings.searchIndex.organizationsInvitations.title"),
            description: t("settings.searchIndex.organizationsInvitations.description"),
            keywords: keywordList(t("settings.searchIndex.organizationsInvitations.keywords")),
            href: "/settings/organizations#my-invitations-heading",
        },
    ];
}

/** The index in English, the source catalog: always searched, whatever the language. */
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] =
    buildEntries(sourceTranslator as unknown as Translate);

/**
 * The index in the interface language, `t`'s. Each entry also carries its
 * English text (`source`) so that a search finds an English term in Spanish
 * and the other way round.
 */
export function localizedSettingsEntries(t: Translate): SettingsSearchEntry[] {
    return buildEntries(t).map((entry, at) => ({
        ...entry,
        source: SETTINGS_SEARCH_ENTRIES[at],
    }));
}

const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "of", "to", "for", "in", "on", "my", "me",
    "i", "is", "it", "do", "how", "can", "where", "find", "change", "set",
    "setting", "settings", "want", "with", "up",
]);

function normalise(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Folds the commonest plural and British/American spellings into one token. */
function stem(word: string): string {
    let w = word.replace(/isation$/, "ization").replace(/ise$/, "ize");
    if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
    else if (w.length > 3 && w.endsWith("es") && !w.endsWith("ses")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    return w;
}

function tokens(text: string): string[] {
    return normalise(text).split(" ").filter(Boolean).map(stem);
}

function bigrams(word: string): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < word.length - 1; i += 1) out.add(word.slice(i, i + 2));
    return out;
}

/**
 * Sørensen–Dice similarity over character bigrams, 0..1. The caller only
 * compares two different words of four or more letters, so both have bigrams.
 */
function similarity(a: string, b: string): number {
    const ga = bigrams(a);
    const gb = bigrams(b);
    let shared = 0;
    for (const g of ga) if (gb.has(g)) shared += 1;
    return (2 * shared) / (ga.size + gb.size);
}

type IndexedName = {
    /** The phrase, normalised, and the same with its words stemmed. */
    phrase: string;
    stemmed: string;
    /** 2 for the title, 1.5 for the tab, 1 for a keyword. */
    rank: number;
};

type IndexedEntry = {
    entry: SettingsSearchEntry;
    /** Phrases a query can equal or sit inside to count as exact. */
    names: IndexedName[];
    /** Every word in the entry, with how strongly it identifies the entry. */
    vocabulary: Map<string, number>;
};

type Index = {
    entries: IndexedEntry[];
    /** Every word any entry knows; typo tolerance applies only outside it. */
    known: Set<string>;
};

const NAME_WEIGHT = 1;
const KEYWORD_WEIGHT = 0.9;
const DESCRIPTION_WEIGHT = 0.6;

function addWords(vocabulary: Map<string, number>, text: string, weight: number) {
    for (const word of tokens(text)) {
        if (STOP_WORDS.has(word)) continue;
        const current = vocabulary.get(word) ?? 0;
        if (weight > current) vocabulary.set(word, weight);
    }
}

function indexName(text: string, rank: number): IndexedName {
    return { phrase: normalise(text), stemmed: tokens(text).join(" "), rank };
}

function index(entry: SettingsSearchEntry): IndexedEntry {
    const vocabulary = new Map<string, number>();
    addWords(vocabulary, entry.title, NAME_WEIGHT);
    addWords(vocabulary, entry.tab, NAME_WEIGHT);
    for (const keyword of entry.keywords) addWords(vocabulary, keyword, KEYWORD_WEIGHT);
    addWords(vocabulary, entry.description, DESCRIPTION_WEIGHT);
    const names = [
        indexName(entry.title, 2),
        indexName(entry.tab, 1.5),
        ...entry.keywords.map((keyword) => indexName(keyword, 1)),
    ];
    // The English text counts too, a little below the interface language's.
    const source = entry.source;
    if (source) {
        addWords(vocabulary, source.title, NAME_WEIGHT);
        addWords(vocabulary, source.tab, NAME_WEIGHT);
        for (const keyword of source.keywords) addWords(vocabulary, keyword, KEYWORD_WEIGHT);
        addWords(vocabulary, source.description, DESCRIPTION_WEIGHT);
        names.push(
            indexName(source.title, 1.9),
            indexName(source.tab, 1.4),
            ...source.keywords.map((keyword) => indexName(keyword, 0.9)),
        );
    }
    return { entry, names, vocabulary };
}

const indexCache = new WeakMap<readonly SettingsSearchEntry[], Index>();

function indexed(entries: readonly SettingsSearchEntry[]): Index {
    let result = indexCache.get(entries);
    if (!result) {
        const indexedEntries = entries.map(index);
        const known = new Set<string>();
        for (const item of indexedEntries)
            for (const word of item.vocabulary.keys()) known.add(word);
        result = { entries: indexedEntries, known };
        indexCache.set(entries, result);
    }
    return result;
}

function containsPhrase(name: string, phrase: string): boolean {
    if (name === phrase) return true;
    const at = name.indexOf(phrase);
    if (at < 0) return false;
    const before = at === 0 || name[at - 1] === " ";
    const end = at + phrase.length;
    const after = end === name.length || name[end] === " ";
    return before && after;
}

/**
 * Whether a query word is one the index knows, as a word or as the start of
 * one. A known word is taken at face value; only an unknown one is treated as
 * a possible typo, so "model" never drifts to "mode".
 */
function isKnown(word: string, known: Set<string>): boolean {
    if (known.has(word)) return true;
    if (word.length < 3) return false;
    for (const candidate of known) if (candidate.startsWith(word)) return true;
    return false;
}

/**
 * How well one query word is explained by the entry's vocabulary, 0..1. A
 * word the index knows must match as itself or as the start of a longer
 * word; one it does not know may also be a longer form ("exporting") or a
 * misspelling of a known word.
 */
function wordScore(
    word: string,
    vocabulary: Map<string, number>,
    allowTypo: boolean,
): number {
    let best = 0;
    for (const [known, weight] of vocabulary) {
        let fit = 0;
        if (known === word) fit = 1;
        else if (word.length >= 3 && known.startsWith(word)) fit = 0.85;
        else if (allowTypo && known.length >= 3 && word.startsWith(known))
            fit = 0.7;
        else if (allowTypo && word.length >= 4 && known.length >= 4) {
            const close = similarity(word, known);
            if (close >= 0.6) fit = close * 0.8;
        }
        const score = fit * weight;
        if (score > best) best = score;
    }
    return best;
}

/** Score below which a related match is noise rather than meaning. */
const RELATED_THRESHOLD = 0.5;

/**
 * Searches the entries, exact matches first and related matches after, each
 * group ordered by strength. An empty or stop-word-only query gives nothing.
 */
export function searchSettings(
    query: string,
    entries: readonly SettingsSearchEntry[] = SETTINGS_SEARCH_ENTRIES,
): SettingsSearchResult[] {
    const phrase = normalise(query);
    if (!phrase) return [];
    const words = tokens(query).filter((word) => !STOP_WORDS.has(word));
    if (words.length === 0) return [];
    const stemmedPhrase = words.join(" ");

    const { entries: items, known } = indexed(entries);
    const typoAllowed = words.map((word) => !isKnown(word, known));

    const results: SettingsSearchResult[] = [];
    for (const item of items) {
        // A title hit outranks a tab hit outranks a keyword hit, and a name the
        // query fills more of is a closer one.
        let exact = 0;
        for (const name of item.names) {
            const hit = containsPhrase(name.phrase, phrase)
                ? phrase.length / name.phrase.length
                : containsPhrase(name.stemmed, stemmedPhrase)
                  ? stemmedPhrase.length / name.stemmed.length
                  : 0;
            if (hit > 0) exact = Math.max(exact, name.rank + hit);
        }
        if (exact > 0) {
            results.push({ entry: item.entry, kind: "exact", score: exact });
            continue;
        }

        let total = 0;
        let matched = 0;
        words.forEach((word, i) => {
            const score = wordScore(word, item.vocabulary, typoAllowed[i]);
            if (score > 0) matched += 1;
            total += score;
        });
        if (matched === 0 || matched * 2 < words.length) continue;
        // Half coverage, half strength of what did match, so one unknown word
        // ("gpt-4") does not sink an otherwise clear query.
        const score = (total / words.length + total / matched) / 2;
        if (score < RELATED_THRESHOLD) continue;
        results.push({ entry: item.entry, kind: "related", score });
    }

    return results.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1;
        return b.score - a.score;
    });
}
