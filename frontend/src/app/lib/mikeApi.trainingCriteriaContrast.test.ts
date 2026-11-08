import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMyCriteriaContrasts, getPupilCriteriaContrasts, MikeApiError, runCriteriaContrastTurn } from "./mikeApi";

// The criteria contrast's client calls (training layer 3): route, method and
// body of each, and how the stream of a contrast turn is read.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const stream = (...frames: string[]) =>
    new Response(frames.map((frame) => `data: ${frame}\n\n`).join(""), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ contrasts: [] }), { status: 200 }));
});

describe("training criteria contrast API", () => {
    it.each([
        ["the person's list", () => getMyCriteriaContrasts(), "/api/training/me/criteria-contrasts"],
        ["the person's list of one organization", () => getMyCriteriaContrasts("o 1"), "/api/training/me/criteria-contrasts?org_id=o+1"],
        ["the mentor's list", () => getPupilCriteriaContrasts("o 1", "u/1"), "/api/orgs/o%201/training/pupils/u%2F1/criteria-contrasts"],
    ] as const)("%s", async (_name, call, url) => {
        await call();
        const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(calledUrl).toBe(url);
        expect(init.method ?? "GET").toBe("GET");
    });
});

describe("runCriteriaContrastTurn", () => {
    const sent = () => JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);

    it("starts a contrast in a new chat of the organization, with the two routes", async () => {
        fetchMock.mockResolvedValue(stream('{"type":"content","text":"Hola"}', "[DONE]"));
        const result = await runCriteriaContrastTurn({
            text: "El caso",
            orgId: "org-1",
            mode: "criteria_contrast",
            routes: ["rapida", "profunda"],
        });
        expect(result).toEqual({ failure: null });
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("/api/chat");
        expect(init.method).toBe("POST");
        expect(sent()).toMatchObject({
            messages: [{ role: "user", content: "El caso" }],
            org_id: "org-1",
            training_mode: "criteria_contrast",
            criteria_routes: ["rapida", "profunda"],
        });
        expect(sent()).not.toHaveProperty("chat_id");
        expect(sent()).not.toHaveProperty("criteria_explanation");
    });

    it("starts one with no routes when the person has fewer than two", async () => {
        fetchMock.mockResolvedValue(stream("[DONE]"));
        await runCriteriaContrastTurn({ text: "El caso", orgId: "org-1", mode: "criteria_contrast" });
        expect(sent()).not.toHaveProperty("criteria_routes");
    });

    it("sends the explanation in the same conversation, as the message and as the explanation", async () => {
        fetchMock.mockResolvedValue(stream("[DONE]"));
        await runCriteriaContrastTurn({ text: "Mi explicación", chatId: "chat-1", mode: "criteria_explain" });
        expect(sent()).toMatchObject({
            messages: [{ role: "user", content: "Mi explicación" }],
            chat_id: "chat-1",
            training_mode: "criteria_explain",
            criteria_explanation: "Mi explicación",
        });
        expect(sent()).not.toHaveProperty("org_id");
        expect(sent()).not.toHaveProperty("criteria_routes");
    });

    it("returns what the server said when the stream carries an error it wrote for the person", async () => {
        fetchMock.mockResolvedValue(
            stream("not json", "{broken", '{"type":"error","message":"Select a model before sending a message.","safe_to_display":true}'),
        );
        expect(await runCriteriaContrastTurn({ text: "x", orgId: "o", mode: "criteria_contrast" })).toEqual({
            failure: "Select a model before sending a message.",
        });
    });

    it("returns an empty reason for an error the server did not write for the person", async () => {
        fetchMock.mockResolvedValue(stream('{"type":"error","message":"internal detail"}'));
        expect(await runCriteriaContrastTurn({ text: "x", orgId: "o", mode: "criteria_contrast" })).toEqual({ failure: "" });
    });

    it("throws the server's refusal, with its code, when the turn is not allowed", async () => {
        fetchMock.mockImplementation(
            async () => new Response(JSON.stringify({ code: "training_mode_not_allowed", detail: "No." }), { status: 400 }),
        );
        await expect(runCriteriaContrastTurn({ text: "x", orgId: "o", mode: "criteria_contrast" })).rejects.toMatchObject({
            status: 400,
            code: "training_mode_not_allowed",
        });
        await expect(runCriteriaContrastTurn({ text: "x", orgId: "o", mode: "criteria_contrast" })).rejects.toBeInstanceOf(MikeApiError);
    });
});
