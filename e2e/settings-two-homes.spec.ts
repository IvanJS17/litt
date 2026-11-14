import fs from "fs";
import path from "path";
import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Settings in two homes («Ajustes» and «Ajustes del despacho»): the groups, the
// line between the homes, the moved addresses and the phone list. Every /api
// call is mocked: no backend, database or account. The same specs write the
// review screenshots when SETTINGS_SHOTS names a directory (es-MX, 1280 and
// 390 px wide), as an owner and as a member.
//
// The phone profile names WebKit; the project runs Chromium, so it is used
// without its browser type.
const { defaultBrowserType: _ignored, ...iPhone14 } = devices["iPhone 14"];
const SHOTS = process.env.SETTINGS_SHOTS;

test.use({ storageState: { cookies: [], origins: [] }, locale: "es-MX" });

type Role = "owner" | "admin" | "member";
interface Scenario {
    role: Role;
    platformAdmin?: boolean;
    /** Work in the firm's space (default) or in the personal one. */
    workspace?: "firm" | "personal";
    textSize?: "normal" | "large" | "xlarge";
    /** The dark theme, as the profile says it. */
    dark?: boolean;
    /** The firm turns off members' own keys for these capabilities. */
    blocked?: { ai?: boolean; web_search?: boolean; scan?: boolean };
}

const FIRM = "org-socium";
const OTHER = "org-demo";
const ME = { owner: "u-owner", admin: "u-admin", member: "u-member" } as const;
const NAMES = { owner: "Lucía Herrera", admin: "Andrés Mora", member: "Mariana Ortiz" } as const;

const SPLIT = [
    { name: "Carátula del instrumento", description: "Portada de un instrumento notarial con número de escritura, volumen y fecha." },
    { name: "Instrumento notarial", description: "Cuerpo de la escritura redactado por el notario." },
    { name: "Acta protocolizada", description: "Acta de asamblea o de hechos que se protocoliza ante notario." },
];

function keyStatus(extra: Record<string, unknown> = {}) {
    return { sources: {}, enabled: {}, settings: {}, ...extra };
}

