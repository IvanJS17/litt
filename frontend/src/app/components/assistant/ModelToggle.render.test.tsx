import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeConfiguredModelOptions, ModelToggle } from "./ModelToggle";
import { routerModelOptions } from "@mike/client";
import type {
    ApiKeyState,
    ConfiguredModelOption,
} from "@/app/lib/mikeApi";

const { configuredModels, workspace } = vi.hoisted(() => ({
    configuredModels: [] as ConfiguredModelOption[],
    // Personal unless a test says otherwise.
    workspace: {
        workspaceId: "personal" as string | null,
        orgApiKeys: null as { allow_personal_api_keys: boolean } | null,
    },
}));

vi.mock("@/app/hooks/useOllamaModels", () => ({
    useOllamaModels: () => [],
}));
vi.mock("@/app/hooks/useConfiguredModels", () => ({
    useConfiguredModels: () => configuredModels,
}));

vi.mock("@/app/contexts/WorkspaceContext", () => ({
    PERSONAL_WORKSPACE: "personal",
    useWorkspace: () => workspace,
}));

beforeEach(() => {
    configuredModels.splice(0);
    workspace.workspaceId = "personal";
    workspace.orgApiKeys = null;
});

it("lets deployment configuration override a duplicate catalog id", () => {
    expect(
        mergeConfiguredModelOptions(
            [{ id: "same", label: "Configured", group: "Configured" }],
            [{ id: "same", label: "Static", group: "OpenAI" }],
        ),
    ).toEqual([{ id: "same", label: "Configured", group: "Configured" }]);
});

function keys(configured: Partial<Record<keyof ApiKeyState, boolean>>) {
    const providers = [
        "claude",
        "gemini",
        "openai",
        "bedrock",
        "azure",
        "openrouter",
        "vercel",
        "opencode-go",
    ] as const;
    return Object.fromEntries(
        providers.map((provider) => [
            provider,
            {
                configured: configured[provider] ?? false,
                source: configured[provider] ? "user" : null,
            },
        ]),
    ) as ApiKeyState;
}

