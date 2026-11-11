// The one definition of "this translation keeps the structure of its source":
// the catalog test (packages/i18n/src/catalog.test.ts) and the translation
// script (translate.mjs) both call it, so a message the script accepts is a
// message the test accepts.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The parser is a frontend dependency; resolve it from there like literals.mjs does with typescript.
const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "../../frontend");
const icu = createRequire(join(FRONTEND, "package.json"))("@formatjs/icu-messageformat-parser");
export const { isStructurallySame, parse, TYPE } = icu;

// What isStructurallySame does not look at: for each argument, its number or
// date style or skeleton, its select options, and its plural offset, cases
// and categories. Keyed by argument name so the two messages line up.
function details(elements, out = new Map()) {
    for (const el of elements) {
        switch (el.type) {
            case TYPE.number:
            case TYPE.date:
            case TYPE.time:
                out.set(`{${el.value}}`, { kind: "style", style: JSON.stringify(el.style) });
                break;
            case TYPE.select:
                out.set(`{${el.value}}`, { kind: "select", options: Object.keys(el.options).sort() });
                for (const option of Object.values(el.options)) details(option.value, out);
                break;
            case TYPE.plural: {
                const keys = Object.keys(el.options);
                out.set(`{${el.value}}`, {
                    kind: "plural",
                    type: el.pluralType ?? "cardinal",
                    offset: el.offset,
                    exact: keys.filter((k) => k.startsWith("=")).sort(),
                    categories: keys.filter((k) => !k.startsWith("=")).sort(),
                });
                for (const option of Object.values(el.options)) details(option.value, out);
                break;
            }
            case TYPE.tag:
                details(el.children, out);
                break;
        }
    }
    return out;
}

const categoriesOf = (locale, type) => new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories;

/**
 * Differences isStructurallySame lets through. Plural categories are the one
 * part that may differ, because languages count differently: a translation
 * may only use its own language's categories, must keep `other`, and must
 * keep every category the source uses that its language also has, so a
 * dropped `one` ("1 seleccionados") fails.
 */
export function detailMismatches(en, translated, locale) {
    const want = details(parse(en));
    const got = details(parse(translated));
    const problems = [];
    for (const name of new Set([...want.keys(), ...got.keys()])) {
        const a = want.get(name);
        const b = got.get(name);
        if (!a || !b || a.kind !== b.kind) {
            problems.push(`${name} is ${a?.kind ?? "absent"} in en-US, ${b?.kind ?? "absent"} in ${locale}`);
            continue;
        }
        if (a.kind === "plural" && b.kind === "plural") {
            if (a.type !== b.type || a.offset !== b.offset) problems.push(`${name}: plural type or offset differs`);
            if (a.exact.join() !== b.exact.join()) problems.push(`${name}: =N cases differ`);
            const own = categoriesOf(locale, b.type);
            const foreign = b.categories.filter((c) => !own.includes(c));
            const dropped = a.categories.filter((c) => own.includes(c) && !b.categories.includes(c));
            if (foreign.length) problems.push(`${name}: ${locale} has no plural category ${foreign.join(", ")}`);
            if (dropped.length) problems.push(`${name}: missing plural category ${dropped.join(", ")}`);
            if (!b.categories.includes("other")) problems.push(`${name}: missing plural category other`);
        } else if (JSON.stringify(a) !== JSON.stringify(b)) {
            problems.push(`${name}: ${JSON.stringify(a)} in en-US, ${JSON.stringify(b)} in ${locale}`);
        }
    }
    return problems;
}

/**
 * Every reason `translated` is not a faithful translation of `en` as an ICU
 * message (same arguments, tags, plural and select shape). Empty when it is.
 */
export function structureProblems(en, translated, locale = "es-MX") {
    let parsed;
    try {
        parsed = parse(translated);
    } catch (error) {
        return [`not valid ICU: ${error.message}`];
    }
    const problems = [];
    const result = isStructurallySame(parse(en), parsed);
    if (!result.success) problems.push(result.error?.message ?? "arguments or tags differ");
    return [...problems, ...detailMismatches(en, translated, locale)];
}