async function signedIn(page: Page, s: Scenario) {
    page.on("pageerror", (error) => console.log(`PAGEERROR ${page.url()} ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") console.log(`CONSOLE ${page.url()} ${message.text().slice(0, 300)}`); });
    const me = ME[s.role];
    const manages = s.role !== "member";
    const orgs = [
        { id: FIRM, name: "Socium Abogados", created_by: ME.owner, role: s.role, member_count: 5, allow_member_exports: true, allow_member_deletes: false },
        { id: OTHER, name: "Despacho Demo", created_by: "someone", role: "member", member_count: 12, allow_member_exports: true, allow_member_deletes: true },
    ];
    const members = [
        { id: "m1", user_id: ME.owner, role: "owner", email: "lucia@socium.example", display_name: NAMES.owner, created_at: "2026-09-01T12:00:00Z" },
        { id: "m2", user_id: ME.admin, role: "admin", email: "andres@socium.example", display_name: NAMES.admin, created_at: "2026-09-04T12:00:00Z" },
        { id: "m3", user_id: ME.member, role: "member", email: "mariana@socium.example", display_name: NAMES.member, created_at: "2026-10-02T12:00:00Z" },
        { id: "m4", user_id: "u-4", role: "member", email: "jorge@socium.example", display_name: "Jorge Salas", created_at: "2026-10-05T12:00:00Z" },
    ];
    const blocked = { ai: false, web_search: true, scan: false, ...s.blocked };
    const orgKeys = {
        keys: keyStatus({ claude: true, sources: { claude: "org", landingai: "org" }, enabled: { claude: true, landingai: true } }),
        effective: keyStatus({ claude: true }),
        router_models: {},
        effective_router_models: {},
        allow_personal_keys: { ai: !blocked.ai, web_search: !blocked.web_search, scan: !blocked.scan },
        can_manage: manages,
    };
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const p = url.pathname.replace(/^\/api/, "");
        const ok = (json: unknown) => route.fulfill({ json });
        if (p === "/auth/session") return ok({ user: { id: me, email: `${s.role}@socium.example` } });
        if (p === "/user/profile") {
            return ok({
                onboardingComplete: true, displayName: NAMES[s.role], organisation: "Socium Abogados", jurisdiction: "México", practiceSetting: "private_practice",
                professionalTitle: "Partner", practiceAreas: ["Litigation", "Corporate and M&A"], onboardingVersion: 3, passwordSet: true, termsRequired: false,
                messageCreditsUsed: 12, creditsResetDate: "2026-12-01T00:00:00Z", creditsRemaining: 88, tier: "Free",
                titleModel: null, tabularModel: null, memoryCuratorModel: null, subagentModel: null, subagentReasoning: null,
                lastSelectedChatModel: "test-model", lastSelectedReasoningLevel: "medium", mfaOnLogin: false,
                quickActionsVisible: true, responseDetailsVisible: false, darkMode: s.dark === true, projectMemoryDefault: true,
                textSize: s.textSize, apiKeyStatus: keyStatus({ claude: false }), uiLocale: "es-MX",
            });
        }
        if (p === "/platform/me") return ok({ admin: s.platformAdmin === true, can_create_org: true });
        if (p === "/orgs") return ok(orgs);
        if (p === "/orgs/deleted") return ok([]);
        if (p === "/orgs/invitations/mine" || p === "/orgs/invitations") {
            return ok([{ id: "inv-1", org_id: "org-new", org_name: "Ibarra y Asociados", role: "member", status: "pending" }]);
        }
        if (p === `/orgs/${FIRM}`) return ok(orgs[0]);
        if (p === `/orgs/${OTHER}`) return ok(orgs[1]);
        if (p === `/orgs/${FIRM}/api-keys`) return ok(orgKeys);
        if (p === `/orgs/${FIRM}/members`) return ok(members);
        if (p === `/orgs/${FIRM}/invitations`) return ok([]);
        if (p === `/orgs/${FIRM}/profile`) {
            return ok({ profile: { hq_state: "Querétaro", hq_city: "Querétaro", other_states: [], size: "11_50", practice_areas: ["Civil", "Mercantil"], client_type: "corporate" }, can_manage: manages });
        }
        if (p === `/orgs/${FIRM}/managed-accounts`) return ok({ managed_accounts: false, managed_members: 0 });
        if (p === `/orgs/${FIRM}/split-classes`) return ok({ classes: SPLIT, custom: false, defaults: SPLIT, max: 19, can_manage: manages });
        if (p === "/user/split-classes") return ok({ classes: SPLIT, custom: false, defaults: SPLIT, max: 19 });
        if (p === `/orgs/${FIRM}/training/mentors` || p === `/orgs/${FIRM}/training`) {
            return ok({ mentors: [ME.admin], pupils: [{ trainee_user_id: ME.member, mentor_user_id: ME.admin }] });
        }
        if (p === `/orgs/${FIRM}/firm-criteria`) {
            return ok({ criteria: [], playbooks: [], limit: 50, can_write: true });
        }
        if (p === "/training/me") {
            return ok({ memberships: [{ org_id: FIRM, is_mentor: s.role === "admin", mentor_user_id: s.role === "member" ? ME.admin : null, stages: s.role === "member" ? [{ practice: null, stage: "pasante" }] : [] }] });
        }
        if (p === "/training/me/supervision") return ok({ org_id: FIRM, work_reviews: [], defenses: [], urgency_passes: [] });
        if (p === "/training/me/criterion") {
            return ok({
                org_id: FIRM, trainee_user_id: me, map: { topics: [], min_events: 5, window: 20, retake_after_days: 14 },
                calibration: { min_per_level: 5, marked_turns: 0, levels: [] }, hints: { requested: 0, max_level: 0 },
                retakes: [], open_retake_id: null, generation: { available: false, code: "training_review_key_required" },
            });
        }
        if (p === "/training/me/readings") {
            return ok({ org_id: FIRM, eligibility: { is_junior: false, due: false, open_reading_id: null, last_submitted_at: null, next_due_at: null }, generation: { available: false, code: "training_review_key_required" }, readings: [] });
        }
        if (p === "/training/me/gym/attempts") return ok([]);
        if (p === `/orgs/${FIRM}/member-data-policy`) return ok({ allow_member_exports: true, allow_member_deletes: false });
        if (p === "/audit") return ok({ events: [], next_cursor: null, total: 0 });
        if (p === "/audit/actors") return ok([]);
        if (p === "/platform/stats") {
            const usage = { chats: 120, documents: 60, compared: 8, converted: 12, scans: 5, split: 2, tabular: 9, training: 4 };
            return ok({
                generated_at: "2026-11-13T12:00:00Z", legal_version: "2026-11", totals: { users: 31, deleted_users: 2, organizations: 5, awaiting_acceptance: 1 },
                breakdowns: { scope: [], title: [], jurisdiction: [], practice_area: [] },
                usage: { last_7_days: usage, last_30_days: usage }, organizations: [], people: [],
            });
        }
        if (p === "/platform/invitations") return ok([]);
        if (p === "/user/web-search") return ok({ enabled: true, claude: "provider", other: "brave" });
        if (p === "/user/custom-instructions") return ok({ content: "" });
        if (p === "/user/response-style") return ok({ tone: "auto", verbosity: "auto", format: "auto", language: "auto" });
        if (p === "/user/subagent-routes") return ok({ routes: [] });
        if (p === "/models/configured") return ok({ models: [{ id: "test-model", label: "Modelo de prueba", source: "Configured" }] });
        if (p.startsWith("/models/")) return ok({ models: [] });
        if (p === "/projects/filter-options") return ok({ practices: [], owners: [] });
        if (p === "/connectors" || p.startsWith("/connectors/")) return ok([]);
        return ok([]);
    });
    await page.addInitScript(
        ([key, workspace]) => localStorage.setItem(key, workspace),
        [`mike.activeWorkspace.${me}`, s.workspace === "personal" ? "personal" : FIRM],
    );
    if (s.textSize && s.textSize !== "normal") {
        await page.addInitScript((value) => localStorage.setItem("litt:text-size", value), s.textSize);
    }
}

async function shot(page: Page, name: string) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function expectNoHorizontalOverflow(page: Page) {
    const { scroll, inner } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
    }));
    expect(scroll, "page is wider than the screen").toBeLessThanOrEqual(inner);
}

interface PersonalTab { id: string; path: string; ready: string; framed?: boolean }
const PERSONAL_TABS: PersonalTab[] = [
    { id: "cuenta", path: "/settings", ready: "Perfil" },
    { id: "seguridad", path: "/settings/security", ready: "Verificación en dos pasos" },
    { id: "privacidad-y-datos", path: "/settings/privacy-data", ready: "Exportar datos" },
    // A full table page: outside the frame, so no sidebar and no help line.
    { id: "mi-actividad", path: "/settings/my-activity", ready: "Mi actividad", framed: false },
    { id: "personalizacion", path: "/settings/personalisation", ready: "Tu perfil profesional" },
    { id: "memoria", path: "/settings/memory", ready: "Memoria" },
    { id: "apariencia", path: "/settings/appearance", ready: "Tamaño de letra" },
    { id: "asistente", path: "/settings/assistant", ready: "Acciones rápidas" },
    { id: "modelos", path: "/settings/models", ready: "Preferencias de modelos" },
    { id: "mis-llaves-de-ia", path: "/settings/byok", ready: "Mis llaves de IA" },
    { id: "busqueda-web", path: "/settings/web-search", ready: "Activar búsqueda web" },
    { id: "lectura-de-escaneados", path: "/settings/scan-reading", ready: "Lectura de escaneados" },
    { id: "conectores", path: "/settings/connectors", ready: "Conectores" },
    { id: "mi-formacion", path: "/settings/training", ready: "Mi formación" },
    { id: "mis-despachos", path: "/settings/organizations", ready: "Tus despachos" },
];
const PLATFORM_TABS: PersonalTab[] = [
    { id: "invitaciones-beta", path: "/settings/beta-invitations", ready: "Invitaciones a la beta" },
    { id: "estadisticas-beta", path: "/settings/beta-stats", ready: "Estadísticas de la beta" },
];
const FIRM_TABS = [
    { id: "general", path: `/organizations/${FIRM}/settings`, framed: true, roles: ["owner", "admin", "member"] },
    { id: "miembros", path: `/organizations/${FIRM}/settings/members`, framed: false, roles: ["owner", "admin", "member"] },
    { id: "llaves-del-despacho", path: `/organizations/${FIRM}/settings/providers`, framed: true, roles: ["owner", "admin"] },
    { id: "lectura-de-escaneados", path: `/organizations/${FIRM}/settings/scan-reading`, framed: true, roles: ["owner", "admin"] },
    { id: "formacion", path: `/organizations/${FIRM}/settings/training`, framed: true, roles: ["owner", "admin", "member"] },
    { id: "auditoria", path: `/organizations/${FIRM}/settings/audit`, framed: false, roles: ["owner", "admin"] },
    { id: "privacidad-y-datos", path: `/organizations/${FIRM}/settings/privacy-data`, framed: true, roles: ["owner"] },
];

const DEVICES = [
    { name: "escritorio-1280", use: { viewport: { width: 1280, height: 1200 } }, phone: false },
    { name: "telefono-390", use: { ...iPhone14, deviceScaleFactor: 2, viewport: { width: 390, height: 1300 } }, phone: true },
];

for (const device of DEVICES) {
    test.describe(`Ajustes personales en ${device.name}`, () => {
        test.use(device.use);

        for (const role of ["owner", "member"] as const) {
            const who = role === "owner" ? "propietario" : "miembro";
            const scenario: Scenario = { role, platformAdmin: role === "owner" };

            test(`${who}: el menú muestra los grupos del mapa`, async ({ page }) => {
                await signedIn(page, scenario);
                if (device.phone) {
                    await page.goto("/settings/menu");
                    const list = page.locator('[data-slot="settings-phone-list"]');
                    await expect(list).toBeVisible();
                    const headings = await list.getByRole("heading").allTextContents();
                    expect(headings).toEqual([
                        "Mi cuenta",
                        "Mi forma de trabajar",
                        "Mis llaves y servicios",
                        "Mi formación",
                        "Mis despachos",
                        ...(role === "owner" ? ["Administración de la plataforma"] : []),
                    ]);
                    // Every row has the 44 px touch height.
                    for (const link of await list.getByRole("link").all()) {
                        const box = await link.boundingBox();
                        expect(box!.height, await link.innerText()).toBeGreaterThanOrEqual(44);
                    }
                    // The line to the firm's settings is on the list.
                    await expect(page.getByRole("link", { name: "Ajustes del despacho →" })).toBeVisible();
                } else {
                    await page.goto("/settings");
                    const side = page.getByRole("navigation", { name: "Ajustes" });
                    await expect(side.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
                    const headings = await side.getByRole("heading").allTextContents();
                    expect(headings).toEqual([
                        "Mi cuenta",
                        "Mi forma de trabajar",
                        "Mis llaves y servicios",
                        "Mi formación",
                        "Mis despachos",
                        ...(role === "owner" ? ["Administración de la plataforma"] : []),
                    ]);
                    await expect(page.getByText("Estos ajustes son tuyos.")).toBeVisible();
                    await expect(page.getByRole("link", { name: "Ajustes del despacho →" })).toHaveAttribute(
                        "href",
                        `/organizations/${FIRM}/settings`,
                    );
                }
                await expectNoHorizontalOverflow(page);
                await shot(page, `01-ajustes-menu-completo-${who}-${device.name}`);
            });

            for (const tab of [...PERSONAL_TABS, ...(role === "owner" ? PLATFORM_TABS : [])]) {
                test(`${who}: ${tab.id}`, async ({ page }) => {
                    await signedIn(page, scenario);
                    await page.goto(tab.path);
                    await expect(page.getByText(tab.ready).filter({ visible: true }).first()).toBeVisible();
                    // The tab says what it is for, in one or two lines.
                    if (tab.framed !== false) await expect(page.locator('[data-slot="settings-tab-help"]')).toBeVisible();
                    await expectNoHorizontalOverflow(page);
                    await shot(page, `02-ajustes-${tab.id}-${who}-${device.name}`);
                });
            }
        }
    });

    test.describe(`Ajustes del despacho en ${device.name}`, () => {
        test.use(device.use);

        for (const role of ["owner", "admin", "member"] as const) {
            const who = role === "owner" ? "propietario" : role === "admin" ? "administrador" : "miembro";
            for (const tab of FIRM_TABS) {
                const offered = tab.roles.includes(role);
                test(`${who}: ${tab.id}${offered ? "" : " (no se ofrece)"}`, async ({ page }) => {
                    await signedIn(page, { role });
                    await page.goto(tab.path);
                    if (!tab.framed && offered && !device.phone) {
                        // A full table page has no sidebar; its heading names the firm and leads back
                        // (on a phone the header shows only the way back, and the top bar names the firm).
                        await expect(page.getByRole("button", { name: "Ajustes del despacho · Socium Abogados" })).toBeVisible();
                    }
                    if (tab.framed) {
                        // The heading always says which firm.
                        await expect(page.getByRole("heading", { level: 1, name: "Ajustes del despacho · Socium Abogados" })).toBeVisible();
                        await expect(page.getByRole("link", { name: "Ajustes →" })).toHaveAttribute("href", "/settings");
                        const nav = page.getByRole("navigation", { name: "Ajustes del despacho" });
                        const offeredTabs = await nav.getByRole("button").allTextContents();
                        if (offered) await expect(page.locator('[data-slot="settings-tab-help"]')).toBeVisible();
                        // A member is never offered the owners' tabs.
                        if (role === "member") expect(offeredTabs).toEqual(["General", "Miembros", "Formación"]);
                        if (role === "admin") expect(offeredTabs).not.toContain("Privacidad y datos");
                    }
                    await expectNoHorizontalOverflow(page);
                    if (offered || SHOTS) await shot(page, `03-despacho-${tab.id}-${who}-${device.name}`);
                });
            }
        }
    });
}

test.describe("el despacho decide, lo personal enlaza", () => {
    test.use({ viewport: { width: 1280, height: 1000 } });

    test("Llaves del despacho: los tres interruptores van primero y los proveedores se abren", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 1750 });
        await signedIn(page, { role: "owner" });
        await page.goto(`/organizations/${FIRM}/settings/providers`);
        const names = [
            "Los miembros pueden usar sus propias llaves de IA",
            "Los miembros pueden usar sus propias llaves de búsqueda web",
            "Los miembros pueden usar su propia llave de lectura de escaneados (LandingAI)",
        ];
        for (const name of names) await expect(page.getByRole("switch", { name })).toBeVisible();
        // They lead the page: the first heading is theirs, and the switches sit above the saved keys.
        await expect(page.locator("main h2:not([id^='settings-group-'])").first()).toHaveText("Llaves propias de los miembros");
        const switchBox = await page.getByRole("switch", { name: names[0] }).boundingBox();
        const savedBox = await page.getByRole("heading", { name: "Llaves de IA de Socium Abogados" }).boundingBox();
        expect(switchBox!.y).toBeLessThan(savedBox!.y);
        await expect(page.getByText("Los miembros pueden usar sus propias llaves de…")).toBeVisible();
        // The saved keys are in view; the providers to add open with «Agregar proveedor».
        await expect(page.getByRole("switch", { name: "Proveedor Anthropic (Claude)" })).toBeVisible();
        const opener = page.getByRole("button", { name: "Agregar proveedor" });
        await expect(opener).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByRole("button", { name: "Agregar OpenAI" })).toHaveCount(0);
        await shot(page, "04-llaves-del-despacho-cerrado-propietario-escritorio-1280");
        await opener.click();
        await expect(opener).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByRole("button", { name: "Agregar OpenAI" })).toBeVisible();
        // The scan reading key is with the firm's keys; the document types are not.
        await expect(page.getByText("Tipos de documento para separar un expediente")).toHaveCount(0);
        await shot(page, "04-llaves-del-despacho-tres-interruptores-propietario-escritorio-1280");
    });

    test("Lectura de escaneados del despacho: los tipos de documento viven aquí", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto(`/organizations/${FIRM}/settings/scan-reading`);
        await expect(page.getByRole("region", { name: "Tipos de documento para separar un expediente" })).toBeVisible();
    });

    test("en el espacio de un despacho, lo personal no repite la lista: enlaza", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/settings/scan-reading");
        await expect(page.getByRole("region", { name: "Tipos de documento para separar un expediente" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Ajustes del despacho → Lectura de escaneados" })).toHaveAttribute(
            "href",
            `/organizations/${FIRM}/settings/scan-reading`,
        );
        await shot(page, "05-lectura-de-escaneados-personal-enlaza-propietario-escritorio-1280");
    });

    test("en el espacio personal sí está la lista personal", async ({ page }) => {
        await signedIn(page, { role: "owner", workspace: "personal" });
        await page.goto("/settings/scan-reading");
        await expect(page.getByRole("region", { name: "Tipos de documento para separar un expediente" })).toBeVisible();
    });

    test("si el despacho no deja llaves propias, Mis llaves de IA lo dice y enlaza", async ({ page }) => {
        await signedIn(page, { role: "owner", blocked: { ai: true } });
        await page.goto("/settings/byok");
        const row = page.locator('[data-slot="settings-managed-row"]');
        await expect(row.getByText("Lo administra tu despacho.")).toBeVisible();
        await expect(row).toContainText("Trabajas con las llaves de Socium Abogados");
        await expect(page.getByRole("link", { name: "Ajustes del despacho → Llaves del despacho" })).toHaveAttribute(
            "href",
            `/organizations/${FIRM}/settings/providers`,
        );
        await shot(page, "06-mis-llaves-de-ia-bloqueadas-propietario-escritorio-1280");
    });

    test("a un miembro se le dice a quién pedirlo", async ({ page }) => {
        await signedIn(page, { role: "member", blocked: { ai: true } });
        await page.goto("/settings/byok");
        await expect(page.getByText(/Pide a un propietario o administrador que las cambie/)).toBeVisible();
        await expect(page.getByRole("link", { name: /Ajustes del despacho/ })).toHaveCount(1); // only the line above
        await shot(page, "06-mis-llaves-de-ia-bloqueadas-miembro-escritorio-1280");
    });
});

test.describe("direcciones viejas", () => {
    test.use({ viewport: { width: 1280, height: 1000 } });

    test("/settings/features lleva al Asistente", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/settings/features");
        await expect(page).toHaveURL(/\/settings\/assistant$/);
        await expect(page.getByRole("switch", { name: "Acciones rápidas" })).toBeVisible();
    });

    test("/settings/firm-criteria lleva a Formación del despacho", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/settings/firm-criteria");
        await expect(page).toHaveURL(new RegExp(`/organizations/${FIRM}/settings/training`));
    });

    test("/organizations/:id/settings/private-content lleva a Auditoría", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto(`/organizations/${FIRM}/settings/private-content`);
        await expect(page).toHaveURL(new RegExp(`/organizations/${FIRM}/settings/audit$`));
    });
});

test.describe("menú lateral y tamaño de letra", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("el menú de la cuenta tiene «Ajustes del despacho» y la abre", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/projects");
        await page.getByRole("button", { name: /Lucía Herrera|Cuenta|Menú de la cuenta/i }).first().click();
        const entry = page.getByRole("menuitem", { name: "Ajustes del despacho" });
        await expect(entry).toBeVisible();
        await shot(page, "07-menu-lateral-ajustes-del-despacho-propietario-escritorio-1280");
        await entry.click();
        await expect(page).toHaveURL(new RegExp(`/organizations/${FIRM}/settings$`));
    });

    test("Apariencia a 125 % (Muy grande) y el menú de Ajustes", async ({ page }) => {
        await signedIn(page, { role: "owner", platformAdmin: true, textSize: "xlarge" });
        await page.goto("/settings/appearance");
        await expect(page.getByRole("radiogroup", { name: "Tamaño de letra" })).toBeVisible();
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("20px");
        await expectNoHorizontalOverflow(page);
        await shot(page, "08-apariencia-125-propietario-escritorio-1280");
    });
});

test.describe("Apariencia a 125 % en el teléfono", () => {
    test.use({ ...iPhone14, viewport: { width: 390, height: 1500 } });

    test("la lista agrupada sigue sin desbordarse", async ({ page }) => {
        await signedIn(page, { role: "owner", platformAdmin: true, textSize: "xlarge" });
        await page.goto("/settings/menu");
        await expect(page.locator('[data-slot="settings-phone-list"]')).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await shot(page, "08-ajustes-menu-125-propietario-telefono-390");
        await page.goto("/settings/appearance");
        await expect(page.getByRole("radiogroup", { name: "Tamaño de letra" })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await shot(page, "08-apariencia-125-propietario-telefono-390");
    });
});

// The hierarchy of the texts: six signals, less text in view, «Más información»,
// and the fixes the designer found. The legal texts stay whole and in view.
test.describe("jerarquía de textos: señales, menos texto y avisos que no se esconden", () => {
    test.use({ viewport: { width: 1280, height: 1500 } });

    test("Lectura de escaneados personal: opcional, aviso con dos señales y el texto legal completo", async ({ page }) => {
        await signedIn(page, { role: "owner", workspace: "personal" });
        await page.goto("/settings/scan-reading");
        await expect(page.getByRole("heading", { name: "Lectura de escaneados" })).toBeVisible();
        await expect(page.getByText("Opcional", { exact: true })).toBeVisible();
        const notices = page.locator('[data-slot="settings-notice"]');
        // The disclaimer (LandingAI) and the note of the document types, each in its notice.
        await expect(notices.first()).toContainText("Datos a un tercero");
        await expect(notices.first()).toContainText("Con costo");
        await expect(notices.first()).toContainText("LandingAI, en Estados Unidos");
        await expect(notices.first()).toContainText("puedes subir el PDF ya pasado por OCR");
        const types = page.getByRole("region", { name: "Tipos de documento para separar un expediente" });
        await expect(types.locator('[data-slot="settings-notice"]')).toContainText("No escribas datos de clientes aquí");
        // «Más información» is closed and says so.
        const more = page.getByRole("group").filter({ hasText: "Más información" }).first();
        await expect(page.locator("summary", { hasText: "Más información" }).first()).toHaveAttribute("aria-expanded", "false");
        expect(await more.count()).toBeGreaterThan(0);
        await shot(page, "09-lectura-de-escaneados-personal-propietario-escritorio-1280");
    });

    test("Lectura de escaneados del despacho: el aviso de datos a un tercero va antes de los tipos", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto(`/organizations/${FIRM}/settings/scan-reading`);
        const types = page.getByRole("region", { name: "Tipos de documento para separar un expediente" });
        const notice = types.locator('[data-slot="settings-notice"]');
        await expect(notice).toContainText("Datos a un tercero");
        await expect(notice).toContainText("No escribas datos de clientes aquí. Las descripciones y los identificadores también se envían a LandingAI junto con el texto del documento.");
        const noticeBox = await notice.boundingBox();
        const firstField = await types.getByLabel("Nombre").first().boundingBox();
        expect(noticeBox!.y).toBeLessThan(firstField!.y);
        await shot(page, "09-lectura-de-escaneados-despacho-propietario-escritorio-1280");
    });

    test("Lectura de escaneados personal, en el espacio de un despacho: lo administra el despacho (miembro)", async ({ page }) => {
        await signedIn(page, { role: "member" });
        await page.goto("/settings/scan-reading");
        const row = page.locator('[data-slot="settings-managed-row"]');
        await expect(row).toContainText("Lo administra tu despacho");
        await expect(row).toContainText("Pide a un propietario o administrador que lo cambie.");
        await expect(row.getByRole("link")).toHaveCount(0);
        await shot(page, "09-lectura-de-escaneados-personal-miembro-escritorio-1280");
    });

    test("Búsqueda web como miembro: lo administra el despacho y el costo nombra la llave del despacho", async ({ page }) => {
        await signedIn(page, { role: "member" });
        await page.goto("/settings/web-search");
        const row = page.locator('[data-slot="settings-managed-row"]');
        await expect(row).toContainText("Lo administra tu despacho.");
        await expect(row).toContainText("Trabajas con las llaves de Socium Abogados. Pide a un propietario o administrador que las cambie.");
        // The cost is the firm's key, not «tu llave» (the member's own is not the one that pays).
        const cost = page.locator('[data-slot="settings-notice-line"]');
        await expect(cost).toContainText("Se cobra a la llave de API de Claude del despacho.");
        await expect(page.getByText("Se cobra a tu llave de API de Claude")).toHaveCount(0);
        // The sentence under the card is gone.
        await expect(page.getByText("Tu despacho decide estas llaves")).toHaveCount(0);
        await shot(page, "10-busqueda-web-miembro-escritorio-1280");
    });

    test("Búsqueda web en el espacio personal: nada lo administra el despacho (el costo por llave lo cubren las pruebas unitarias)", async ({ page }) => {
        await signedIn(page, { role: "owner", workspace: "personal" });
        await page.goto("/settings/web-search");
        await expect(page.getByText("Activar búsqueda web")).toBeVisible();
        await expect(page.locator('[data-slot="settings-managed-row"]')).toHaveCount(0);
    });

    test("Formación del despacho: etiquetas de quién, menos texto y «no son derecho vigente» a la vista", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto(`/organizations/${FIRM}/settings/training`);
        await expect(page.getByRole("heading", { name: "Mentores y aprendices" })).toBeVisible();
        const tags = page.locator('[data-slot="settings-tags"]').first();
        await expect(tags).toContainText("Mentores: propietarios y administradores");
        await expect(tags).toContainText("Criterios: los lee todo el despacho");
        await expect(page.getByText("No son derecho vigente y LiTT no las verifica.")).toBeVisible();
        // Owner and administrator rows say their role as a tag, not a sentence under each.
        await expect(page.getByText("no pueden ser aprendices")).toBeHidden();
        await expect(page.locator('[data-slot="settings-tag"]').getByText("Propietario", { exact: true })).toBeVisible();
        await expect(page.getByText("dueño")).toHaveCount(0);
        await shot(page, "11-formacion-del-despacho-propietario-escritorio-1280");
    });

    test("Formación del despacho como miembro", async ({ page }) => {
        await signedIn(page, { role: "member" });
        await page.goto(`/organizations/${FIRM}/settings/training`);
        await expect(page.getByRole("heading", { name: "Criterios del despacho" })).toBeVisible();
        await expect(page.getByText("dueño")).toHaveCount(0);
        await shot(page, "11-formacion-del-despacho-miembro-escritorio-1280");
    });

    test("Privacidad y datos como miembro: «Borrar datos» no desaparece, dice quién lo administra", async ({ page }) => {
        await signedIn(page, { role: "member" });
        await page.goto("/settings/privacy-data");
        await expect(page.getByRole("heading", { name: "Exportar datos" })).toBeVisible();
        const del = page.getByRole("heading", { name: "Borrar datos" });
        await expect(del).toBeVisible();
        const row = page.locator('[data-slot="settings-managed-row"]');
        await expect(row).toContainText("Lo administra tu despacho.");
        await expect(row).toContainText("En Socium Abogados, solo los propietarios exportan o borran datos en bloque.");
        await expect(page.getByRole("button", { name: /^Borrar$/ })).toHaveCount(0);
        await shot(page, "12-privacidad-y-datos-miembro-escritorio-1280");
    });

    test("Privacidad y datos en el espacio personal: un aviso fuerte, una vez, y los botones dicen «Borrar»", async ({ page }) => {
        await signedIn(page, { role: "owner", workspace: "personal" });
        await page.goto("/settings/privacy-data");
        const strong = page.locator('[data-tone="irreversible"]');
        await expect(strong).toHaveCount(1);
        await expect(strong).toContainText("No se puede deshacer.");
        await expect(page.getByRole("button", { name: "Eliminar" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Borrar" }).first()).toBeVisible();
        await shot(page, "12-privacidad-y-datos-propietario-escritorio-1280");
    });

    test("Privacidad y datos del despacho: aviso de 30 días y aviso fuerte, una vez", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto(`/organizations/${FIRM}/settings/privacy-data`);
        await expect(page.getByRole("heading", { name: "Borrar datos" })).toBeVisible();
        await expect(page.locator('[data-tone="irreversible"]')).toHaveCount(1);
        await expect(page.locator('[data-tone="note"]')).toContainText("Plazo de 30 días");
        await expect(page.getByText("Solo propietarios", { exact: true })).toBeVisible();
        await shot(page, "12-privacidad-y-datos-despacho-propietario-escritorio-1280");
    });

    test("Cuenta: el plan dice «Gratis» y la zona de peligro no va en rojo", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/settings");
        const plan = page.getByRole("heading", { name: "Plan de uso" }).locator("xpath=ancestor::section[1]");
        await expect(plan).toContainText("Gratis");
        await expect(plan).not.toContainText("Free");
        await expect(page.getByRole("heading", { name: "Zona de peligro" })).toBeVisible();
        await expect(page.locator('[data-tone="irreversible"]')).toHaveCount(1);
    });

    test("Seguridad recomienda la verificación en dos pasos", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/settings/security");
        await expect(page.locator('[data-slot="settings-tag"][data-kind="recommended"]')).toHaveText("Recomendado");
    });
});

test.describe("títulos de grupo: claro, oscuro y teléfono", () => {
    test("escritorio en oscuro: títulos en tinta y con serif", async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 1200 });
        await signedIn(page, { role: "owner", platformAdmin: true, dark: true });
        await page.goto("/settings");
        const title = page.getByRole("navigation", { name: "Ajustes" }).getByRole("heading", { name: "Mi cuenta" });
        await expect(title).toBeVisible();
        const style = await title.evaluate((el) => {
            const css = getComputedStyle(el);
            return { family: css.fontFamily, size: parseFloat(css.fontSize), color: css.color };
        });
        expect(style.family).toMatch(/EB Garamond|garamond|serif/i);
        expect(style.size).toBeGreaterThan(14);
        await shot(page, "01-ajustes-menu-completo-oscuro-propietario-escritorio-1280");
    });

    test.describe("teléfono en oscuro", () => {
        test.use({ ...iPhone14, deviceScaleFactor: 2, viewport: { width: 390, height: 1300 } });

        test("la lista agrupada conserva sus filas de 44 px y sus flechas", async ({ page }) => {
            await signedIn(page, { role: "owner", platformAdmin: true, dark: true });
            await page.goto("/settings/menu");
            const list = page.locator('[data-slot="settings-phone-list"]');
            await expect(list).toBeVisible();
            const links = await list.getByRole("link").all();
            expect(links.length).toBeGreaterThan(10);
            for (const link of links) {
                expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                // The chevron of each row is still there.
                await expect(link.locator("svg")).toHaveCount(1);
            }
            await expectNoHorizontalOverflow(page);
            await shot(page, "01-ajustes-menu-completo-oscuro-propietario-telefono-390");
        });
    });
});

test.describe("menú lateral a 390 px", () => {
    test.use({ ...iPhone14, deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });

    test("la barra lateral abre el menú de la cuenta con «Ajustes del despacho»", async ({ page }) => {
        await signedIn(page, { role: "owner" });
        await page.goto("/assistant");
        await page.getByRole("button", { name: "Abrir barra lateral" }).first().click();
        const dialog = page.getByRole("dialog", { name: "Navegación principal" });
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(400);
        await dialog.getByRole("button", { name: /Lucía Herrera|Cuenta|Menú de la cuenta/i }).first().click();
        await expect(page.getByRole("menuitem", { name: "Ajustes del despacho" })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await shot(page, "07-menu-lateral-ajustes-del-despacho-propietario-telefono-390");
    });
});
