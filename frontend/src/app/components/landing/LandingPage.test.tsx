import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { LandingPage } from "./LandingPage";
import { INTRO_SESSION_KEY } from "./AssistantSpecimen";
import { ACCESS_FORM_URL, accessFormHref, HERO_CTA_ID } from "./landingConstants";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh, push: vi.fn(), back: vi.fn() }),
}));
const setLocale = vi.fn<(locale: string) => Promise<boolean>>(async () => true);
vi.mock("@/app/lib/localeActions", () => ({ setLocale: (locale: string) => setLocale(locale) }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));

function inSpanish(ui: React.ReactElement) {
    return render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            {ui}
        </IntlClientProvider>,
    );
}

function mediaQueries(reduce: boolean) {
    vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
            matches: reduce && query.includes("reduce"),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })),
    );
}

beforeEach(() => {
    // A visit already seen in this session: the steps are all there, nothing plays.
    window.sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    window.localStorage.clear();
    document.documentElement.className = "";
    refresh.mockClear();
    setLocale.mockClear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("the public start page without a session", () => {
    it("names LiTT and links the privacy notice and the terms, in the HTML", () => {
        const { container } = render(<LandingPage signedIn={false} />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "The legal assistant that works the matter with you.",
        );
        expect(container.querySelector('a[href="/privacidad"]')).toHaveTextContent("Privacy notice");
        expect(container.querySelector('a[href="/terminos"]')).toHaveTextContent("Terms and conditions");
        expect(container.querySelector('a[href^="mailto:soporte@asteroitt.com"]')).not.toBeNull();
        expect(container.textContent).toMatch(/LiTT is an AI legal assistant/);
    });

    it("has the four main buttons on /login and none on /assistant", () => {
        const { container } = render(<LandingPage signedIn={false} />);
        const login = container.querySelectorAll('a[href="/login"]');
        expect(login).toHaveLength(4); // header, phone menu (closed, in the DOM), hero, QUINTO
        login.forEach((a) => expect(a).toHaveTextContent("Sign in"));
        expect(container.querySelector('a[href="/assistant"]')).toBeNull();
        expect(screen.queryByText("Open LiTT")).toBeNull();
    });

    it("asks for access in the questionnaire, saying where the visitor came from and in which language", () => {
        render(<LandingPage signedIn={false} />);
        const requests = screen.getAllByRole("link", { name: "Request access" });
        expect(requests.length).toBeGreaterThan(0);
        requests.forEach((a) => {
            expect(a).toHaveAttribute("href", "https://tally.so/r/2jAeGL?origen=acceso&lang=en-US");
            expect(a).toHaveAttribute("rel", "noopener noreferrer");
        });
        // The address lives in one constant: no other link to the form is hand-written.
        expect(accessFormHref("formacion", "es-MX")).toBe(`${ACCESS_FORM_URL}?origen=formacion&lang=es-MX`);
    });

    it("sends the in-house waitlist and each coming-soon card to the questionnaire with their origin", () => {
        render(<LandingPage signedIn={false} />);
        const soon = screen.getByRole("region", { name: "What we’re working on." });
        expect(within(soon).getByRole("link", { name: "Join the waitlist" })).toHaveAttribute(
            "href",
            "https://tally.so/r/2jAeGL?origen=inhouse&lang=en-US",
        );
        const interested = within(soon).getAllByRole("link", { name: /^I’m interested/ });
        expect(interested.map((a) => new URL(a.getAttribute("href")!).searchParams.get("origen"))).toEqual([
            "soon-contextlex",
            "soon-conectores",
        ]);
        interested.forEach((a) => expect(a.textContent).toMatch(/^I’m interested: .+/));
    });

    it("puts Training second, with its three steps, the gym in «Everything training includes» and its own form origin", () => {
        render(<LandingPage signedIn={false} />);
        const band = document.getElementById("formacion")!;
        expect(band).toHaveClass("landing-band");
        expect(within(band).getByRole("heading", { level: 2, name: /^Your interns and juniors use AI too/ })).toBeInTheDocument();
        expect(
            within(band)
                .getAllByRole("heading", { level: 3 })
                .slice(0, 3)
                .map((h) => h.textContent),
        ).toEqual(["Try first", "LiTT answers and compares", "The mentor reviews and decides"]);
        expect(within(band).getByText("Everything training includes")).toBeInTheDocument();
        expect(within(band).getByRole("heading", { level: 4, name: "Gym of fictitious cases" })).toBeInTheDocument();
        expect(within(band).getByRole("link", { name: "I’m interested for my firm" })).toHaveAttribute(
            "href",
            "https://tally.so/r/2jAeGL?origen=formacion&lang=en-US",
        );
        // Training comes right after the hero and before the features.
        const order = [...document.querySelectorAll("main > section")].map((el) => el.id);
        expect(order.indexOf("formacion")).toBe(1);
    });

    it("no longer calls Donna or LiTT from Claude «coming soon»: they are features, and the page says «Claude or ChatGPT»", () => {
        render(<LandingPage signedIn={false} />);
        const soon = document.getElementById("proximamente")!;
        expect(soon).not.toHaveClass("landing-band");
        expect(soon.textContent).not.toMatch(/Donna|Claude|MCP/);
        const features = document.getElementById("funciones")!;
        expect(within(features).getByRole("heading", { level: 4, name: "Donna, for retainer clients" })).toBeInTheDocument();
        expect(within(features).getByRole("heading", { level: 4, name: "LiTT from Claude or ChatGPT" })).toBeInTheDocument();
        expect(within(features).queryByText("Coming soon", { selector: ".sr-only" })).toBeNull();
        expect(document.body.textContent).not.toMatch(/Claude or another compatible app|another AI/);
    });

    it("says what the in-house track is without promising it depends on demand", () => {
        render(<LandingPage signedIn={false} />);
        const soon = document.getElementById("proximamente")!;
        expect(within(soon).getByText(/^For legal teams inside companies: register and prioritize internal requests/).textContent).toBe(
            "For legal teams inside companies: register and prioritize internal requests and keep the business informed with follow-up.",
        );
        expect(soon.textContent).not.toMatch(/demand/i);
        inSpanish(<LandingPage signedIn={false} />);
        expect(screen.getByText("Para los equipos legales dentro de una empresa: registra y prioriza las solicitudes internas y da seguimiento al negocio.")).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/cuando haya demanda/);
    });

    it("never names a competitor or says what other firms do in the training texts", () => {
        render(<LandingPage signedIn={false} />);
        expect(document.getElementById("formacion")!.textContent).not.toMatch(/Harvey|Legora|CoCounsel|Lexis|Westlaw|other firms|other firms do/i);
    });

    it("keeps the support address as a plain contact link in the footer", () => {
        render(<LandingPage signedIn={false} />);
        const footer = screen.getByRole("contentinfo");
        expect(within(footer).getByRole("link", { name: /support/i })).toHaveAttribute(
            "href",
            "mailto:soporte@asteroitt.com",
        );
    });

    it("says which connectors are only planned, without promising what is not there", () => {
        render(<LandingPage signedIn={false} />);
        const soon = screen.getByRole("region", { name: "What we’re working on." });
        expect(soon.textContent).not.toMatch(/Harness/);
        expect(
            within(soon).getByText("* Google is in preparation; Microsoft 365 and Dropbox are in design."),
        ).toBeInTheDocument();
        expect(soon.textContent).not.toMatch(/\bhours?\b/i);
    });

    it("is organized in landmarks, one h1 and one h2 per section", () => {
        render(<LandingPage signedIn={false} />);
        expect(screen.getByRole("banner")).toBeInTheDocument();
        expect(screen.getByRole("main")).toHaveAttribute("id", "main");
        expect(screen.getByRole("contentinfo")).toBeInTheDocument();
        expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
        expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    });

    it("orders the sections: training first, the features, why LiTT, coming soon, trust, access", () => {
        render(<LandingPage signedIn={false} />);
        const sections = [...document.querySelectorAll("main > section[id]")].map((el) => el.id);
        expect(sections).toEqual(["formacion", "funciones", "por-que", "proximamente", "confianza", "acceso"]);
        const features = within(document.getElementById("funciones")!).getAllByRole("heading", { level: 3 });
        expect(features.map((h) => h.textContent)).toEqual([
            "Assistant",
            "Projects",
            "Tabular review",
            "Workflows and playbooks",
            "Also, for the client and from your AI.",
        ]);
    });

    it("lists the seven things built for Mexican practice and the three that are coming", () => {
        render(<LandingPage signedIn={false} />);
        const index = screen.getByRole("list", { name: "Built for Mexican practice." });
        expect(within(index).getAllByRole("listitem")).toHaveLength(7);
        const soon = screen.getByRole("region", { name: "What we’re working on." });
        expect(within(soon).getAllByText("Coming soon", { selector: ".sr-only" })).toHaveLength(3);
        expect(within(soon).getByText("Article 2398")).toBeInTheDocument();
    });

    it("keeps the quoted contract and law in Spanish, marked as such", () => {
        render(<LandingPage signedIn={false} />);
        const quote = document.querySelector("#landing-source blockquote");
        expect(quote).toHaveAttribute("lang", "es");
        expect(quote?.textContent).toMatch(/^«Septiembre 2026/);
        const [law] = screen.getAllByText(/^«Hay arrendamiento/);
        expect(law).toHaveAttribute("lang", "es");
    });

    it("does not name the upstream project as a brand, and credits it by link", () => {
        const { container } = render(<LandingPage signedIn={false} />);
        expect(container.textContent).not.toMatch(/MikeOSS/i);
        const credits = screen
            .getAllByRole("link", { name: /^source code$/ })
            .filter((a) => a.getAttribute("href")?.endsWith("#attribution"));
        expect(credits).toHaveLength(1);
        expect(screen.getByRole("link", { name: "GNU AGPL-3.0" })).toHaveAttribute(
            "href",
            "https://www.gnu.org/licenses/agpl-3.0.html",
        );
    });
});

describe("the public start page with a session", () => {
    it("opens the app from the four main buttons", () => {
        const { container } = render(<LandingPage signedIn />);
        const open = container.querySelectorAll('a[href="/assistant"]');
        expect(open).toHaveLength(4);
        open.forEach((a) => expect(a).toHaveTextContent("Open LiTT"));
        expect(container.querySelector('a[href="/login"]')).toBeNull();
        // The same page: the legal links and the request are still there.
        expect(container.querySelector('a[href="/privacidad"]')).not.toBeNull();
        expect(screen.getAllByRole("link", { name: "Request access" }).length).toBeGreaterThan(0);
    });
});

describe("the public start page in Mexican Spanish", () => {
    it("says «Iniciar sesión» and links the legal texts with their Spanish names", () => {
        inSpanish(<LandingPage signedIn={false} />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
            "El asistente jurídico que trabaja el asunto contigo.",
        );
        // The phone menu's buttons are in the DOM but hidden: a reader does not meet them.
        expect(screen.getAllByRole("link", { name: "Iniciar sesión" })).toHaveLength(3);
        expect(screen.getByRole("link", { name: "Aviso de privacidad" })).toHaveAttribute("href", "/privacidad");
        expect(screen.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
        expect(screen.getByRole("link", { name: "Saltar al contenido" })).toBeInTheDocument();
    });

    it("says «Abrir LiTT» with a session", () => {
        inSpanish(<LandingPage signedIn />);
        expect(screen.getAllByRole("link", { name: "Abrir LiTT" })).toHaveLength(3);
    });

    it("opens the questionnaire in Spanish and shows Donna and Claude or ChatGPT as features", () => {
        inSpanish(<LandingPage signedIn={false} />);
        const [request] = screen.getAllByRole("link", { name: "Solicitar acceso" });
        expect(request).toHaveAttribute("href", "https://tally.so/r/2jAeGL?origen=acceso&lang=es-MX");
        expect(screen.getByRole("link", { name: "Únete a la lista de espera" })).toHaveAttribute(
            "href",
            "https://tally.so/r/2jAeGL?origen=inhouse&lang=es-MX",
        );
        expect(screen.getByRole("heading", { name: "Donna, para los clientes con iguala" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "LiTT desde Claude o ChatGPT" })).toBeInTheDocument();
        expect(screen.getByText("Tres novedades en camino.", { exact: false })).toBeInTheDocument();
    });

    it("has the same keys in both catalogs for the page", () => {
        const keys = (tree: unknown, prefix = ""): string[] =>
            Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
                typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
            );
        expect(keys(esMX.landing).sort()).toEqual(keys(enUS.landing).sort());
    });
});

describe("the header's button", () => {
    function headerButton() {
        return screen.getByRole("banner").querySelector<HTMLAnchorElement>("a[data-docked]")!;
    }

    it("docks: hidden and inert while the hero's buttons are in view, shown when they leave", () => {
        let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                constructor(callback: typeof notify) {
                    notify = callback;
                }
                observe() {}
                disconnect() {}
            },
        );
        render(<LandingPage signedIn={false} />);
        expect(document.getElementById(HERO_CTA_ID)).not.toBeNull();
        expect(headerButton()).toHaveAttribute("inert");
        expect(headerButton().className).toMatch(/opacity-0/);

        act(() => notify([{ isIntersecting: false }]));
        expect(headerButton()).not.toHaveAttribute("inert");
        expect(headerButton().className).not.toMatch(/opacity-0/);

        act(() => notify([{ isIntersecting: true }]));
        expect(headerButton()).toHaveAttribute("inert");
    });

    it("gets its rule once the page has moved", () => {
        render(<LandingPage signedIn={false} />);
        const header = screen.getByRole("banner");
        expect(header).toHaveAttribute("data-scrolled", "false");
        act(() => {
            Object.defineProperty(window, "scrollY", { value: 40, configurable: true });
            window.dispatchEvent(new Event("scroll"));
        });
        expect(header).toHaveAttribute("data-scrolled", "true");
        Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    });
});

