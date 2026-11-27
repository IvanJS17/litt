import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";
import type { createAnonymousMailCap } from "../../lib/anonymousMailCap";

type AnonymousMailCap = ReturnType<typeof createAnonymousMailCap>;

// Invitation-only mode: POST /auth/password-reset asks the auth service for a
// recovery mail only for an address with a finished account or a current
// invitation, and answers every address the same way, at the same time, before
// anything is looked up. The world is the in-memory database with the fake
// identity service (it holds both the identities and the tables); the call to
// the auth service's recovery endpoint is counted at the service function.
const h = vi.hoisted(() => ({
    state: null as null | { db: unknown; tables: Record<string, Row[]>; failNext: (table: string, op: string, error: unknown) => void },
    newCap: null as unknown as () => AnonymousMailCap,
    cap: null as unknown as AnonymousMailCap,
    reported: [] as unknown[][],
    recover: vi.fn(),
}));
vi.mock("../../lib/anonymousMailCap", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../lib/anonymousMailCap")>();
    h.newCap = () => actual.createAnonymousMailCap({ overall: actual.MAIL_OVERALL_DEFAULT });
    h.cap = h.newCap();
    return {
        ...actual,
        anonymousMailCap: {
            admit: (...args: Parameters<AnonymousMailCap["admit"]>) => h.cap.admit(...args),
            size: () => h.cap.size(),
            keys: () => h.cap.keys(),
        },
    };
});
vi.mock("../../lib/supabase", () => ({
    createServerSupabase: vi.fn(() => h.state!.db),
}));
vi.mock("../../lib/observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/observability/report")>()),
    reportError: vi.fn((...args: unknown[]) => {
        h.reported.push(args);
        return "event-1";
    }),
}));
vi.mock("../../lib/authSession", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/authSession")>()),
    createRequestSupabase: vi.fn(() => ({})),
    createCookielessSupabase: vi.fn(() => ({})),
}));
vi.mock("../../modules/auth/auth.service", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../modules/auth/auth.service")>()),
    sendPasswordReset: vi.fn(async (...args: unknown[]) => {
        h.recover(...args);
        return { error: null };
    }),
}));

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";
import { fakeIdentityService } from "../helpers/fakeIdentityService";
import { forgetRecentInvitations } from "../../lib/inviteEmail";

const idp = fakeIdentityService();
const ORIGIN = "http://localhost:3000";
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const LONG_AGO = "2020-01-01T00:00:00.000Z";
const BOSS = "boss@firm.example";
let caller = 0;
let lookupDelayMs = 0;

const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
};
/** The whole answer: status, body, every header (the volatile ones aside) and the cookies by name. */
const whole = (answer: request.Response) => {
    const headers = { ...answer.headers };
    for (const name of ["date", "etag", "x-request-id", "set-cookie"]) delete headers[name];
    const cookies = ((answer.headers["set-cookie"] as unknown as string[] | undefined) ?? []).map((c) => c.replace(/^([^=]*)=[^;]*/, "$1="));
    return { status: answer.status, text: answer.text, headers, cookies };
};
const reset = (email: unknown, client = `198.51.100.${++caller}`) =>
    request(app).post("/auth/password-reset").set("Origin", ORIGIN).set("X-Forwarded-For", client).send({ email });
const resetAndSettle = async (email: string) => {
    const answer = await reset(email);
    await settle();
    return answer;
};
const profile = (email: string, marks: Row) =>
    h.state!.tables.user_profiles.push({ user_id: idp.identities.get(email)!.id, ...marks });

const ADDRESS = "someone@firm.example";
/** A confirmed identity created by an invitation. */
const invitedConfirmed = (email = ADDRESS) => idp.seed(email, { confirmed: true, invitedAt: LONG_AGO });
const platformInvitation = (email: string, expires_at: string) =>
    h.state!.tables.platform_invitations.push({ id: `pi-${email}`, email, status: "pending", expires_at });
const firmInvitation = (email: string, expires_at: string) =>
    h.state!.tables.org_invitations.push({ id: `oi-${email}`, org_id: "firm-1", email, status: "pending", expires_at });

