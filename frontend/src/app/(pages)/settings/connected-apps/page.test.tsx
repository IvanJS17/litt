import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectedAppsPage from "./page";

vi.mock("@/app/components/settings/ConnectedAppsSection", () => ({
    ConnectedAppsSection: () => <p>connected apps list</p>,
}));

afterEach(cleanup);

describe("ConnectedAppsPage", () => {
    it("shows the connected apps list", () => {
        render(<ConnectedAppsPage />);
        expect(screen.getByText("connected apps list")).toBeTruthy();
    });
});
