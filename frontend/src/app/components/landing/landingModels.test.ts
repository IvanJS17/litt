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
