import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateApiKey, updateApiKeyEnabled, azureEnabled, managed } = vi.hoisted(() => ({
    managed: { value: false },
    updateApiKey: vi.fn(async () => true),
    updateApiKeyEnabled: vi.fn<(provider: string, enabled: boolean) => Promise<boolean>>(),
    azureEnabled: { value: true },
}));

vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
    MfaVerificationPopup: () => null,
    needsMfaVerification: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/app/components/settings/RouterSettingsSection", () => ({
    RouterSettingsSection: ({ provider }: { provider: string }) => <div data-testid="model-selections">{provider}</div>,
}));

const workspace = vi.hoisted(() => ({
    firm: null as null | { id?: string; name: string; role?: string },
    allowPersonal: true,
}));
vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({
        activeOrganization: workspace.firm && { id: "firm-1", role: "admin", ...workspace.firm },
        orgApiKeys: workspace.firm
            ? { allow_personal_keys: { ai: workspace.allowPersonal, web_search: workspace.allowPersonal, scan: workspace.allowPersonal } }
            : null,
    }),
}));

const notConfigured = { configured: false, source: null };

vi.mock("@/app/contexts/UserProfileContext", () => {
    const useUserProfile = () => ({
        profile: {
            personalWorkspaceDisabled: managed.value,
            apiKeys: {
                claude: notConfigured,
                gemini: notConfigured,
                openai: notConfigured,
                mistral: notConfigured,
                openrouter: notConfigured,
                vercel: notConfigured,
                "opencode-go": notConfigured,
                bedrock: notConfigured,
                azure: { configured: azureEnabled.value, enabled: azureEnabled.value, source: "user" },
                "azure-foundry": notConfigured,
                vertex: notConfigured,
                xai: notConfigured,
                custom: notConfigured,
            },
            apiKeySettings: { azure: { endpoint: "contoso-openai" } },
        },
        updateApiKey,
        updateApiKeyEnabled,
    });
    return { useUserProfile };
});

import ByokPage from "./page";

