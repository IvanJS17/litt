import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatGuideHint } from "./ChatGuideHint";

// The real getMyTraining against a reply without `memberships` (the synthetic
// e2e specs answer every /api/** with []): the assistant must not hit the
// route error boundary because of a hint.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/app/lib/authEvents", () => ({ authenticatedFetch: fetchMock }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1", email: "abogado@example.test" } }),
}));

beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
});

describe("ChatGuideHint with a malformed training reply", () => {
    it.each([[[]], [{}], [{ memberships: null }]])("does not crash and shows no pupil notice (%j)", async (body) => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
        render(<ChatGuideHint />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        // Treated as a failed read: the lawyer's notice, never the pupil's, and no throw.
        expect(await screen.findByText(/learn what the assistant does/i)).toBeInTheDocument();
        expect(screen.queryByText(/Your stage changes/)).toBeNull();
    });
});