beforeEach(() => {
    const tables: Record<string, Row[]> = {
        org_invitations: [],
        platform_invitations: [],
        organizations: [],
        org_members: [],
        user_profiles: [],
        audit_events: [],
    };
    h.state = memoryDb(tables);
    h.cap = h.newCap();
    h.reported.length = 0;
    h.recover.mockClear();
    idp.reset();
    forgetRecentInvitations();
    lookupDelayMs = 0;
    idp.attachTables(() => tables);
    vi.stubEnv("SUPABASE_URL", "http://identity.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", ` ${BOSS} , other@firm.example`);
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof idp.fetch>) => {
        if (lookupDelayMs) await new Promise((resolve) => setTimeout(resolve, lookupDelayMs));
        return idp.fetch(...args);
    }));
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe("POST /auth/password-reset in invitation-only mode: who gets a recovery mail", () => {
    type Case = [name: string, arrange: () => void];
    const sent: Case[] = [
        ["an administrator's address", () => undefined],
        ["a pending platform invitation (identity not confirmed)", () => {
            idp.seed(ADDRESS);
            platformInvitation(ADDRESS, FUTURE);
        }],
        ["a pending firm invitation", () => firmInvitation(ADDRESS, FUTURE)],
        ["a confirmed identity not created by an invitation", () => idp.seed(ADDRESS, { confirmed: true })],
        ["a confirmed invited identity whose profile has a password set", () => {
            invitedConfirmed();
            profile(ADDRESS, { password_set_at: LONG_AGO });
        }],
        ["a confirmed invited identity whose profile has accepted terms", () => {
            invitedConfirmed();
            profile(ADDRESS, { terms_accepted_at: LONG_AGO });
        }],
        ["a confirmed invited identity whose profile has an onboarding version", () => {
            invitedConfirmed();
            profile(ADDRESS, { onboarding_version: 1 });
        }],
        ["a confirmed invited identity that belongs to a firm", () => {
            invitedConfirmed();
            const id = idp.identities.get(ADDRESS)!.id;
            h.state!.tables.organizations.push({ id: "firm-1", name: "Firm", kind: "team", personal_user_id: null });
            h.state!.tables.org_members.push({ id: "m-firm", org_id: "firm-1", user_id: id, role: "member" });
        }],
        ["a confirmed invited identity removed from every firm that had accepted the terms", () => {
            invitedConfirmed();
            profile(ADDRESS, { terms_accepted_at: LONG_AGO });
        }],
    ];
    const notSent: Case[] = [
        ["no identity and no invitation", () => undefined],
        ["an unconfirmed identity whose only invitation has expired", () => {
            idp.seed(ADDRESS, { invitedAt: LONG_AGO });
            platformInvitation(ADDRESS, PAST);
            firmInvitation(ADDRESS, PAST);
        }],
        ["an unconfirmed identity whose invitation is gone", () => idp.seed(ADDRESS, { invitedAt: LONG_AGO })],
        ["a confirmed invited identity with no finished mark and no invitation", () => {
            invitedConfirmed();
            profile(ADDRESS, { password_set_at: null, terms_accepted_at: null, onboarding_version: null });
        }],
        ["a confirmed invited identity with no finished mark and an expired invitation", () => {
            invitedConfirmed();
            platformInvitation(ADDRESS, PAST);
            firmInvitation(ADDRESS, PAST);
        }],
    ];
    const address = (name: string) => (name === "an administrator's address" ? BOSS.toUpperCase() : ADDRESS);

    it.each(sent)("requests the mail for %s", async (name, arrange) => {
        arrange();
        const answer = await resetAndSettle(address(name));
        expect(answer.status).toBe(204);
        expect(h.recover).toHaveBeenCalledTimes(1);
    });

    it.each(notSent)("requests nothing for %s, and the answer is the same", async (name, arrange) => {
        const reference = whole(await resetAndSettle(BOSS));
        h.recover.mockClear();
        arrange();
        const answer = whole(await resetAndSettle(address(name)));
        expect(h.recover).not.toHaveBeenCalled();
        expect(answer).toEqual(reference);
    });

    it("gives the same whole answer to a sent and a not-sent address", async () => {
        const first = whole(await resetAndSettle(BOSS));
        const second = whole(await resetAndSettle("stranger@firm.example"));
        expect(h.recover).toHaveBeenCalledTimes(1);
        expect(second).toEqual(first);
        expect(first.status).toBe(204);
        expect(first.cookies).toEqual([]);
    });

    it("requests nothing and answers the same when the identity lookup fails", async () => {
        const reference = whole(await resetAndSettle(BOSS));
        h.recover.mockClear();
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
        const answer = whole(await resetAndSettle("lookup-fails@firm.example"));
        expect(h.recover).not.toHaveBeenCalled();
        expect(answer).toEqual(reference);
        expect(h.reported).toHaveLength(1);
        expect(inspect(h.reported, { depth: 8 })).not.toContain("lookup-fails");
        expect(h.reported[0]![1]).toMatchObject({ level: "warning" });
    });

    it.each(["org_invitations", "platform_invitations", "user_profiles", "org_members"])(
        "requests nothing and answers the same when reading %s fails",
        async (table) => {
            const reference = whole(await resetAndSettle(BOSS));
            h.recover.mockClear();
            invitedConfirmed("db-fails@firm.example");
            h.state!.failNext(table, "select", { message: "database unavailable db-fails@firm.example" });
            const answer = whole(await resetAndSettle("db-fails@firm.example"));
            expect(h.recover).not.toHaveBeenCalled();
            expect(answer).toEqual(reference);
            expect(h.reported).toHaveLength(1);
            expect(h.reported[0]![1]).toMatchObject({ level: "warning" });
        },
    );
});