describe("BYOK page cloud-platform keys", () => {
    beforeEach(() => {
        updateApiKey.mockClear();
        workspace.firm = null;
        workspace.allowPersonal = true;
        managed.value = false;
        azureEnabled.value = true;
        updateApiKeyEnabled.mockReset().mockImplementation(async (_provider, enabled) => {
            azureEnabled.value = enabled;
            return true;
        });
    });

    it("saves a Bedrock key with its region", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        await user.click(screen.getByRole("button", { name: "Add Amazon Bedrock" }));
        const bedrockSave = screen.getByRole("button", { name: "Save" });
        expect(bedrockSave.closest("footer")).not.toBeNull();
        expect(bedrockSave).toBeDisabled();

        await user.type(
            screen.getByLabelText("Amazon Bedrock API Key"),
            "bedrock-key",
        );
        await user.type(screen.getByLabelText("AWS region"), "us-east-1");
        await user.click(bedrockSave);

        expect(updateApiKey).toHaveBeenCalledWith("bedrock", "bedrock-key", {
            region: "us-east-1",
        });
    });

    it("toggles a provider with a saved key without opening its modal or removing the key", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        const toggle = screen.getByRole("switch", { name: "Azure OpenAI provider" });
        expect(toggle).toBeChecked();
        expect(screen.queryByRole("switch", { name: "OpenAI provider" })).not.toBeInTheDocument();
        await user.click(toggle);
        expect(updateApiKeyEnabled).toHaveBeenLastCalledWith("azure", false);
        expect(toggle).not.toBeChecked();
        // Switched off, the provider keeps its key and its place under Saved.
        expect(
            within(screen.getByRole("region", { name: "Saved Providers" })).getByRole("button", { name: "Manage Azure OpenAI" }),
        ).toBeVisible();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(updateApiKey).not.toHaveBeenCalled();
        await user.click(toggle);
        expect(updateApiKeyEnabled).toHaveBeenLastCalledWith("azure", true);
        expect(toggle).toBeChecked();
    });

    it("opens the provider from anywhere on its card, and offers the switch in the modal too", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        const card = screen.getByRole("button", { name: "Manage Azure OpenAI" });
        // The card itself is the target, not only its text.
        await user.click(card);
        const dialog = screen.getByRole("dialog", { name: "Azure OpenAI" });
        const modalToggle = within(dialog).getByRole("switch", { name: "Use Azure OpenAI" });
        expect(modalToggle).toBeChecked();
        await user.click(modalToggle);
        expect(updateApiKeyEnabled).toHaveBeenLastCalledWith("azure", false);
        expect(modalToggle).not.toBeChecked();
        expect(dialog).toBeVisible();
        await user.keyboard("{Escape}");

        card.focus();
        await user.keyboard("{Enter}");
        expect(screen.getByRole("dialog", { name: "Azure OpenAI" })).toBeVisible();
        await user.keyboard("{Escape}");

        // A provider without a saved key has no switch, in the card or the modal.
        await user.click(screen.getByRole("button", { name: "Add OpenAI" }));
        expect(
            within(screen.getByRole("dialog", { name: "OpenAI" })).queryByRole("switch"),
        ).not.toBeInTheDocument();
    });

    it("offers an Add button on available providers that opens the provider", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        const available = screen.getByRole("region", { name: "Available Providers" });
        expect(within(available).getAllByRole("button", { name: /^Add / })).toHaveLength(12);
        expect(
            within(screen.getByRole("region", { name: "Saved Providers" })).queryByRole("button", { name: /^Add / }),
        ).not.toBeInTheDocument();
        await user.click(within(available).getByRole("button", { name: "Add xAI" }));
        expect(screen.getByRole("dialog", { name: "xAI" })).toBeVisible();
        expect(screen.getByLabelText("xAI API Key")).toBeVisible();
    });

    it("shows only the provider name on a card, like a connector card", () => {
        render(<ByokPage />);
        expect(screen.queryByText("No personal key")).not.toBeInTheDocument();
        expect(screen.queryByText("Personal key saved")).not.toBeInTheDocument();
    });

    it("retains the provider state and shows a retry message when the toggle fails", async () => {
        updateApiKeyEnabled.mockResolvedValueOnce(false);
        const user = userEvent.setup();
        render(<ByokPage />);
        await user.click(screen.getByRole("switch", { name: "Azure OpenAI provider" }));
        expect(screen.getByRole("switch", { name: "Azure OpenAI provider" })).toBeChecked();
        expect(await screen.findByText("The provider could not be updated. Please try again.")).toBeVisible();
    });

    it("shows the saved Azure endpoint and changes it without a new key", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        await user.click(screen.getByRole("button", { name: "Manage Azure OpenAI" }));
        const endpoint = screen.getByLabelText(
            "Azure OpenAI resource name or endpoint",
        );
        expect(endpoint).toHaveValue("contoso-openai");

        await user.clear(endpoint);
        await user.type(endpoint, "https://contoso.openai.azure.com");
        const azureSave = screen.getByRole("button", { name: "Save" });
        await user.click(azureSave);

        expect(updateApiKey).toHaveBeenCalledWith("azure", null, {
            endpoint: "https://contoso.openai.azure.com",
        });
    });
    it("rejects a Vertex key that is not a service-account file, then saves one with its location", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        await user.click(screen.getByRole("button", { name: "Add Google Vertex AI" }));
        const key = screen.getByLabelText("Google Vertex AI service-account key");
        expect(screen.getByText("Service-account key (JSON)")).toBeVisible();
        await user.type(key, "AIzaSy-not-a-key-file");
        await user.type(screen.getByLabelText("Vertex AI location"), "US-Central1");
        const save = screen.getByRole("button", { name: "Save" });
        await user.click(save);
        expect(
            screen.getByText(/full contents of a Google Cloud service-account key file/),
        ).toBeVisible();
        expect(updateApiKey).not.toHaveBeenCalled();

        const serviceAccount = JSON.stringify({
            type: "service_account",
            project_id: "legal-prod",
            client_email: "mike@legal-prod.iam.gserviceaccount.com",
            private_key: "-----BEGIN PRIVATE KEY-----",
        });
        await user.clear(key);
        await user.click(key);
        await user.paste(serviceAccount);
        await user.click(save);
        expect(updateApiKey).toHaveBeenCalledWith("vertex", serviceAccount, {
            location: "us-central1",
        });
    });

    it("saves a custom endpoint key with its base URL and an xAI key on its own", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        await user.click(
            screen.getByRole("button", { name: "Add OpenAI-compatible endpoint" }),
        );
        await user.type(
            screen.getByLabelText("OpenAI-compatible endpoint API Key"),
            "sk-custom",
        );
        const baseUrl = screen.getByLabelText("Base URL");
        await user.type(baseUrl, "http://localhost:4000/v1");
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(screen.getByText(/public https base URL/)).toBeVisible();
        expect(updateApiKey).not.toHaveBeenCalled();
        await user.clear(baseUrl);
        await user.type(baseUrl, "https://llm.example.com/v1/");
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(updateApiKey).toHaveBeenCalledWith("custom", "sk-custom", {
            baseUrl: "https://llm.example.com/v1",
        });
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("button", { name: "Add xAI" }));
        expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
        await user.type(screen.getByLabelText("xAI API Key"), "xai-key");
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(updateApiKey).toHaveBeenCalledWith("xai", "xai-key", undefined);
        await user.keyboard("{Escape}");

        await user.click(screen.getByRole("button", { name: "Add Azure AI Foundry" }));
        await user.type(screen.getByLabelText("Azure AI Foundry API Key"), "foundry-key");
        await user.type(
            screen.getByLabelText("Azure AI Foundry resource name or endpoint"),
            "contoso-foundry",
        );
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(updateApiKey).toHaveBeenCalledWith("azure-foundry", "foundry-key", {
            endpoint: "https://contoso-foundry.services.ai.azure.com",
        });
    });

    it("lists providers with a saved key as active and the rest as available", () => {
        render(<ByokPage />);
        const active = screen.getByRole("region", { name: "Saved Providers" });
        const available = screen.getByRole("region", { name: "Available Providers" });
        expect(
            within(active).getAllByRole("button", { name: /^Manage / }),
        ).toHaveLength(1);
        expect(
            within(active).getByRole("button", { name: "Manage Azure OpenAI" }),
        ).toBeVisible();
        expect(
            within(available).getAllByRole("button", { name: /^Add / }),
        ).toHaveLength(12);
        expect(
            within(available).queryByRole("button", { name: "Manage Azure OpenAI" }),
        ).not.toBeInTheDocument();
    });

    it("keeps a switched-off provider in the active section", () => {
        azureEnabled.value = false;
        render(<ByokPage />);
        expect(
            within(
                screen.getByRole("region", { name: "Saved Providers" }),
            ).getByRole("button", { name: "Manage Azure OpenAI" }),
        ).toBeVisible();
    });

    it("keeps the modal open when clearing the key fails", async () => {
        updateApiKey.mockResolvedValueOnce(false);
        const user = userEvent.setup();
        render(<ByokPage />);
        await user.click(screen.getByRole("button", { name: "Manage Azure OpenAI" }));
        await user.click(screen.getByRole("button", { name: "Clear" }));
        expect(screen.getByRole("dialog", { name: "Azure OpenAI" })).toBeVisible();
    });

    it("shows provider cards and opens only the selected provider's fields", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        // Only a saved provider's card opens as a whole; the rest open from Add.
        expect(screen.getAllByRole("button", { name: /^Manage / })).toHaveLength(1);
        expect(screen.getAllByRole("button", { name: /^Add / })).toHaveLength(12);
        expect(screen.queryByLabelText("OpenAI API Key")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Add OpenAI" }));
        expect(screen.getByRole("dialog", { name: "OpenAI" })).toBeVisible();
        expect(screen.getByLabelText("OpenAI API Key")).toBeVisible();
        expect(screen.queryByLabelText("Amazon Bedrock API Key")).not.toBeInTheDocument();
        expect(screen.queryByTestId("model-selections")).not.toBeInTheDocument();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows only the configured provider's model selections in its modal", async () => {
        const user = userEvent.setup();
        render(<ByokPage />);
        expect(screen.queryByTestId("model-selections")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Manage Azure OpenAI" }));
        expect(screen.getByTestId("model-selections")).toHaveTextContent("azure");
        const clear = screen.getByRole("button", { name: "Clear" });
        expect(clear.closest("footer")).not.toBeNull();
        await user.click(clear);
        expect(updateApiKey).toHaveBeenCalledWith("azure", null);
        // Clearing the key closes the modal.
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Add Amazon Bedrock" }));
        expect(screen.queryByTestId("model-selections")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    });

    it("names the section and says the keys apply to the personal workspace", () => {
        render(<ByokPage />);
        expect(screen.getByRole("heading", { name: "My AI keys" })).toBeVisible();
        expect(screen.getByText("These keys are yours and apply to your personal workspace.")).toBeVisible();
    });

    it("says the keys also reach the firm in a firm's workspace that allows them", () => {
        workspace.firm = { name: "Socium" };
        render(<ByokPage />);
        expect(screen.getByText(/In Socium they are used only for providers the firm hasn.t set up/)).toBeVisible();
        expect(screen.getByRole("button", { name: "Add OpenAI" })).toBeVisible();
    });

    it("replaces the own-key providers with the reason and a link to the firm's keys in a firm that does not allow them", () => {
        workspace.firm = { name: "Socium" };
        workspace.allowPersonal = false;
        render(<ByokPage />);
        expect(
            screen.getByText("You work with the keys of Socium. Your firm does not allow using your own keys for this."),
        ).toBeVisible();
        // Never a copy of the firm's form: a link to it, in the firm's settings.
        expect(screen.getByRole("link", { name: "Firm settings → Firm keys" })).toHaveAttribute(
            "href",
            "/organizations/firm-1/settings/providers",
        );
        // The restriction is said once, under the title, not repeated as a setting.
        expect(screen.getAllByText(/does not allow using your own keys for this/)).toHaveLength(1);
        expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
        expect(screen.queryByRole("region", { name: "Saved Providers" })).not.toBeInTheDocument();
    });

    it("tells a member who to ask instead of linking to a page they are not offered", () => {
        workspace.firm = { name: "Socium", role: "member" };
        workspace.allowPersonal = false;
        render(<ByokPage />);
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.getByText(/Ask an owner or administrator to change them/)).toBeVisible();
    });
});

describe("BYOK page for a firm-managed account", () => {
    beforeEach(() => {
        workspace.firm = null;
        workspace.allowPersonal = true;
        managed.value = true;
    });

    it("shows no personal keys, says why and points to the firm's keys, never a blank page", () => {
        workspace.firm = { name: "Despacho Demo" };
        const { container } = render(<ByokPage />);
        expect(container).not.toBeEmptyDOMElement();
        expect(screen.getByText(/^You work with the keys of Despacho Demo\./)).toBeVisible();
        expect(screen.getByRole("link", { name: "Firm settings → Firm keys" })).toBeVisible();
        expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
        expect(screen.queryByText("My personal keys")).not.toBeInTheDocument();
    });

    it("says why even before the firm is known", () => {
        const { container } = render(<ByokPage />);
        expect(container).not.toBeEmptyDOMElement();
        expect(screen.getByText(/Your firm does not allow using your own keys for this/)).toBeVisible();
    });
});
