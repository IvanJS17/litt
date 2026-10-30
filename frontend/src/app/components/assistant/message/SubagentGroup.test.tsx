import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SubagentGroup, type DelegationEvent } from "./SubagentGroup";

const event = (overrides: Partial<DelegationEvent>): DelegationEvent => ({
    type: "delegation",
    delegation_id: "d1",
    title: "Review lease",
    task: "Review the lease.",
    status: "completed",
    brief: "Clause 4 is unusual.",
    events: [],
    model: "claude-opus-5-5",
    effort: "standard",
    reasoning: "high",
    ...overrides,
});

const renderGroup = (delegation: DelegationEvent) =>
    render(
        <SubagentGroup
            delegations={[delegation]}
            tints={new Map()}
            showConnectorAfter={false}
            renderSteps={() => null}
        />,
    );

describe("SubagentGroup (LiTT routes)", () => {
    it("shows the route and model a subagent ran on, without Response details on", async () => {
        renderGroup(event({ route: "deep", provider: "claude" }));

        await userEvent.click(screen.getByRole("button", { name: /Review lease/ }));

        expect(screen.getByText("Route deep · Claude Opus 5.5")).toBeInTheDocument();
    });

    it("says why a route could not run", async () => {
        renderGroup(
            event({
                status: "failed",
                brief: "",
                route: "deep",
                route_unavailable: "No key you can use for claude-opus-5-5 is available.",
            }),
        );

        await userEvent.click(screen.getByRole("button", { name: /Review lease/ }));

        expect(
            screen.getByText(
                "Couldn't start: No key you can use for claude-opus-5-5 is available.",
            ),
        ).toBeInTheDocument();
    });
});
