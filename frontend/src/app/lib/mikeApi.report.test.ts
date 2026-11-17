import { beforeEach, describe, expect, it, vi } from "vitest";

import { downloadRetainerReport, getReportSentHistory, getRetainerReport, markReportSent } from "./mikeApi";

// The retainer report calls: route, method and body, identifiers encoded, the
// language sent, the Word file read as bytes, and a malformed reply is a
// failure rather than an empty report.

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("./authEvents", () => ({ authenticatedFetch: fetchMock }));

const reply = (body: unknown, status = 200) => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }));
};
const goodReport = {
    locale: "es-MX",
    matter_name: "Iguala",
    period: { days: 90, start: "2026-08-20", end: "2026-11-17", time_zone: "America/Mexico_City" },
    horizon: { start: "2026-11-17", end: "2027-02-15" },
    requests: { total: 0, by_type: [], closed: [], open: [] },
    profile: { confirmed_total: 0, confirmed_in_period: [] },
    radar: { upcoming: [] },
    disclaimer: "Ayuda de planeación.",
    scope_note: "Solo incluye los datos confirmados.",
};
const goodList = { retainer: true, can_write: true, sent: [] };
const goodSent = { id: "s1", period_end: "2026-11-17", period_start: "2026-08-20", period_days: 90, note: null };

beforeEach(() => {
    fetchMock.mockReset();
    reply(goodReport);
});

const M = "/api/projects/p%201/matters/m%201/report";
describe("retainer report API", () => {
    it.each([
        ["report", () => getRetainerReport("p 1", "m 1", 90, "es-MX"), `${M}/90d?locale=es-MX`, "GET", undefined, goodReport],
        ["report in English, 30 days", () => getRetainerReport("p 1", "m 1", 30, "en-US"), `${M}/30d?locale=en-US`, "GET", undefined, goodReport],
        ["history", () => getReportSentHistory("p 1", "m 1"), `${M}/sent`, "GET", undefined, goodList],
        ["mark sent without a note", () => markReportSent("p 1", "m 1", 60), `${M}/60d/sent`, "POST", {}, goodSent],
        ["mark sent with a note", () => markReportSent("p 1", "m 1", 90, { note: "por correo" }), `${M}/90d/sent`, "POST", { note: "por correo" }, goodSent],
    ] as const)("%s", async (_name, call, path, method, body, answer) => {
        reply(answer);
        await call();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(path);
        expect(init.method ?? "GET").toBe(method);
        if (body) expect(JSON.parse(init.body as string)).toEqual(body);
        else expect(init.body).toBeUndefined();
    });

    it("returns what the server answered", async () => {
        reply(goodReport);
        expect(await getRetainerReport("p", "m", 90, "es-MX")).toEqual(goodReport);
        reply(goodList);
        expect(await getReportSentHistory("p", "m")).toEqual(goodList);
        reply(goodSent);
        expect(await markReportSent("p", "m", 90)).toEqual(goodSent);
    });

    it("downloads the Word file with its name", async () => {
        fetchMock.mockImplementation(
            async () =>
                new Response(new Uint8Array([80, 75, 3, 4]), {
                    status: 200,
                    headers: { "content-disposition": 'attachment; filename="reporte-iguala-2026-11-17.docx"' },
                }),
        );
        const file = await downloadRetainerReport("p 1", "m 1", 90, "es-MX");
        expect(fetchMock.mock.calls[0][0]).toBe(`${M}/90d/docx?locale=es-MX`);
        expect(file.filename).toBe("reporte-iguala-2026-11-17.docx");
        expect(file.blob.size).toBe(4);
    });

    it("fails the download when the server refuses", async () => {
        reply({ detail: "no" }, 403);
        await expect(downloadRetainerReport("p", "m", 90, "es-MX")).rejects.toBeTruthy();
    });

    const broken = (key: string, value: unknown) => {
        const copy: Record<string, unknown> = { ...goodReport };
        if (value === undefined) delete copy[key];
        else copy[key] = value;
        return copy;
    };
    it.each([
        [{}], [[]], [null], ["x"],
        [broken("period", undefined)],
        [broken("period", { start: 1, end: "x" })],
        [broken("period", { start: "x", end: 1 })],
        [broken("horizon", null)],
        [broken("requests", undefined)],
        [broken("requests", { by_type: [], closed: [] })],
        [broken("requests", { by_type: {}, closed: [], open: [] })],
        [broken("requests", { by_type: [], closed: null, open: [] })],
        [broken("requests", { by_type: [], closed: [], open: "x" })],
        [broken("profile", undefined)],
        [broken("profile", { confirmed_in_period: {} })],
        [broken("radar", undefined)],
        [broken("radar", { upcoming: {} })],
        [broken("disclaimer", 5)],
        [broken("scope_note", undefined)],
    ])("treats %j as a failed report load", async (body) => {
        reply(body);
        await expect(getRetainerReport("p", "m", 90, "es-MX")).rejects.toThrow("Malformed");
    });

    it.each([[{}], [null], [[]], [{ retainer: "yes", sent: [] }], [{ retainer: true, sent: {} }]])(
        "treats %j as a failed history load",
        async (body) => {
            reply(body);
            await expect(getReportSentHistory("p", "m")).rejects.toThrow("Malformed");
        },
    );

    it.each([[{}], [null], [[]], [{ id: 5, period_end: "x" }], [{ id: "s", period_end: 5 }]])(
        "treats %j as a failed record",
        async (body) => {
            reply(body);
            await expect(markReportSent("p", "m", 90)).rejects.toThrow("Malformed");
        },
    );
});
