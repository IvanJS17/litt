import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectorCard } from "./ConnectorCard";

describe("ConnectorCard", () => {
    it("keeps the control beside the text by default", () => {
        render(<ConnectorCard name="Slack" action={<button>Add</button>} />);
        const body = screen.getByRole("button", { name: "Add" }).closest("section")!.querySelector(".flex-wrap");
        expect(body).not.toBeNull();
    });

    it("puts the control under the text when stacked, with the email on one line", () => {
        render(
            <ConnectorCard
                stacked
                kind="invitation"
                name="Despacho Demo invited you to join as Member"
                detail={<span>dueno.demo@example.test</span>}
                action={<button>Accept</button>}
            />,
        );
        const section = screen.getByRole("button", { name: "Accept" }).closest("section")!;
        // Column, not a wrapping row: the text keeps the whole width.
        expect(section.querySelector(".flex-col")).not.toBeNull();
        expect(section.querySelector(".flex-wrap")).toBeNull();
        expect(screen.getByText("dueno.demo@example.test")).toBeVisible();
    });
});