describe("POST /auth/password-reset in invitation-only mode: the answer goes out first", () => {
    const DELAY = 500;
    const timed = async (email: string) => {
        lookupDelayMs = DELAY;
        const started = Date.now();
        const answer = await reset(email);
        return { answer, took: Date.now() - started };
    };

    it("answers a sent address before the identity service is asked, and asks afterwards", async () => {
        idp.seed(ADDRESS, { confirmed: true });
        const { answer, took } = await timed(ADDRESS);
        expect(answer.status).toBe(204);
        expect(took).toBeLessThan(DELAY * 0.8);
        expect(h.recover).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(h.recover).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    });

    it("answers a not-sent address before the identity service is asked, and asks nothing afterwards", async () => {
        idp.seed(ADDRESS, { confirmed: false, invitedAt: LONG_AGO });
        const { answer, took } = await timed(ADDRESS);
        expect(answer.status).toBe(204);
        expect(took).toBeLessThan(DELAY * 0.8);
        await new Promise((resolve) => setTimeout(resolve, DELAY + 300));
        expect(h.recover).not.toHaveBeenCalled();
    });

    it("answers an invitation-holding address before the database is read", async () => {
        firmInvitation(ADDRESS, FUTURE);
        const memory = h.state!.db as { from: (table: string) => unknown };
        const from = memory.from.bind(memory);
        memory.from = (table: string) => {
            const builder = from(table) as { then: (...a: unknown[]) => unknown };
            const then = builder.then.bind(builder);
            builder.then = (resolve: unknown, reject: unknown) =>
                new Promise((done) => setTimeout(done, DELAY)).then(() => then(resolve, reject));
            return builder;
        };
        const started = Date.now();
        const answer = await reset(ADDRESS);
        expect(answer.status).toBe(204);
        expect(Date.now() - started).toBeLessThan(DELAY * 0.8);
        await vi.waitFor(() => expect(h.recover).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    });
});

describe("POST /auth/password-reset in invitation-only mode: the request count is the one it has always been", () => {
    it("counts a turned-down address: after three requests its count is used up", async () => {
        const turnedDown = "turned-down@firm.example";
        for (let i = 0; i < 3; i++) expect((await resetAndSettle(turnedDown)).status).toBe(204);
        expect(h.recover).not.toHaveBeenCalled();
        // The address is invited afterwards: its count is already spent, as for any address.
        firmInvitation(turnedDown, FUTURE);
        const fourth = await resetAndSettle(turnedDown);
        expect(fourth.status).toBe(204);
        expect(h.recover).not.toHaveBeenCalled();
        // Another address is not affected.
        await resetAndSettle(BOSS);
        expect(h.recover).toHaveBeenCalledTimes(1);
    });

    it("counts fifteen turned-down addresses against the instance: the sixteenth is refused", async () => {
        for (let i = 0; i < 15; i++) expect((await resetAndSettle(`nobody-${i}@firm.example`)).status).toBe(204);
        expect(h.recover).not.toHaveBeenCalled();
        const sixteenth = await resetAndSettle(BOSS);
        expect(sixteenth.status).toBe(429);
        expect(h.recover).not.toHaveBeenCalled();
    });
});

describe("POST /auth/password-reset outside invitation-only mode", () => {
    it("reads nothing about the address and requests the mail", async () => {
        vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
        const fetchSpy = vi.mocked(globalThis.fetch);
        const dbFrom = vi.fn(() => {
            throw new Error("the database must not be read");
        });
        (h.state!.db as { from: unknown }).from = dbFrom;
        const answer = await reset("stranger@firm.example");
        expect(answer.status).toBe(204);
        expect(h.recover).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(dbFrom).not.toHaveBeenCalled();
        expect(h.reported).toHaveLength(0);
    });
});