describe("the hero's example: the assistant at work", () => {
    function pill(n: number) {
        return screen.getByRole("button", { name: `Citation ${n}` });
    }

    it("shows the question, the four steps, the answer with three citations and the new document", () => {
        render(<LandingPage signedIn={false} />);
        expect(screen.getByText(/^Review the lease and the account statement/)).toBeInTheDocument();
        expect(screen.getByText("Finished in 4 steps")).toBeInTheDocument();
        const steps = document.querySelectorAll("figure ol > li");
        expect([...steps].map((li) => li.textContent)).toEqual([
            "Read Lease — Tlalnepantla Warehouse.pdf",
            "Read Account statement — October 2026.pdf",
            "Used the “Payment demand” workflow",
            "Drafted Demand letter.docx",
        ]);
        expect(screen.getByText(/^The tenant owes the September and October rent/)).toHaveTextContent(
            "default interest of 3% per month",
        );
        expect(screen.getAllByRole("button", { name: /^Citation \d$/ })).toHaveLength(3);
        expect(screen.getAllByText("Demand letter.docx").length).toBeGreaterThan(0);
        expect(screen.getByText("2 pages · new in the project")).toBeInTheDocument();
    });

    it("draws the composer with the app's open model menu, hidden from a reader and inert", () => {
        render(<LandingPage signedIn={false} />);
        const composer = document.querySelector<HTMLElement>("[data-landing-composer]")!;
        expect(composer).toHaveAttribute("aria-hidden", "true");
        expect(composer).toHaveAttribute("inert");
        // It follows the source in the DOM, so a phone keeps the source near the citation you tap.
        expect(document.getElementById("landing-source")!.compareDocumentPosition(composer)).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
        // The menu: Anthropic collapsed with its count, OpenRouter open with the firm's two models.
        const menu = within(composer);
        expect(menu.getByText("Anthropic").closest("[aria-expanded]")).toHaveAttribute("aria-expanded", "false");
        expect(menu.getByText("OpenRouter").closest("[aria-expanded]")).toHaveAttribute("aria-expanded", "true");
        expect(menu.getByText("Deepseek V4.1 Flash 1017")).toBeInTheDocument();
        expect(menu.queryByText("Claude Sonnet 5.5")).toBeNull();
        expect(composer.querySelector('[data-selected="true"]')).toHaveTextContent("Glm 5.3 Flashx Legal");
        // The reasoning ladder: High, three steps of four, from None to Very high.
        expect(menu.getByText("Reasoning")).toBeInTheDocument();
        expect(menu.getAllByText("High").length).toBeGreaterThan(0);
        expect(composer.querySelectorAll('.litt-ladder-step[data-on="true"]')).toHaveLength(3);
        expect(composer.querySelectorAll(".litt-ladder-step")).toHaveLength(4);
        // The chips under it: the model with its thumbnail, and the firm's key.
        expect(composer.querySelector("[data-litt-ladder-mini]")).not.toBeNull();
        expect(composer).toHaveTextContent("Firm key");
    });

    it("starts on the first source, verified", () => {
        render(<LandingPage signedIn={false} />);
        expect(pill(1)).toHaveAttribute("aria-pressed", "true");
        expect(pill(2)).toHaveAttribute("aria-pressed", "false");
        expect(pill(3)).toHaveAttribute("aria-pressed", "false");
        const source = document.getElementById("landing-source")!;
        expect(source).toHaveAttribute("aria-live", "polite");
        expect(source).toHaveTextContent("p. 2");
        expect(source).toHaveTextContent("Account statement — October 2026.pdf");
        expect(source).toHaveTextContent("Citation verified: the text appears on page 2.");
    });

    it("shows the other sources on click, on focus and on a mouse hover, not on a touch", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(pill(3));
        expect(pill(3)).toHaveAttribute("aria-pressed", "true");
        expect(pill(1)).toHaveAttribute("aria-pressed", "false");
        const source = document.getElementById("landing-source")!;
        expect(source).toHaveTextContent("p. 9");
        expect(source).toHaveTextContent("Clause Fifteen · Lease — Tlalnepantla Warehouse.pdf");
        expect(source).toHaveTextContent("Citation verified: the text appears on page 9.");

        act(() => pill(2).focus());
        expect(pill(2)).toHaveAttribute("aria-pressed", "true");
        expect(source).toHaveTextContent("p. 7");
        expect(source).toHaveTextContent("Clause Twelve");

        fireEvent.pointerEnter(pill(1), { pointerType: "touch" });
        expect(pill(2)).toHaveAttribute("aria-pressed", "true");
        fireEvent.pointerEnter(pill(1), { pointerType: "mouse" });
        expect(pill(1)).toHaveAttribute("aria-pressed", "true");
        // The source it is already showing does not change.
        fireEvent.pointerEnter(pill(1), { pointerType: "mouse" });
        expect(pill(1)).toHaveAttribute("aria-pressed", "true");
    });

    it("brings the steps in one after another once per browser session", () => {
        vi.useFakeTimers();
        mediaQueries(false);
        window.sessionStorage.clear();
        const first = render(<LandingPage signedIn={false} />);
        const items = () => [...document.querySelectorAll<HTMLElement>("[data-intro]")];
        expect(window.sessionStorage.getItem(INTRO_SESSION_KEY)).toBe("1");
        // Heading of the steps, four steps, answer, document: seven things, six turns.
        expect(items()).toHaveLength(7);
        expect(items().every((el) => el.dataset.intro === "out")).toBe(true);
        act(() => {
            vi.advanceTimersByTime(250);
        });
        // The steps' heading comes with the first step.
        expect(items().filter((el) => el.dataset.intro === "in").length).toBe(2);
        act(() => {
            vi.advanceTimersByTime(260);
        });
        expect(items().filter((el) => el.dataset.intro === "in").length).toBe(3);
        act(() => {
            vi.advanceTimersByTime(260 * 6 + 400);
        });
        // Done: nothing is marked any more, everything is in place.
        expect(items()).toHaveLength(0);
        first.unmount();

        // Same session, again: it is all there, nothing plays.
        render(<LandingPage signedIn={false} />);
        expect(document.querySelectorAll("[data-intro]")).toHaveLength(0);
    });

    it("leaves no timer behind when the page goes away in the middle of the intro", () => {
        vi.useFakeTimers();
        mediaQueries(false);
        window.sessionStorage.clear();
        const { unmount } = render(<LandingPage signedIn={false} />);
        act(() => {
            vi.advanceTimersByTime(250 + 260);
        });
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        unmount();
        // A timer firing after the page is gone would set state on nothing (in
        // CI: after the test environment itself was gone).
        expect(vi.getTimerCount()).toBe(0);
    });

    it("still plays the whole intro under React's development double mount", () => {
        vi.useFakeTimers();
        mediaQueries(false);
        window.sessionStorage.clear();
        render(
            <StrictMode>
                <LandingPage signedIn={false} />
            </StrictMode>,
        );
        const items = () => [...document.querySelectorAll<HTMLElement>("[data-intro]")];
        expect(items()).toHaveLength(7);
        act(() => {
            vi.advanceTimersByTime(250);
        });
        expect(items().filter((el) => el.dataset.intro === "in").length).toBe(2);
        act(() => {
            vi.advanceTimersByTime(260 * 6 + 400);
        });
        expect(items()).toHaveLength(0);
    });

    it("does not animate with reduced motion: everything is in place from the start", () => {
        mediaQueries(true);
        window.sessionStorage.clear();
        render(<LandingPage signedIn={false} />);
        expect(document.querySelectorAll("[data-intro]")).toHaveLength(0);
        expect(window.sessionStorage.getItem(INTRO_SESSION_KEY)).toBeNull();
    });

    it("shows the finished page when storage is blocked", () => {
        mediaQueries(false);
        window.sessionStorage.clear();
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        render(<LandingPage signedIn={false} />);
        expect(document.querySelectorAll("[data-intro]")).toHaveLength(0);
        expect(document.getElementById("landing-source")).toHaveTextContent("Citation verified");
        vi.restoreAllMocks();
    });
});

