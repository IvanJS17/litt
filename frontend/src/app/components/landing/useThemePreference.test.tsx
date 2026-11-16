import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { THEME_STORAGE_KEY } from "@/app/lib/theme";
import { useThemePreference } from "./useThemePreference";

function Probe() {
    const { preference } = useThemePreference();
    return <span>{preference}</span>;
}

afterEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("landing-no-transitions", "dark");
});

describe("useThemePreference first paint", () => {
    it("moves the pill to the stored choice with transitions off", () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
        const view = render(<Probe />);
        expect(view.container.textContent).toBe("dark");
        expect(document.documentElement.classList.contains("landing-no-transitions")).toBe(true);
    });

    it("leaves transitions alone when the choice is the default", () => {
        render(<Probe />);
        expect(document.documentElement.classList.contains("landing-no-transitions")).toBe(false);
    });
});
