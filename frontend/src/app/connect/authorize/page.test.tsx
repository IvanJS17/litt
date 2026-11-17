import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectAuthorizePage from "./page";
import { MikeApiError, type McpConsentRequest } from "@/app/lib/mikeApi";

const h = vi.hoisted(() => ({
    auth: { user: { id: "user-1" } as { id: string } | null, authLoading: false },
    router: { replace: vi.fn() },
    params: new URLSearchParams("request=req-1"),
    getMcpConsentRequest: vi.fn(),
    decideMcpConsent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => h.router,
    useSearchParams: () => h.params,
}));
vi.mock("@/app/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getMcpConsentRequest: h.getMcpConsentRequest,
    decideMcpConsent: h.decideMcpConsent,
}));
vi.mock("@/app/components/auth/AuthPageShell", () => ({
    AuthPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const consent: McpConsentRequest = {
    client: {
        id: "litt_dcr_x",
        name: "Claude",
        kind: "dcr",
        uri: null,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        redirect_host: "claude.ai",
        loopback_only: false,
    },
    scopes: ["litt.read", "litt.chat"],
    workspaces: [
        { id: "personal", name: null, kind: "personal" },
        { id: "org-1", name: "Firm A", kind: "organization" },
    ],
    default_workspace: "personal",
};

const assign = vi.fn();
beforeEach(() => {
    vi.clearAllMocks();
    h.auth = { user: { id: "user-1" }, authLoading: false };
    h.params = new URLSearchParams("request=req-1");
    h.getMcpConsentRequest.mockResolvedValue(consent);
    Object.defineProperty(window, "location", { value: { assign, search: "" }, writable: true });
});

describe("ConnectAuthorizePage", () => {
    it("shows the app, where it returns to, and only the default workspace selected", async () => {
        render(<ConnectAuthorizePage />);
        expect(await screen.findByRole("heading", { name: "Connect Claude to LiTT" })).toBeTruthy();
        expect(screen.getByText(/claude\.ai/)).toBeTruthy();
        expect((screen.getByLabelText("Personal") as HTMLInputElement).checked).toBe(true);
        expect((screen.getByLabelText("Firm A") as HTMLInputElement).checked).toBe(false);
        expect(screen.queryByText(/runs on your own computer/)).toBeNull();
    });

    it("warns when the app runs on the person's own machine", async () => {
        h.getMcpConsentRequest.mockResolvedValue({ ...consent, client: { ...consent.client, loopback_only: true } });
        render(<ConnectAuthorizePage />);
        expect(await screen.findByText(/runs on your own computer/)).toBeTruthy();
    });

    it("approves with the chosen workspaces and permissions, then returns to the app", async () => {
        h.decideMcpConsent.mockResolvedValue({ redirect_url: "https://claude.ai/api/mcp/auth_callback?code=c&iss=i" });
        render(<ConnectAuthorizePage />);
        await userEvent.click(await screen.findByLabelText("Firm A"));
        await userEvent.click(screen.getByLabelText("Use the LiTT assistant for you."));
        await userEvent.click(screen.getByRole("button", { name: "Allow" }));
        await waitFor(() =>
            expect(h.decideMcpConsent).toHaveBeenCalledWith("req-1", {
                decision: "approve",
                workspaces: ["personal", "org-1"],
                scopes: ["litt.read"],
                default_workspace: "personal",
            }),
        );
        expect(assign).toHaveBeenCalledWith("https://claude.ai/api/mcp/auth_callback?code=c&iss=i");
    });

    it("cannot allow with nothing selected", async () => {
        render(<ConnectAuthorizePage />);
        await userEvent.click(await screen.findByLabelText("Personal"));
        expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("denies and returns the refusal to the app", async () => {
        h.decideMcpConsent.mockResolvedValue({ redirect_url: "https://claude.ai/cb?error=access_denied" });
        render(<ConnectAuthorizePage />);
        await userEvent.click(await screen.findByRole("button", { name: "Deny" }));
        await waitFor(() => expect(h.decideMcpConsent).toHaveBeenCalledWith("req-1", { decision: "deny" }));
        expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied");
    });

    it("sends a signed-out visitor to sign in and back here", async () => {
        h.auth = { user: null, authLoading: false };
        render(<ConnectAuthorizePage />);
        await waitFor(() =>
            expect(h.router.replace).toHaveBeenCalledWith(
                `/login?next=${encodeURIComponent("/connect/authorize?request=req-1")}`,
            ),
        );
        expect(h.getMcpConsentRequest).not.toHaveBeenCalled();
    });

    it("sends a person with MFA to verify, then back here", async () => {
        h.getMcpConsentRequest.mockRejectedValue(
            new MikeApiError({ message: "MFA", status: 403, code: "mfa_verification_required" }),
        );
        render(<ConnectAuthorizePage />);
        await waitFor(() =>
            expect(h.router.replace).toHaveBeenCalledWith(
                `/verify-mfa?next=${encodeURIComponent("/connect/authorize?request=req-1")}`,
            ),
        );
    });

    it("says so when the request expired", async () => {
        h.getMcpConsentRequest.mockRejectedValue(
            new MikeApiError({ message: "expired", status: 404, code: "mcp_request_expired" }),
        );
        render(<ConnectAuthorizePage />);
        expect(await screen.findByText(/connection request has expired/)).toBeTruthy();
    });

    it("says so when there is no request in the address", async () => {
        h.params = new URLSearchParams("");
        render(<ConnectAuthorizePage />);
        expect(await screen.findByText(/connection request has expired/)).toBeTruthy();
        expect(h.getMcpConsentRequest).not.toHaveBeenCalled();
    });
});
