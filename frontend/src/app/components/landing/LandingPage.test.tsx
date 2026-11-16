import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { LandingPage } from "./LandingPage";
import { VERIFY_SESSION_KEY } from "./CitationSpecimen";
import { HERO_CTA_ID } from "./landingConstants";

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
    // A visit already seen in this session: the verification is complete, nothing plays.
    window.sessionStorage.setItem(VERIFY_SESSION_KEY, "1");
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
            "What LiTT tells you, you can check.",
        );
        expect(container.querySelector('a[href="/privacidad"]')).toHaveTextContent("Privacy notice");
        expect(container.querySelector('a[href="/terminos"]')).toHaveTextContent("Terms and conditions");
        expect(container.querySelector('a[href^="mailto:soporte@asteroitt.com"]')).not.toBeNull();
        expect(container.textContent).toMatch(/LiTT is an AI legal assistant/);
    });

    it("has the three main buttons on /login and none on /assistant", () => {
        const { container } = render(<LandingPage signedIn={false} />);
        const login = container.querySelectorAll('a[href="/login"]');
        expect(login).toHaveLength(3); // header, hero, CUARTO
        login.forEach((a) => expect(a).toHaveTextContent("Sign in"));
        expect(container.querySelector('a[href="/assistant"]')).toBeNull();
        expect(screen.queryByText("Open LiTT")).toBeNull();
    });

    it("asks for access by email with a subject in the page's language", () => {
        render(<LandingPage signedIn={false} />);
        const [first] = screen.getAllByRole("link", { name: "Request access" });
        expect(first).toHaveAttribute(
            "href",
            "mailto:soporte@asteroitt.com?subject=LiTT%20access%20request",
        );
    });

    it("is organized in landmarks, one h1 and one h2 per section", () => {
        render(<LandingPage signedIn={false} />);
        expect(screen.getByRole("banner")).toBeInTheDocument();
        expect(screen.getByRole("main")).toHaveAttribute("id", "main");
        expect(screen.getByRole("contentinfo")).toBeInTheDocument();
        expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
        expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    });

    it("lists the eleven features of the index and the four that are coming", () => {
        render(<LandingPage signedIn={false} />);
        const index = screen.getByRole("list", { name: "Available features" });
        expect(within(index).getAllByRole("listitem")).toHaveLength(11);
        const soon = screen.getByRole("region", { name: "What we’re working on." });
        expect(within(soon).getAllByText("Coming soon", { selector: ".sr-only" })).toHaveLength(4);
        expect(within(soon).getByText("Article 2398")).toBeInTheDocument();
    });

    it("keeps the quoted contract and law in Spanish, marked as such", () => {
        render(<LandingPage signedIn={false} />);
        const quote = document.querySelector("#landing-source blockquote");
        expect(quote).toHaveAttribute("lang", "es");
        expect(quote?.textContent).toMatch(/^«…el Arrendatario pagará/);
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
    it("opens the app from the three main buttons", () => {
        const { container } = render(<LandingPage signedIn />);
        const open = container.querySelectorAll('a[href="/assistant"]');
        expect(open).toHaveLength(3);
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
            "Lo que dice LiTT, lo puedes comprobar.",
        );
        expect(screen.getAllByRole("link", { name: "Iniciar sesión" })).toHaveLength(3);
        expect(screen.getByRole("link", { name: "Aviso de privacidad" })).toHaveAttribute("href", "/privacidad");
        expect(screen.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
        expect(screen.getByRole("link", { name: "Saltar al contenido" })).toBeInTheDocument();
    });

    it("says «Abrir LiTT» with a session", () => {
        inSpanish(<LandingPage signedIn />);
        expect(screen.getAllByRole("link", { name: "Abrir LiTT" })).toHaveLength(3);
    });

    it("sets the access request subject in Spanish", () => {
        inSpanish(<LandingPage signedIn={false} />);
        const [request] = screen.getAllByRole("link", { name: "Solicitar acceso" });
        expect(request).toHaveAttribute(
            "href",
            "mailto:soporte@asteroitt.com?subject=Solicitud%20de%20acceso%20a%20LiTT",
        );
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
        return within(screen.getByRole("banner")).getByText("Sign in").closest("a")!;
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

describe("the hero's example", () => {
    function pill(n: number) {
        return screen.getByRole("button", { name: `Citation ${n}` });
    }

    it("starts on the first source, verified", () => {
        render(<LandingPage signedIn={false} />);
        expect(pill(1)).toHaveAttribute("aria-pressed", "true");
        expect(pill(2)).toHaveAttribute("aria-pressed", "false");
        const source = document.getElementById("landing-source")!;
        expect(source).toHaveAttribute("aria-live", "polite");
        expect(source).toHaveTextContent("p. 7");
        expect(source).toHaveTextContent("Citation verified: the text appears on page 7.");
    });

    it("shows the second source on click, on focus and on a mouse hover, not on a touch", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(pill(2));
        expect(pill(2)).toHaveAttribute("aria-pressed", "true");
        expect(pill(1)).toHaveAttribute("aria-pressed", "false");
        const source = document.getElementById("landing-source")!;
        expect(source).toHaveTextContent("p. 9");
        expect(source).toHaveTextContent("Clause Fifteen");
        expect(source).toHaveTextContent("Citation verified: the text appears on page 9.");

        act(() => pill(1).focus());
        expect(pill(1)).toHaveAttribute("aria-pressed", "true");

        fireEvent.pointerEnter(pill(2), { pointerType: "touch" });
        expect(pill(1)).toHaveAttribute("aria-pressed", "true");
        fireEvent.pointerEnter(pill(2), { pointerType: "mouse" });
        expect(pill(2)).toHaveAttribute("aria-pressed", "true");
        // The source it is already showing does not change.
        fireEvent.pointerEnter(pill(2), { pointerType: "mouse" });
        expect(pill(2)).toHaveAttribute("aria-pressed", "true");
    });

    it("verifies the citation once per browser session, then draws the tick", () => {
        vi.useFakeTimers();
        mediaQueries(false);
        window.sessionStorage.clear();
        const first = render(<LandingPage signedIn={false} />);
        const source = document.getElementById("landing-source")!;
        expect(source).toHaveTextContent("Checking the citation against the document…");
        expect(window.sessionStorage.getItem(VERIFY_SESSION_KEY)).toBe("1");
        act(() => {
            vi.advanceTimersByTime(900);
        });
        expect(source).toHaveTextContent("Citation verified: the text appears on page 7.");
        expect(source.querySelector(".landing-tick-draw")).not.toBeNull();
        first.unmount();

        // Same session, again: it is already verified, nothing plays.
        render(<LandingPage signedIn={false} />);
        expect(document.getElementById("landing-source")).toHaveTextContent(
            "Citation verified: the text appears on page 7.",
        );
        expect(document.querySelector(".landing-spinner")).toBeNull();
    });

    it("does not animate with reduced motion: the verification is already done", () => {
        mediaQueries(true);
        window.sessionStorage.clear();
        render(<LandingPage signedIn={false} />);
        expect(document.getElementById("landing-source")).toHaveTextContent(
            "Citation verified: the text appears on page 7.",
        );
        expect(document.querySelector(".landing-spinner")).toBeNull();
        expect(document.querySelector(".landing-tick-draw")).toBeNull();
        expect(window.sessionStorage.getItem(VERIFY_SESSION_KEY)).toBeNull();
    });

    it("shows the finished state when storage is blocked", () => {
        mediaQueries(false);
        window.sessionStorage.clear();
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        render(<LandingPage signedIn={false} />);
        expect(document.getElementById("landing-source")).toHaveTextContent("Citation verified");
        expect(document.querySelector(".landing-spinner")).toBeNull();
        vi.restoreAllMocks();
    });
});

describe("the tabular review example", () => {
    it("starts on a cell of the first data column and shows its source", () => {
        render(<LandingPage signedIn={false} />);
        const source = document.getElementById("landing-tab-source")!;
        expect(source).toHaveAttribute("aria-live", "polite");
        expect(source).toHaveTextContent("Nave Querétaro.pdf · page 4");
        expect(source).toHaveTextContent("«El presente contrato tendrá una vigencia de 60 (sesenta) meses…»");
        expect(screen.getByRole("button", { name: /60 months/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("changes the source with a click and with a mouse hover", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("button", { name: /Mexico City/ }));
        const source = document.getElementById("landing-tab-source")!;
        expect(source).toHaveTextContent("Local Polanco.pdf · page 10");
        fireEvent.pointerEnter(screen.getByRole("button", { name: /36 months/ }), { pointerType: "touch" });
        expect(source).toHaveTextContent("Local Polanco.pdf · page 10");
        fireEvent.pointerEnter(screen.getByRole("button", { name: /36 months/ }), { pointerType: "mouse" });
        expect(source).toHaveTextContent("Bodega Tlalnepantla.pdf · page 3");
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
    it("switches theme from the header and the footer, with one preference on the device", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
        expect(document.documentElement).toHaveClass("dark");
        expect(window.localStorage.getItem("litt:theme")).toBe("dark");
        // The same preference shows in the footer's group.
        expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();

        await user.click(screen.getByRole("radio", { name: "Light" }));
        expect(document.documentElement).not.toHaveClass("dark");
        expect(window.localStorage.getItem("litt:theme")).toBe("light");

        await user.click(screen.getByRole("radio", { name: "Automatic" }));
        expect(window.localStorage.getItem("litt:theme")).toBe("system");
    });

    it("moves between the three themes with the arrow keys", async () => {
        const user = userEvent.setup();
        render(<LandingPage signedIn={false} />);
        screen.getByRole("radio", { name: "Automatic" }).focus();
        await user.keyboard("{ArrowLeft}");
        expect(window.localStorage.getItem("litt:theme")).toBe("dark");
        expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
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