describe("ModelToggle responsive trigger", () => {
    it("offers every supported reasoning level through a discrete slider", async () => {
        const user = userEvent.setup();
        const onReasoningChange = vi.fn();
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
                reasoningLevel="high"
                onReasoningChange={onReasoningChange}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));
        const reasoning = screen.getByRole("slider", {
            name: "Reasoning level",
        });
        expect(reasoning).toHaveAttribute("min", "0");
        expect(reasoning).toHaveAttribute("max", "4");
        expect(reasoning).toHaveValue("3");
        expect(reasoning).toHaveAttribute("aria-valuetext", "High");

        fireEvent.change(reasoning, { target: { value: "4" } });

        expect(onReasoningChange).toHaveBeenLastCalledWith("xhigh");
        expect(
            screen.getByRole("slider", { name: "Reasoning level" }),
        ).toBeInTheDocument();
    });

    it("offers Max for GPT-5.6 without offering Minimal", async () => {
        const onReasoningChange = vi.fn();
        render(
            <ModelToggle
                value="gpt-5.6-terra"
                onChange={vi.fn()}
                apiKeys={keys({ openai: true })}
                reasoningLevel="low"
                onReasoningChange={onReasoningChange}
            />,
        );

        await userEvent.click(
            screen.getByRole("button", { name: "Choose model" }),
        );
        const reasoning = screen.getByRole("slider", {
            name: "Reasoning level",
        });
        expect(reasoning).toHaveAttribute("max", "5");
        expect(reasoning).toHaveValue("1");
        expect(screen.queryByText("Minimal")).not.toBeInTheDocument();

        fireEvent.change(reasoning, { target: { value: "5" } });
        expect(onReasoningChange).toHaveBeenLastCalledWith("max");
    });

    it("uses the provider-supported GPT-5.5 levels", async () => {
        const onReasoningChange = vi.fn();
        render(
            <ModelToggle
                value="gpt-5.5"
                onChange={vi.fn()}
                apiKeys={keys({ openai: true })}
                reasoningLevel="low"
                onReasoningChange={onReasoningChange}
            />,
        );

        await userEvent.click(
            screen.getByRole("button", { name: "Choose model" }),
        );
        const reasoning = screen.getByRole("slider", {
            name: "Reasoning level",
        });
        expect(reasoning).toHaveAttribute("max", "4");
        expect(reasoning).toHaveValue("1");
        expect(screen.queryByText("Minimal")).not.toBeInTheDocument();
    });

    it("reaches and changes reasoning with Radix keyboard navigation", async () => {
        const user = userEvent.setup();
        const onReasoningChange = vi.fn();
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
                reasoningLevel="high"
                onReasoningChange={onReasoningChange}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));
        await user.keyboard("{End}");

        const reasoning = screen.getByRole("slider", {
            name: "Reasoning level",
        });
        expect(reasoning).toHaveFocus();

        await user.keyboard("{ArrowRight}");
        expect(onReasoningChange).toHaveBeenLastCalledWith("xhigh");
    });

    it("names the active model, shortened, in a compact chat input", () => {
        render(
            <ModelToggle
                value="claude-fable-5-2"
                onChange={vi.fn()}
                apiKeys={keys({ claude: true })}
                compact
                compactShowsName
            />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toHaveClass("rounded-lg");
        expect(trigger).not.toHaveClass("w-8");
        expect(trigger).toHaveTextContent("Fable 5.2");
        expect(trigger).not.toHaveTextContent("Claude");
        // The full name is still the trigger's title.
        expect(trigger).toHaveAttribute("title", "Choose model — Claude Fable 5.2");
    });

    it("keeps the icon in a compact host that did not ask for the name (the Word pane)", () => {
        render(<ModelToggle value="gemini-3.8-flash" onChange={vi.fn()} apiKeys={keys({ gemini: true })} compact />);
        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toHaveClass("w-8");
        expect(trigger).not.toHaveTextContent("Gemini");
        expect(trigger.querySelector("svg")).toBeInTheDocument();
    });

    it("shows a chosen model in dark grey, and keeps the light grey for the placeholder", () => {
        const { rerender } = render(
            <ModelToggle value="gemini-3.8-flash" onChange={vi.fn()} apiKeys={keys({ gemini: true })} />,
        );
        expect(screen.getByRole("button", { name: "Choose model" })).toHaveClass("text-gray-700");
        rerender(<ModelToggle value="" onChange={vi.fn()} apiKeys={keys({ gemini: true })} />);
        expect(screen.getByRole("button", { name: "Choose model" })).toHaveClass("text-gray-400");
    });

    it("rings the trigger for the keyboard only, not after a tap", () => {
        render(<ModelToggle value="gemini-3.8-flash" onChange={vi.fn()} apiKeys={keys({ gemini: true })} />);
        expect(screen.getByRole("button", { name: "Choose model" })).toHaveClass("keyboard-focus-ring");
    });

    it("allows a wider model label in the regular trigger", () => {
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        expect(screen.getByText("Gemini 3.8 Flash")).toHaveClass("max-w-[200px]");
    });

    it("does not add an inset shadow to the selected model row", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));

        const selectedRow = screen
            .getAllByText("Gemini 3.8 Flash")
            .find((element) => element.closest('[role="menuitem"]'))
            ?.closest('[role="menuitem"]');
        expect(selectedRow).toHaveClass("theme-dropdown-item", "text-gray-900");
        expect(selectedRow).toHaveClass("rounded-md");
        expect(selectedRow).not.toHaveClass("rounded-xl");
        expect(selectedRow).toHaveAttribute("data-selected", "true");
        expect(selectedRow?.className).not.toContain("shadow-[inset_");
    });

    it("shows a dot on model rows but not provider rows", async () => {
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        await userEvent.click(
            screen.getByRole("button", { name: "Choose model" }),
        );

        const modelRow = screen
            .getAllByText("Gemini 3.8 Flash")
            .find((element) => element.closest('[role="menuitem"]'))
            ?.closest('[role="menuitem"]');
        const providerRow = screen
            .getByText("Google")
            .closest('[role="menuitem"]');

        expect(modelRow?.querySelector("span.rounded-full")).toBeInTheDocument();
        expect(
            providerRow?.querySelector("span.rounded-full"),
        ).not.toBeInTheDocument();
    });
});