describe("the tabular review example", () => {
    it("names the table and counts its contracts", () => {
        render(<LandingPage signedIn={false} />);
        expect(screen.getByText("Leases 2026")).toBeInTheDocument();
        expect(screen.getByText("4 of 186 contracts")).toBeInTheDocument();
    });

    it("starts on the term of the first row, which a phone shows without scrolling, and shows its source", () => {
        render(<LandingPage signedIn={false} />);
        const source = document.getElementById("landing-tab-source")!;
        expect(source).toHaveAttribute("aria-live", "polite");
        expect(source).toHaveTextContent("Bodega Tlalnepantla.pdf · page 3");
        expect(source).toHaveTextContent("«El presente contrato tendrá una vigencia de 36 (treinta y seis) meses…»");
        expect(screen.getByRole("button", { name: /36 months/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("changes the source with a click and with a mouse hover", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("button", { name: /Mexico City/ }));
        const source = document.getElementById("landing-tab-source")!;
        expect(source).toHaveTextContent("Local Polanco.pdf · page 10");
        fireEvent.pointerEnter(screen.getByRole("button", { name: /60 months/ }), { pointerType: "touch" });
        expect(source).toHaveTextContent("Local Polanco.pdf · page 10");
        fireEvent.pointerEnter(screen.getByRole("button", { name: /60 months/ }), { pointerType: "mouse" });
        expect(source).toHaveTextContent("Nave Querétaro.pdf · page 4");
    });

    it("has one cell with nothing to cite and it is not a button", () => {
        render(<LandingPage signedIn={false} />);
        expect(screen.queryByRole("button", { name: /None agreed/ })).toBeNull();
        expect(screen.getByText("None agreed")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Citation \d+: / }).length).toBe(11);
    });

    it("scrolls sideways inside a named, focusable region", () => {
        render(<LandingPage signedIn={false} />);
        const region = screen.getByRole("region", { name: "Tabular review example" });
        expect(region).toHaveAttribute("tabindex", "0");
        expect(region.className).toMatch(/overflow-x-auto/);
        expect(region.className).toMatch(/overscroll-x-contain/);
    });
});

describe("the Word add-in example", () => {
    it("shows the suggested change and its comment, and hides the comment on demand", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        const change = screen.getByRole("button", { name: /Suggested change: shows or hides/ });
        const comment = document.getElementById("landing-word-comment")!;
        expect(change).toHaveAttribute("aria-expanded", "true");
        expect(change).toHaveAttribute("aria-controls", "landing-word-comment");
        expect(comment).toBeVisible();
        expect(comment).toHaveTextContent("LiTT");
        await user.click(change);
        expect(change).toHaveAttribute("aria-expanded", "false");
        expect(comment).not.toBeVisible();
    });
});

