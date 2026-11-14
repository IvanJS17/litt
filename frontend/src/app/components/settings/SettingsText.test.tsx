import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    SettingsDescription,
    SettingsLabel,
    SettingsManagedRow,
    SettingsMoreInfo,
    SettingsNotice,
    SettingsNoticeLine,
    SettingsTag,
} from "./SettingsText";

describe("settings text", () => {
    it("applies the fixed shared label style", () => {
        render(<SettingsLabel>Setting name</SettingsLabel>);

        expect(screen.getByText("Setting name")).toHaveClass(
            "text-sm",
            "font-medium",
            "text-gray-700",
        );
    });

    it("applies the fixed shared description style", () => {
        render(<SettingsDescription>Setting details</SettingsDescription>);

        expect(screen.getByText("Setting details")).toHaveClass(
            "text-sm",
            "text-gray-600",
        );
    });
});

describe("settings signals", () => {
    it("says «Optional» and «Recommended» in words, without an icon", () => {
        const { container } = render(
            <>
                <SettingsTag kind="optional" />
                <SettingsTag kind="recommended" />
            </>,
        );
        expect(screen.getByText("Optional")).toBeVisible();
        expect(screen.getByText("Recommended")).toHaveClass("ring-1");
        expect(container.querySelector("svg")).toBeNull();
    });

    it("draws an audience tag with its text and a hidden icon", () => {
        const { container } = render(
            <SettingsTag kind="audience" icon="firm">
                Applies to the whole firm
            </SettingsTag>,
        );
        expect(screen.getByText("Applies to the whole firm")).toBeVisible();
        expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    });

    it("keeps the text of a note in view, with a hidden icon per entry and no alert role", () => {
        const { container } = render(
            <SettingsNotice
                entries={[
                    { icon: "send", label: "Data to a third party" },
                    { icon: "receipt", label: "Has a cost" },
                ]}
                bodyId="legal"
            >
                Legal text, complete.
            </SettingsNotice>,
        );
        expect(screen.getByText("Data to a third party")).toBeVisible();
        expect(screen.getByText("Has a cost")).toBeVisible();
        expect(screen.getByText("Legal text, complete.")).toBeVisible();
        expect(container.querySelector("#legal")).toHaveTextContent("Legal text, complete.");
        expect(container.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(2);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(container.querySelector("[data-tone=note]")?.className).toContain("--litt-note-rule");
    });

    it("keeps red for what cannot be undone, and never amber or blue", () => {
        const { container } = render(
            <SettingsNotice tone="irreversible" entries={[{ icon: "alert", label: "This cannot be undone." }]}>
                Deletes everything.
            </SettingsNotice>,
        );
        const notice = container.querySelector("[data-tone=irreversible]") as HTMLElement;
        expect(notice.className).toContain("--litt-danger-rule");
        expect(screen.getByText("This cannot be undone.").closest("p")?.className).toContain("--litt-danger-text");
        expect(container.innerHTML).not.toMatch(/amber|orange|blue/);
    });

    it("draws the one-line notice with a hidden icon", () => {
        const { container } = render(<SettingsNoticeLine icon="receipt">It is charged to your key.</SettingsNoticeLine>);
        expect(screen.getByText("It is charged to your key.")).toBeVisible();
        expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    });

    it("draws the managed row with the firm icon hidden and the words in bold", () => {
        const { container } = render(
            <SettingsManagedRow>
                <b>Your firm manages this.</b> Ask an owner.
            </SettingsManagedRow>,
        );
        expect(screen.getByText("Your firm manages this.").tagName).toBe("B");
        expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    });

    it("opens and closes «More information» with aria-expanded kept in step", () => {
        const { container } = render(<SettingsMoreInfo>How it works.</SettingsMoreInfo>);
        const summary = screen.getByText("More information").closest("summary") as HTMLElement;
        const details = container.querySelector("details") as HTMLDetailsElement;
        expect(summary).toHaveAttribute("aria-expanded", "false");
        details.open = true;
        fireEvent(details, new Event("toggle"));
        expect(summary).toHaveAttribute("aria-expanded", "true");
        details.open = false;
        fireEvent(details, new Event("toggle"));
        expect(summary).toHaveAttribute("aria-expanded", "false");
    });
});