describe("ModelToggle availability states", () => {
    it("offers an authenticated deployment-configured model", async () => {
        configuredModels.push({
            id: "local-qwen",
            label: "Local Qwen",
            group: "Configured",
            location: "local",
            source: "Configured",
        });
        render(
            <ModelToggle
                value="local-qwen"
                onChange={vi.fn()}
                apiKeys={keys({})}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Choose model" }),
        ).toHaveTextContent("Local Qwen");
        await userEvent.click(
            screen.getByRole("button", { name: "Choose model" }),
        );
        expect(screen.getByText("Configured")).toBeInTheDocument();
    });

    it("renders a neutral disabled trigger while keys are loading", () => {
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeysLoading
            />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toBeDisabled();
        // The load-time flash: never claim "No API Key" before we know.
        expect(trigger).not.toHaveTextContent("No API Key");
        expect(trigger).toHaveTextContent("Gemini 3.8 Flash");
    });

    it("fails open when key state is unknown after a failed load", () => {
        render(
            <ModelToggle value="gemini-3.8-flash" onChange={vi.fn()} />,
        );

        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toBeEnabled();
        expect(trigger).not.toHaveTextContent("No API Key");
        expect(trigger).toHaveTextContent("Gemini 3.8 Flash");
    });

    it("shows No Models and invokes the API-key warning when no providers are configured", async () => {
        const user = userEvent.setup();
        const onNoModelsClick = vi.fn();
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({})}
                onNoModelsClick={onNoModelsClick}
            />,
        );

        const trigger = screen.getByRole("button", {
            name: "No models available",
        });
        expect(trigger).toBeEnabled();
        expect(trigger).toHaveTextContent("No Models");
        expect(trigger.querySelector("svg")).not.toBeInTheDocument();
        await user.click(trigger);
        expect(onNoModelsClick).toHaveBeenCalledWith("api-keys");
    });

    it("invokes the router warning when a configured router has no saved models", async () => {
        const user = userEvent.setup();
        const onNoModelsClick = vi.fn();
        render(
            <ModelToggle
                value=""
                onChange={vi.fn()}
                apiKeys={keys({ openrouter: true })}
                routerSelections={{ openrouter: [] }}
                onNoModelsClick={onNoModelsClick}
            />,
        );

        await user.click(
            screen.getByRole("button", { name: "No models available" }),
        );
        expect(onNoModelsClick).toHaveBeenCalledWith("router-models");
    });

    it("says the organization has no models added when its router key has none", async () => {
        const user = userEvent.setup();
        const onNoModelsClick = vi.fn();
        workspace.workspaceId = "org-1";
        workspace.orgApiKeys = { allow_personal_api_keys: false };
        const orgKeys = keys({ openrouter: true });
        orgKeys.openrouter = { configured: true, enabled: true, source: "org" };
        render(
            <ModelToggle
                value=""
                onChange={vi.fn()}
                apiKeys={orgKeys}
                routerSelections={{ openrouter: [] }}
                onNoModelsClick={onNoModelsClick}
            />,
        );

        await user.click(
            screen.getByRole("button", { name: "No models available" }),
        );
        expect(onNoModelsClick).toHaveBeenCalledWith("org-router-models");
    });

    it("says the organization has set nothing up when it has no providers", async () => {
        const user = userEvent.setup();
        const onNoModelsClick = vi.fn();
        workspace.workspaceId = "org-1";
        workspace.orgApiKeys = { allow_personal_api_keys: false };
        render(
            <ModelToggle
                value=""
                onChange={vi.fn()}
                apiKeys={keys({})}
                onNoModelsClick={onNoModelsClick}
            />,
        );

        await user.click(
            screen.getByRole("button", { name: "No models available" }),
        );
        expect(onNoModelsClick).toHaveBeenCalledWith("org-api-keys");
    });

    it("filters to configured providers when keys are loaded", () => {
        render(
            <ModelToggle
                value="claude-fable-5-1"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        // Claude has no key: the stored selection is not offered, so the
        // trigger falls back to the picker prompt.
        expect(
            screen.getByRole("button", { name: "Choose model" }),
        ).toHaveTextContent("Select model");
    });
});