describe("theme and language", () => {
    it("switches theme from the header icon, with one preference on the device", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
        expect(document.documentElement).toHaveClass("dark");
        expect(window.localStorage.getItem("litt:theme")).toBe("dark");
        expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Switch to light theme" }));
        expect(document.documentElement).not.toHaveClass("dark");
        expect(window.localStorage.getItem("litt:theme")).toBe("light");
    });

    it("has no theme group in the footer; the phone menu keeps the only one", () => {
        render(<LandingPage signedIn={false} />);
        const footer = document.querySelector("footer")!;
        expect(within(footer).queryByRole("radiogroup", { name: "Theme" })).toBeNull();
        expect(within(footer).getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
        expect(document.querySelectorAll("[role=radiogroup][aria-label=Theme]")).toHaveLength(1);
    });

    it("moves between the three themes with the arrow keys, in the phone menu", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("button", { name: "Menu" }));
        within(document.getElementById("landing-menu")!).getByRole("radio", { name: "Automatic" }).focus();
        await user.keyboard("{ArrowLeft}");
        expect(window.localStorage.getItem("litt:theme")).toBe("dark");
    });

    it("changes the language through the same action as the sign-in screens", async () => {
        const user = userEvent.setup();
        inSpanish(<LandingPage signedIn={false} />);
        const group = screen.getByRole("radiogroup", { name: "Idioma" });
        expect(within(group).getByRole("radio", { name: "Español" })).toHaveAttribute("aria-checked", "true");
        await user.click(within(group).getByRole("radio", { name: "English" }));
        expect(setLocale).toHaveBeenCalledWith("en-US");
        await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it("does nothing when the language chosen is the one already in use", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("radio", { name: "English" }));
        expect(setLocale).not.toHaveBeenCalled();
    });

    it("moves between the languages with the arrow keys", async () => {
        const user = userEvent.setup();
        inSpanish(<LandingPage signedIn={false} />);
        within(screen.getByRole("radiogroup", { name: "Idioma" })).getByRole("radio", { name: "Español" }).focus();
        await user.keyboard("{ArrowRight}");
        expect(setLocale).toHaveBeenCalledWith("en-US");
        await user.keyboard("{ArrowLeft}");
        await user.keyboard("{Tab}");
    });

    it("keeps the language as it was when it cannot be saved", async () => {
        const user = userEvent.setup();
        setLocale.mockResolvedValueOnce(false);
        inSpanish(<LandingPage signedIn={false} />);
        const group = screen.getByRole("radiogroup", { name: "Idioma" });
        await user.click(within(group).getByRole("radio", { name: "English" }));
        await vi.waitFor(() =>
            expect(within(group).getByRole("radio", { name: "Español" })).toHaveAttribute("aria-checked", "true"),
        );
        expect(refresh).not.toHaveBeenCalled();
        setLocale.mockRejectedValueOnce(new Error("offline"));
        await user.click(within(group).getByRole("radio", { name: "English" }));
        await vi.waitFor(() =>
            expect(within(group).getByRole("radio", { name: "Español" })).toHaveAttribute("aria-checked", "true"),
        );
    });
});

