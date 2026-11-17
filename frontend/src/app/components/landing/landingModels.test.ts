import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODELS } from "@mike/client";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import {
    CATALOG_MODEL_IDS,
    LOCAL_MODEL,
    OPENROUTER_MODEL,
    PICKER_ANTHROPIC_IDS,
    PICKER_MODELS,
    PICKER_OPENROUTER_IDS,
    PICKER_SELECTED_ID,
    catalogModelName,
} from "./landingModels";

const REPO = resolve(__dirname, "../../../../..");
const docs = readFileSync(join(REPO, "docs/direct-provider-models.md"), "utf8");

// The page's examples carry model names. The ones with the firm's own key are
// the app's own (packages/client modelCatalog), so a rename there reaches the
// page, and a model that leaves the catalog fails here.
describe("the models the page names", () => {
    it("are in the app's catalog, under the labels the picker shows", () => {
        for (const id of CATALOG_MODEL_IDS) {
            expect(MODELS.some((model) => model.id === id), id).toBe(true);
            expect(catalogModelName(id)).not.toBe(id);
        }
    });

    it("are the ones docs/direct-provider-models.md lists", () => {
        for (const id of CATALOG_MODEL_IDS) {
            const label = catalogModelName(id).replace(/^(Claude|GPT-6\.1|Gemini|Mistral)\s+/, "");
            // The docs write the family once and the models after it, e.g. "Claude Fable 5.2, Fable 5.1, Opus 5.5, Sonnet 5.5".
            const short = label.replace(/\s*\(Preview\)$/, "");
            expect(docs, catalogModelName(id)).toContain(short);
        }
    });

    it("keep GLM-Legal (closed weights) apart from the model the firm installs", () => {
        for (const catalog of [enUS, esMX]) {
            const names = catalog.landing.why.names;
            expect(names[OPENROUTER_MODEL.name]).toBe("GLM-Legal");
            expect(names[OPENROUTER_MODEL.maker]).toBe("Z.ai");
            expect(names[LOCAL_MODEL.name]).not.toMatch(/GLM-Legal/);
        }
    });
});

// The hero's open model menu. Its Anthropic rows are the catalog's. Its
// OpenRouter rows are models a firm configures itself, so they are rightly not
// in docs/direct-provider-models.md; they are checked against the app's own
// naming of a saved selection instead.
describe("the model menu of the hero", () => {
    it("counts four Anthropic models, all in the app's catalog", () => {
        for (const id of PICKER_ANTHROPIC_IDS) {
            expect(MODELS.some((model) => model.id === id), id).toBe(true);
        }
        expect(PICKER_MODELS.filter((model) => model.group === "Anthropic")).toHaveLength(4);
    });

    it("offers two firm-configured OpenRouter models, named as the picker names them", () => {
        const rows = PICKER_MODELS.filter((model) => model.group === "OpenRouter");
        expect(rows.map((model) => model.label)).toEqual(["Deepseek V4.1 Flash 1017", "Glm 5.3 Flashx Legal"]);
        expect(rows.map((model) => model.id)).toEqual(PICKER_OPENROUTER_IDS.map((id) => `openrouter/${id}`));
        for (const row of rows) {
            // Not a built-in direct-provider model: the docs must not list it.
            expect(MODELS.some((model) => model.id === row.id), row.id).toBe(false);
            expect(docs).not.toContain(row.label);
        }
    });

    it("shows the second OpenRouter model as the chosen one", () => {
        expect(PICKER_MODELS.find((model) => model.id === PICKER_SELECTED_ID)?.label).toBe("Glm 5.3 Flashx Legal");
    });
});