describe("ModelToggle with no model chosen yet", () => {
    it("asks for a model without flagging a missing key", () => {
        render(<ModelToggle value="" onChange={vi.fn()} apiKeys={keys({ gemini: true })} />);
        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toHaveTextContent("Select model");
        expect(trigger).not.toHaveAttribute("title", "API key missing for selected model");
    });

    it("still flags a chosen model whose key is missing", () => {
        render(<ModelToggle value="claude-fable-5-1" onChange={vi.fn()} apiKeys={keys({ gemini: true })} compact />);
        expect(screen.getByRole("button", { name: "Choose model" })).toHaveAttribute(
            "title",
            "API key missing for selected model",
        );
    });
});

describe("ModelToggle provider grouping", () => {
    it("groups router rows under the router, not the model's maker", () => {
        expect(
            routerModelOptions("opencode-go", ["glm-5"]).map((m) => m.group),
        ).toEqual(["OpenCode Go"]);
        expect(
            routerModelOptions("openrouter", ["anthropic/claude-fable-5-1"]).map(
                (m) => m.group,
            ),
        ).toEqual(["OpenRouter"]);
    });

    it("offers the user's saved OpenCode Go models once the key is configured", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true, "opencode-go": true })}
                routerSelections={{ "opencode-go": ["glm-5"] }}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));
        await user.click(await screen.findByText("OpenCode Go"));

        expect(await screen.findByText("Glm 5")).toBeInTheDocument();
    });

    it("hides the group when the OpenCode Go key is missing", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
                routerSelections={{ "opencode-go": ["glm-5"] }}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));

        expect(screen.queryByText("OpenCode Go")).not.toBeInTheDocument();
    });

    it("distinguishes direct and routed copies of the same model", async () => {
        const user = userEvent.setup();
        render(
            <ModelToggle
                value="claude-fable-5-1"
                onChange={vi.fn()}
                apiKeys={keys({ claude: true, openrouter: true })}
                routerSelections={{ openrouter: ["anthropic/claude-fable-5-1"] }}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));

        expect(screen.getByText("Anthropic")).toBeInTheDocument();
        expect(screen.getByText("OpenRouter")).toBeInTheDocument();
    });

    it.each([
        { source: "OpenRouter", provider: "openrouter", models: { openrouter: ["openai/gpt-4o"] }, id: "openrouter/openai/gpt-4o" },
        { source: "Azure OpenAI", provider: "azure", models: { azure: ["gpt-4o"] }, id: "azure/gpt-4o" },
        { source: "Amazon Bedrock", provider: "bedrock", models: { bedrock: ["us.anthropic.claude-sonnet-4-6-v1:0"] }, id: "bedrock/us.anthropic.claude-sonnet-4-6-v1:0" },
    ])("identifies $source even without a direct copy of the model", async ({ source, provider, models, id }) => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <ModelToggle
                value={id}
                onChange={onChange}
                apiKeys={keys({ [provider]: true })}
                routerSelections={models}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Choose model" }));
        // The router's group is open and holds the row.
        expect(screen.getByText(source)).toBeInTheDocument();
        await user.click(screen.getAllByRole("menuitem").at(-1)!);
        expect(onChange).toHaveBeenCalledWith(id);
    });
});

describe("ModelToggle tone", () => {
    it("uses the toolbar button colour for the default tone", () => {
        render(
            <ModelToggle
                tone="default"
                value="gemini-3.8-flash"
                onChange={vi.fn()}
                apiKeys={keys({ gemini: true })}
            />,
        );

        expect(screen.getByRole("button", { name: "Choose model" })).toHaveClass(
            "text-gray-700",
        );
    });
});