describe("why LiTT: keys, models and your own servers", () => {
    function column(name: string) {
        return screen.getByRole("article", { name });
    }

    it("has the three columns, with the claim about price in the keys one and no price anywhere", () => {
        render(<LandingPage signedIn={false} />);
        const why = within(document.getElementById("por-que")!);
        expect(why.getByRole("heading", { level: 2 })).toHaveTextContent(
            "The legal AI of large firms, within reach of yours.",
        );
        expect(column("Bring your own keys")).toHaveTextContent(
            "You pay the provider only for what you use, with no per-seat price.",
        );
        expect(column("Bring your own keys")).toHaveTextContent("If a key fails, LiTT tells you instead of using another.");
        expect(column("Install it on your servers")).toHaveTextContent("AGPL-3.0");
        // No price or plan is promised anywhere on the page.
        const text = document.body.textContent ?? "";
        expect(text).not.toMatch(/\bUS?\$|\bMXN\b|\bUSD\b|free plan|gratis|\/\s?(mo|month|mes)\b/i);
        // No other platform is named.
        expect(text).not.toMatch(/harvey|legora|mikeoss/i);
    });

    it("puts GLM-Legal under OpenRouter and only the open model on the firm's own server", () => {
        render(<LandingPage signedIn={false} />);
        const picker = within(screen.getByRole("img", { name: /^Example model picker/ }));
        const rows = [...document.querySelectorAll('[aria-label^="Example model picker"] li')].map((li) =>
            (li.textContent ?? "").replace(/\s+/g, " ").trim(),
        );
        expect(rows).toEqual([
            "With your key",
            "Claude Sonnet 5.5",
            "GPT-6.1 Sol",
            "Gemini 3.1 Pro (Preview)",
            "Mistral Large 4 (Preview)",
            "Through OpenRouter",
            "GLM-LegalZ.ai",
            "On the firm’s server",
            "Qwen 3Local",
        ]);
        expect(picker).toBeDefined();
        // Closed weights: GLM-Legal is never offered as installable.
        const local = rows.slice(rows.indexOf("On the firm’s server"));
        expect(local.join(" ")).not.toMatch(/GLM-Legal/);
    });

    it("describes the keys and the firm network as images and hides their pieces from a reader", () => {
        render(<LandingPage signedIn={false} />);
        for (const name of [/^Example: Anthropic, OpenAI and OpenRouter keys saved/, /^Diagram: LiTT, the database and the model/]) {
            const image = screen.getByRole("img", { name });
            expect(image.firstElementChild).toHaveAttribute("aria-hidden", "true");
        }
        expect(screen.getByText("Nothing leaves the network.")).toBeInTheDocument();
    });

    it("has the projects and workflows examples as described images", () => {
        render(<LandingPage signedIn={false} />);
        expect(screen.getByRole("img", { name: /^Example: the Tlalnepantla Warehouse project with six documents/ })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: /^Example: five of the firm’s workflows and playbooks/ })).toBeInTheDocument();
    });

    it("links the repository from the access section, in another tab", () => {
        render(<LandingPage signedIn={false} />);
        const access = within(document.getElementById("acceso")!);
        const link = access.getByRole("link", { name: "GitHub" });
        expect(link).toHaveAttribute("href", "https://github.com/IvanJS17/litt");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    });

    it("keeps three points of trust", () => {
        render(<LandingPage signedIn={false} />);
        const items = within(document.getElementById("confianza")!).getAllByRole("listitem");
        expect(items.map((li) => li.querySelector("h3")?.textContent)).toEqual([
            "Each firm kept apart",
            "No third-party telemetry",
            "A record that can’t be rewritten",
        ]);
    });
});

