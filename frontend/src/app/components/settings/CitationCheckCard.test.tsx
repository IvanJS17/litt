import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CitationCheckCard } from "./CitationCheckCard";
import { notifyError } from "@/app/lib/userFacingError";

const api = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getCitationCheckSetting: api.get,
  setCitationCheckEnabled: api.set,
}));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: vi.fn(),
}));

describe("CitationCheckCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is not drawn where the deployment does not run the check, nor while it loads or fails", async () => {
    api.get.mockResolvedValue({ available: false, enabled: true });
    const { container, rerender } = render(<CitationCheckCard />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    api.get.mockRejectedValue(new Error("boom"));
    rerender(<CitationCheckCard key="again" />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });

  it("is on by default, says where the citation goes and has no key field, checkbox or dialog", async () => {
    api.get.mockResolvedValue({ available: true, enabled: true });
    render(<CitationCheckCard />);
    const toggle = await screen.findByRole("switch", { name: "Check my citations with TypeSafe" });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/TypeSafe AI, Inc\., in the United States/)).toBeInTheDocument();
    expect(screen.getByText(/without the document's name or any details about you or your firm/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription(/TypeSafe AI, Inc\./);
  });

  it("opts out with one click, and back in", async () => {
    api.get.mockResolvedValue({ available: true, enabled: true });
    api.set.mockResolvedValueOnce({ available: true, enabled: false }).mockResolvedValueOnce({ available: true, enabled: true });
    render(<CitationCheckCard />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(api.set).toHaveBeenLastCalledWith(false);
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(api.set).toHaveBeenLastCalledWith(true);
  });

  it("keeps the switch where it was and says so when saving fails", async () => {
    api.get.mockResolvedValue({ available: true, enabled: true });
    api.set.mockRejectedValue(new Error("nope"));
    render(<CitationCheckCard />);
    const toggle = await screen.findByRole("switch");
    await userEvent.click(toggle);
    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(toggle).toBeChecked();
  });
});
