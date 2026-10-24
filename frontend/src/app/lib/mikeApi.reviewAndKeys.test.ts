import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createApprovedReviewReport,
    getChatCredentialOptions,
    getHumanReviewState,
} from "./mikeApi";

const fetchMock = vi.fn();

const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe("getChatCredentialOptions", () => {
    it("scopes the lookup to the project when one is given", async () => {
        await getChatCredentialOptions({
            model: "gpt-x",
            projectId: "p1",
            orgId: "o1",
        });
        expect(lastCall()[0]).toBe(
            "/api/user/chat-credentials?model=gpt-x&project_id=p1",
        );
    });

    it("falls back to the organization, then to the model alone", async () => {
        await getChatCredentialOptions({ model: "gpt-x", orgId: "o1" });
        expect(lastCall()[0]).toBe(
            "/api/user/chat-credentials?model=gpt-x&org_id=o1",
        );
        await getChatCredentialOptions({ model: "gpt-x" });
        expect(lastCall()[0]).toBe("/api/user/chat-credentials?model=gpt-x");
    });
});

describe("human review requests", () => {
    it("reads the review state with encoded path segments", async () => {
        await getHumanReviewState("project/id", "execution?id");
        const [url, init] = lastCall();
        expect(url).toBe(
            "/api/projects/project%2Fid/ai-executions/execution%3Fid/review",
        );
        expect(init.method).toBeUndefined();
    });

    it("posts the expected revision and idempotency key for the approved report", async () => {
        await createApprovedReviewReport("p1", "e1", 4, "key-1");
        const [url, init] = lastCall();
        expect(url).toBe(
            "/api/projects/p1/ai-executions/e1/review/approved-report",
        );
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({
            expected_review_revision: 4,
            idempotency_key: "key-1",
        });
    });
});
