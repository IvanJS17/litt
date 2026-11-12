import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const approveTrainingVersion = vi.fn();
const notifyError = vi.fn();
vi.mock("@/app/lib/mikeApi", () => ({
    approveTrainingVersion: (...args: unknown[]) => approveTrainingVersion(...args),
}));
vi.mock("@/app/lib/userFacingError", () => ({
    notifyError: (...args: unknown[]) => notifyError(...args),
}));


import { TrainingVersionStatus } from "./TrainingVersionStatus";

beforeEach(() => {
    approveTrainingVersion.mockReset();
    notifyError.mockReset();
});

const props = { documentId: "doc", versionId: "v", held: true, canApprove: true, onApproved: vi.fn() };

describe("TrainingVersionStatus", () => {
    it("renders nothing for a version that may leave", () => {
        const { container } = render(<TrainingVersionStatus {...props} held={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("marks the draft and offers no approval to whoever may not approve", () => {
        render(<TrainingVersionStatus {...props} canApprove={false} />);
        expect(screen.getByText("Intern draft, pending approval")).toBeInTheDocument();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("approves the version and lets the host refresh", async () => {
        const onApproved = vi.fn();
        approveTrainingVersion.mockResolvedValue({});
        render(<TrainingVersionStatus {...props} onApproved={onApproved} className="mt-1" />);
        const button = screen.getByRole("button", { name: "Approve this version" });
        expect(button).toHaveAttribute("type", "button");
        fireEvent.click(button);
        fireEvent.click(button);
        await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1));
        expect(approveTrainingVersion).toHaveBeenCalledExactlyOnceWith("doc", "v");
    });

    it("reports a refusal through notifyError", async () => {
        const error = new Error("No puedes aprobar esta versión.");
        approveTrainingVersion.mockRejectedValue(error);
        render(<TrainingVersionStatus {...props} />);
        fireEvent.click(screen.getByRole("button", { name: "Approve this version" }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(error, expect.objectContaining({ action: "approve this version" })),
        );
        expect(props.onApproved).not.toHaveBeenCalled();
    });

    it("needs a version to approve", () => {
        render(<TrainingVersionStatus {...props} versionId={null} />);
        expect(screen.queryByRole("button")).toBeNull();
    });
});
