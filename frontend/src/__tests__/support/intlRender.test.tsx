import { render, renderHook, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { StrictMode, useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

function SaveButton() {
    const t = useTranslations("common");
    return <button type="button">{t("save")}</button>;
}

describe("Testing Library default (vitest.setup.ts)", () => {
    it("renders under the en-US catalog without a provider in the test", () => {
        render(<SaveButton />);
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });

    it("keeps a test's own wrapper, inside the intl provider", () => {
        function Frame({ children }: { children: ReactNode }) {
            return <section aria-label="frame">{children}</section>;
        }
        render(<SaveButton />, { wrapper: Frame });
        expect(screen.getByRole("region", { name: "frame" })).toContainElement(screen.getByRole("button", { name: "Save" }));
        const { result } = renderHook(() => useTranslations("common")("cancel"), { wrapper: Frame });
        expect(result.current).toBe("Cancel");
    });

    it("keeps StrictMode's mount-effect replay, which needs StrictMode at the root", () => {
        const mounted = vi.fn();
        function Probe() {
            useEffect(() => mounted(), []);
            return <SaveButton />;
        }
        const view = render(<StrictMode><Probe /></StrictMode>);
        expect(mounted).toHaveBeenCalledTimes(2);
        view.rerender(<StrictMode><Probe /></StrictMode>);
        expect(mounted).toHaveBeenCalledTimes(2);
        expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
        mounted.mockClear();
        renderHook(() => useEffect(() => mounted(), []), { wrapper: StrictMode });
        expect(mounted).toHaveBeenCalledTimes(2);
    });
});
