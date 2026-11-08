import { beforeEach, describe, expect, it, vi } from "vitest";

import { getChatBacking, getPupilBacking, markBackingConclusion, MikeApiError } from "./mikeApi";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => fetchMock.mockReset());

describe("accountability API (layer 3, card 8)", () => {
  it("reads a chat's checks, encoding the id", async () => {
    fetchMock.mockResolvedValue(json({ checks: [{ id: "k1" }] }));
    await expect(getChatBacking("chat/1")).resolves.toEqual([{ id: "k1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/training/me/chats/chat%2F1/backing");
  });

  it("treats the uniform 404 as no checks, and rethrows any other failure", async () => {
    fetchMock.mockResolvedValue(json({}, 404));
    await expect(getChatBacking("c1")).resolves.toEqual([]);
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(getChatBacking("c1")).rejects.toBeInstanceOf(MikeApiError);
  });

  it("marks one conclusion with a JSON body", async () => {
    fetchMock.mockResolvedValue(json({ id: "k1" }));
    await markBackingConclusion("c 1", "k/1", "c2", { person_verified: true, person_note: "porque sí" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/training/me/chats/c%201/backing/k%2F1/conclusions/c2");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ person_verified: true, person_note: "porque sí" });
  });

  it("reads what a pupil's mentor sees", async () => {
    fetchMock.mockResolvedValue(json({ works: [] }));
    await getPupilBacking("o 1", "u1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orgs/o%201/training/pupils/u1/backing");
    expect(fetchMock.mock.calls[0][1].method ?? "GET").toBe("GET");
  });
});
