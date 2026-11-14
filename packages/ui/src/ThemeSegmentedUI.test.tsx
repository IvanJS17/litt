import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Theme } from "@mike/client";
import { ThemeSegmentedUI } from "./ThemeSegmentedUI";

const labels = {
    light: "Light",
    dark: "Dark",
    system: "Auto",
    systemAria: "Automatic (follows your device)",
};

function Harness({
    initial = "light",
    onChange = () => {},
    variant = "settings",
    arrows = "all",
}: {
    initial?: Theme;
    onChange?: (theme: Theme) => void;
    variant?: "menu" | "settings";
    arrows?: "all" | "horizontal";
}) {
    const [value, setValue] = useState<Theme>(initial);
    return (
        <ThemeSegmentedUI
            label="Theme"
            labels={labels}
            variant={variant}
            arrows={arrows}
            value={value}
            onChange={(next) => {
                setValue(next);
                onChange(next);
            }}
        />
    );
}

describe("ThemeSegmentedUI", () => {
    it("is a radiogroup of three radios with the chosen one checked", () => {
        render(<Harness initial="dark" />);
        const group = screen.getByRole("radiogroup", { name: "Theme" });
        expect(group).toBeVisible();
        const radios = screen.getAllByRole("radio");
        expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
            "false",
            "true",
            "false",
        ]);
        expect(radios.map((r) => r.textContent)).toEqual(["Light", "Dark", "Auto"]);
    });

    it("names Automático in full when the visible word is shorter, keeping the visible word inside the name", () => {
        render(<Harness variant="menu" />);
        const auto = screen.getByRole("radio", { name: "Automatic (follows your device)" });
        expect(auto.textContent).toBe("Auto");
        expect(auto.getAttribute("aria-label")!.toLowerCase()).toContain(
            auto.textContent!.toLowerCase(),
        );
    });

    it("has one tab stop, on the chosen radio", () => {
        render(<Harness initial="system" />);
        expect(
            screen.getAllByRole("radio").map((r) => r.getAttribute("tabindex")),
        ).toEqual(["-1", "-1", "0"]);
    });

    it("chooses on click and ignores a click on the chosen one", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        await user.click(screen.getByRole("radio", { name: "Light" }));
        expect(onChange).not.toHaveBeenCalled();
        await user.click(screen.getByRole("radio", { name: "Dark" }));
        expect(onChange).toHaveBeenCalledExactlyOnceWith("dark");
    });

    it("moves and chooses with the arrow keys, wrapping at the ends, and with Home and End", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        screen.getByRole("radio", { name: "Light" }).focus();
        await user.keyboard("{ArrowRight}");
        expect(onChange).toHaveBeenLastCalledWith("dark");
        expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();

        await user.keyboard("{ArrowDown}");
        expect(onChange).toHaveBeenLastCalledWith("system");
        await user.keyboard("{ArrowDown}");
        expect(onChange).toHaveBeenLastCalledWith("light");
        await user.keyboard("{ArrowLeft}");
        expect(onChange).toHaveBeenLastCalledWith("system");
        await user.keyboard("{Home}");
        expect(onChange).toHaveBeenLastCalledWith("light");
        await user.keyboard("{End}");
        expect(onChange).toHaveBeenLastCalledWith("system");
        expect(screen.getByRole("radio", { name: /Automatic/ })).toHaveFocus();
    });

    it("leaves Up and Down to a menu around it, and keeps its own arrows from reaching it", () => {
        const onChange = vi.fn();
        const outer = vi.fn();
        render(
            <div onKeyDown={(event) => outer(event.key)}>
                <Harness variant="menu" arrows="horizontal" onChange={onChange} />
            </div>,
        );
        const light = screen.getByRole("radio", { name: "Light" });
        light.focus();

        fireEvent.keyDown(light, { key: "ArrowDown" });
        fireEvent.keyDown(light, { key: "ArrowUp" });
        expect(onChange).not.toHaveBeenCalled();
        expect(outer).toHaveBeenCalledWith("ArrowDown");
        expect(outer).toHaveBeenCalledWith("ArrowUp");

        outer.mockClear();
        fireEvent.keyDown(light, { key: "ArrowRight" });
        expect(onChange).toHaveBeenCalledWith("dark");
        expect(outer).not.toHaveBeenCalled();
    });

    it("gives the menu variant icons and 28 px buttons (44 px with a finger), and the settings one words only", () => {
        const { container, rerender } = render(<Harness variant="menu" />);
        expect(container.querySelectorAll("svg")).toHaveLength(3);
        for (const radio of screen.getAllByRole("radio")) {
            expect(radio.className).toContain("h-7");
            expect(radio.className).toContain("pointer-coarse:h-11");
        }
        rerender(<Harness variant="settings" />);
        expect(container.querySelectorAll("svg")).toHaveLength(0);
    });

    it("marks the group busy while a save is on its way", () => {
        render(
            <ThemeSegmentedUI
                label="Theme"
                labels={labels}
                value="light"
                busy
                onChange={() => {}}
            />,
        );
        expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
    });
});