describe("an old link to #que-hace", () => {
    it("is changed to #funciones and goes there", () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        window.history.replaceState(null, "", "/#que-hace");
        render(<LandingPage signedIn={false} />);
        expect(window.location.hash).toBe("#funciones");
        expect(scrollIntoView).toHaveBeenCalled();
        window.history.replaceState(null, "", "/");
    });
});

describe("the phone menu", () => {
    const wide: { listener: ((event: { matches: boolean }) => void) | null } = { listener: null };
    const scrollIntoView = vi.fn();

    function phone() {
        wide.listener = null;
        vi.stubGlobal(
            "matchMedia",
            vi.fn((query: string) => ({
                matches: false,
                media: query,
                addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
                    if (query.includes("min-width: 880px")) wide.listener = listener;
                },
                removeEventListener: vi.fn(),
            })),
        );
    }

    beforeEach(() => {
        phone();
        Element.prototype.scrollIntoView = scrollIntoView;
        scrollIntoView.mockClear();
        window.history.replaceState(null, "", "/");
    });

    function button() {
        return screen.getByRole("button", { name: "Menu" });
    }
    function panel() {
        return document.getElementById("landing-menu")!;
    }
    function banner() {
        return screen.getByRole("banner");
    }

    it("is not in the server's HTML as a button, but its panel is, closed, with its content", () => {
        const html = renderToString(
            <IntlClientProvider locale="en-US" messages={enUS}>
                <LandingPage signedIn={false} />
            </IntlClientProvider>,
        );
        expect(html).not.toContain("landing-menu-button");
        expect(html).toMatch(/<div id="landing-menu" hidden=""/);
        expect(html).toMatch(/href="#por-que"[^>]*class="landing-menu-link/);
        expect(html).toContain("Privacy notice");
    });

    it("has a button named Menu that controls the panel, closed", () => {
        render(<LandingPage signedIn={false} />);
        expect(button()).toHaveAttribute("aria-expanded", "false");
        expect(button()).toHaveAttribute("aria-controls", "landing-menu");
        expect(button()).toHaveAttribute("type", "button");
        expect(button().className).toMatch(/min-\[880px\]:hidden/);
        expect(button().className).toMatch(/size-11/); // 44 px
        expect(panel()).toHaveAttribute("hidden");
        // The content stays in the DOM while it is closed.
        expect(within(panel()).getAllByRole("link", { hidden: true }).length).toBeGreaterThanOrEqual(8);
    });

    it("opens: expanded, the first link focused, the page behind inert and the scroll locked", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        expect(button()).toHaveAttribute("aria-expanded", "true");
        expect(panel()).not.toHaveAttribute("hidden");
        expect(within(panel()).getByRole("link", { name: "Training" })).toHaveFocus();
        expect(document.documentElement).toHaveClass("menu-open");
        expect(document.getElementById("main")).toHaveAttribute("inert");
        expect(document.getElementById("landing-skip")).toHaveAttribute("inert");
        expect(document.querySelector("footer")).toHaveAttribute("inert");
        // The header's own controls too, but not the button or the panel.
        expect(banner().querySelector('a[href="#top"]')).toHaveAttribute("inert");
        expect(banner().querySelector("a[data-docked]")).toHaveAttribute("inert");
        expect(button()).not.toHaveAttribute("inert");
        expect(panel().closest("[inert]")).toBeNull();
        // The panel carries the theme and language controls (the footer has only the language) and the legal links.
        const inside = within(panel());
        expect(inside.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
        expect(inside.getByRole("link", { name: "Request access" })).toBeInTheDocument();
        expect(inside.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
        expect(inside.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
        expect(inside.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/privacidad");
        expect(inside.getByRole("link", { name: "Terms and conditions" })).toHaveAttribute("href", "/terminos");
    });

    it("has the five sections and 56 px rows", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        const nav = within(panel()).getByRole("navigation", { name: "Sections" });
        const links = within(nav).getAllByRole("link");
        expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
            ["Training", "#formacion"],
            ["Features", "#funciones"],
            ["Why LiTT", "#por-que"],
            ["Coming soon", "#proximamente"],
            ["Trust", "#confianza"],
        ]);
        links.forEach((a) => expect(a).toHaveClass("landing-menu-link"));
    });

    it("keeps Tab inside: button, links, buttons, theme, language, legal links, and back to the button", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        const seen: string[] = [];
        for (let i = 0; i < 12; i += 1) {
            await user.tab();
            seen.push((document.activeElement as HTMLElement).textContent?.trim() || (document.activeElement as HTMLElement).getAttribute("aria-label") || "?");
        }
        expect(seen).toEqual([
            "Features",
            "Why LiTT",
            "Coming soon",
            "Trust",
            "Sign in",
            "Request access",
            "Automatic",
            "English",
            "Privacy notice",
            "Terms and conditions",
            "Menu",
            "Training",
        ]);
        // Shift+Tab from the first thing goes to the last, and from the button to the last link.
        await user.tab({ shift: true });
        expect(button()).toHaveFocus();
        await user.tab({ shift: true });
        expect(within(panel()).getByRole("link", { name: "Terms and conditions" })).toHaveFocus();
    });

    it("closes with Esc and gives the focus back to the button", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        await user.keyboard("{Escape}");
        expect(button()).toHaveAttribute("aria-expanded", "false");
        expect(button()).toHaveFocus();
        expect(document.getElementById("main")).not.toHaveAttribute("inert");
        expect(document.documentElement).not.toHaveClass("menu-open");
        // The panel waits for its exit transition (160 ms), then is hidden again.
        await vi.waitFor(() => expect(panel()).toHaveAttribute("hidden"));
    });

    it("closes with the button, and a second tap opens it again before the exit ends", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        await user.click(button());
        expect(button()).toHaveAttribute("aria-expanded", "false");
        await user.click(button());
        expect(button()).toHaveAttribute("aria-expanded", "true");
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(panel()).not.toHaveAttribute("hidden");
    });

    it("closes from the backdrop", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        const scrim = document.querySelector<HTMLElement>(".landing-scrim")!;
        expect(scrim).not.toHaveAttribute("hidden");
        await user.click(scrim);
        expect(button()).toHaveAttribute("aria-expanded", "false");
        expect(button()).toHaveFocus();
    });

    it("goes to a section from a link: closes at once, sets the hash, moves the focus to its heading", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        await user.click(within(panel()).getByRole("link", { name: "Why LiTT" }));
        expect(button()).toHaveAttribute("aria-expanded", "false");
        expect(panel()).toHaveAttribute("hidden"); // immediately, not after the transition
        expect(window.location.hash).toBe("#por-que");
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
        expect(document.getElementById("landing-why-title")).toHaveFocus();
        expect(document.getElementById("landing-why-title")).toHaveAttribute("tabindex", "-1");
        expect(document.documentElement).not.toHaveClass("menu-open");
        expect(document.getElementById("main")).not.toHaveAttribute("inert");
    });

    it("jumps without smooth scrolling with reduced motion, and the panel is hidden at once", async () => {
        vi.stubGlobal(
            "matchMedia",
            vi.fn((query: string) => ({
                matches: query.includes("reduce"),
                media: query,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        );
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        await user.click(within(panel()).getByRole("link", { name: "Trust" }));
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
        await user.click(button());
        await user.keyboard("{Escape}");
        expect(panel()).toHaveAttribute("hidden");
    });

    it("closes when a legal link or a button is chosen", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        await user.click(within(panel()).getByRole("link", { name: "Privacy notice" }));
        expect(button()).toHaveAttribute("aria-expanded", "false");
        expect(panel()).toHaveAttribute("hidden");
    });

    it("changes theme and language from the menu and stays open", async () => {
        const user = userEvent.setup();
        inSpanish(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("button", { name: "Menú" }));
        const menu = within(document.getElementById("landing-menu")!);
        await user.click(menu.getByRole("radio", { name: "Oscuro" }));
        expect(document.documentElement).toHaveClass("dark");
        await user.click(menu.getByRole("radio", { name: "English" }));
        expect(setLocale).toHaveBeenCalledWith("en-US");
        expect(screen.getByRole("button", { name: "Menú" })).toHaveAttribute("aria-expanded", "true");
        expect(window.localStorage.getItem("litt:theme")).toBe("dark");
    });

    it("closes when the window becomes 880 px wide, on history navigation and on pagehide", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        for (const leave of [
            () => wide.listener?.({ matches: true }),
            () => window.dispatchEvent(new PopStateEvent("popstate")),
            () => window.dispatchEvent(new Event("pagehide")),
        ]) {
            await user.click(button());
            expect(button()).toHaveAttribute("aria-expanded", "true");
            act(() => {
                leave();
            });
            expect(button()).toHaveAttribute("aria-expanded", "false");
            expect(panel()).toHaveAttribute("hidden");
            expect(document.documentElement).not.toHaveClass("menu-open");
        }
    });

    it("does not stay open to the wide window: it ignores a change to a narrow one", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(button());
        act(() => {
            wide.listener?.({ matches: false });
        });
        expect(button()).toHaveAttribute("aria-expanded", "true");
    });

    it("hides the docked button while open and gives it back after", async () => {
        let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                constructor(callback: typeof notify) {
                    notify = callback;
                }
                observe() {}
                disconnect() {}
            },
        );
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        const docked = () => banner().querySelector<HTMLElement>("a[data-docked]")!;
        act(() => notify([{ isIntersecting: false }]));
        expect(docked()).not.toHaveAttribute("inert");
        await user.click(button());
        expect(docked()).toHaveAttribute("inert");
        expect(docked().className).toMatch(/opacity-0/);
        await user.keyboard("{Escape}");
        expect(docked()).not.toHaveAttribute("inert");
    });

    it("leaves nothing behind when the page unmounts with the menu open", async () => {
        const user = userEvent.setup();
        const view = render(<LandingPage signedIn={false} />);
        await user.click(button());
        view.unmount();
        expect(document.documentElement).not.toHaveClass("menu-open");
    });

    it("puts the docked button before the theme button on a phone and after it from 880 px", () => {
        render(<LandingPage signedIn={false} />);
        const docked = banner().querySelector("a[data-docked]")!;
        expect(docked.className).toMatch(/\border-first\b/);
        expect(docked.className).toMatch(/min-\[880px\]:order-1/);
    });
});
