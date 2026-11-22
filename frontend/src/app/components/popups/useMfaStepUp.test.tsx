import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MikeApiError } from "@/app/lib/mikeApi";
import { useMfaStepUp } from "./useMfaStepUp";

const popupProps = vi.hoisted(() => ({
    current: null as null | { open: boolean; onCancel: () => void; onVerified: () => void },
}));
vi.mock("./MfaVerificationPopup", () => ({
    MfaVerificationPopup: (props: { open: boolean; onCancel: () => void; onVerified: () => void }) => {
        popupProps.current = props;
        return props.open ? <div role="dialog">second factor</div> : null;
    },
}));

const mfaError = () =>
    new MikeApiError({ message: "MFA verification required", status: 403, code: "mfa_verification_required" });

function mount() {
    const api = { run: null as unknown as ReturnType<typeof useMfaStepUp>["run"] };
    function Harness() {
        const { run, popup } = useMfaStepUp();
        useEffect(() => {
            api.run = run;
        });
        return <>{popup}</>;
    }
    render(<Harness />);
    return api;
}

describe("useMfaStepUp", () => {
    it("returns the action's result without asking when the server does not", async () => {
        const api = mount();
        await expect(api.run(async () => "done")).resolves.toBe("done");
    });

    it("passes any other failure through untouched", async () => {
        const api = mount();
        const failure = new MikeApiError({ message: "boom", status: 500 });
        await expect(api.run(async () => { throw failure; })).rejects.toBe(failure);
    });

    it("asks for the second factor, then performs the action again", async () => {
        const action = vi.fn().mockRejectedValueOnce(mfaError()).mockResolvedValueOnce("saved");
        const api = mount();
        let outcome: Promise<string> | undefined;
        act(() => { outcome = api.run(action); });
        await screen.findByRole("dialog");
        expect(action).toHaveBeenCalledTimes(1);
        act(() => popupProps.current!.onVerified());
        await expect(outcome).resolves.toBe("saved");
        expect(action).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("rejects with the original error when the prompt is declined", async () => {
        const failure = mfaError();
        const action = vi.fn().mockRejectedValue(failure);
        const api = mount();
        let outcome: Promise<unknown> | undefined;
        act(() => { outcome = api.run(action); });
        await screen.findByRole("dialog");
        act(() => popupProps.current!.onCancel());
        await expect(outcome).rejects.toBe(failure);
        expect(action).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("asks once for actions that fail together and performs them all again", async () => {
        const first = vi.fn().mockRejectedValueOnce(mfaError()).mockResolvedValueOnce(1);
        const second = vi.fn().mockRejectedValueOnce(mfaError()).mockResolvedValueOnce(2);
        const api = mount();
        let outcome: Promise<unknown[]> | undefined;
        act(() => { outcome = Promise.all([api.run(first), api.run(second)]); });
        await screen.findByRole("dialog");
        expect(screen.getAllByRole("dialog")).toHaveLength(1);
        act(() => popupProps.current!.onVerified());
        await expect(outcome).resolves.toEqual([1, 2]);
    });
});
