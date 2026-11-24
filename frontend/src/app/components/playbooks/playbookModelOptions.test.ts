import { describe, expect, it } from "vitest";
import type { ModelOption } from "@mike/client";
import type {
    ApiKeyState,
    PlaybookConfiguration,
} from "@/app/lib/mikeApi";
import {
    buildPlaybookModelOptions,
    playbookModelCatalog,
} from "./playbookModelOptions";

const catalog: ModelOption[] = [
    {
        id: "openrouter/anthropic/claude-sonnet-4",
        label: "Claude Sonnet 4",
        group: "OpenRouter",
    },
    { id: "ollama/qwen3.6", label: "qwen3.6 (local)", group: "Local" },
    { id: "custom-reviewer", label: "Custom Reviewer", group: "OpenAI" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", group: "Google" },
];

const configuration: PlaybookConfiguration = {
    availableModelIds: ["custom-reviewer"],
    defaultModel: "custom-reviewer",
};

const apiKeys = {
    openrouter: { configured: true, source: "user" },
    gemini: { configured: false, source: null },
} as ApiKeyState;

describe("buildPlaybookModelOptions", () => {
    it("includes server-approved, OpenRouter, and discovered Ollama models", () => {
        expect(
            buildPlaybookModelOptions(catalog, configuration, apiKeys),
        ).toEqual([
            {
                value: "openrouter/anthropic/claude-sonnet-4",
                label: "OpenRouter · Claude Sonnet 4",
            },
            {
                value: "ollama/qwen3.6",
                label: "Local · qwen3.6 (local)",
            },
            {
                value: "custom-reviewer",
                label: "OpenAI · Custom Reviewer",
            },
        ]);
    });
});

describe("playbookModelCatalog", () => {
    // docs/playbooks.md, "Model selection": the compilation and review menus
    // draw on the same catalog as chat. A person with an Anthropic and an
    // OpenRouter key saw only Anthropic models here.
    const keys = {
        claude: { configured: true, source: "user" },
        openrouter: { configured: true, source: "user" },
    } as ApiKeyState;

    it("offers the OpenRouter models the person saved, as the chat does", () => {
        const catalog = playbookModelCatalog({
            routerSelections: { openrouter: ["anthropic/claude-sonnet-4"] },
            ollama: [],
            configured: [],
        });
        const options = buildPlaybookModelOptions(
            catalog,
            { availableModelIds: ["claude-sonnet-5-5"], defaultModel: null },
            keys,
        );
        expect(options.map((option) => option.value)).toEqual(
            expect.arrayContaining([
                "claude-sonnet-5-5",
                "openrouter/anthropic/claude-sonnet-4",
            ]),
        );
        expect(
            options.find(
                (option) => option.value === "openrouter/anthropic/claude-sonnet-4",
            )?.label,
        ).toMatch(/^OpenRouter · /);
    });

    it("offers no router model without its key", () => {
        const catalog = playbookModelCatalog({
            routerSelections: { openrouter: ["anthropic/claude-sonnet-4"] },
            ollama: [],
            configured: [],
        });
        const options = buildPlaybookModelOptions(
            catalog,
            { availableModelIds: [], defaultModel: null },
            { claude: { configured: true, source: "user" } } as ApiKeyState,
        );
        expect(options.map((option) => option.value)).not.toContain(
            "openrouter/anthropic/claude-sonnet-4",
        );
    });

    it("offers the deployment's configured models, as the chat does", () => {
        const catalog = playbookModelCatalog({
            routerSelections: {},
            ollama: [],
            configured: [
                { id: "firm-llm", label: "Firm LLM", group: "Configured", source: "Configured" },
            ],
        });
        const options = buildPlaybookModelOptions(
            catalog,
            { availableModelIds: [], defaultModel: null },
            keys,
            ["firm-llm"],
        );
        expect(options.map((option) => option.value)).toContain("firm-llm");
    });
});
