import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScanReading, startScanReading, type ScanReadingState } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { ScanReadingStatus } from "./ScanReadingStatus";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getScanReading: vi.fn(),
  startScanReading: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: vi.fn(),
}));

const state = (patch: Partial<ScanReadingState> = {}): ScanReadingState => ({
  applicable: true,
  status: "none",
  error_code: null,
  key_available: true,
  can_edit: true,
  needs_reading: true,
  page_count: 7,
  textless_page_count: 7,
  auto_max_pages: 50,
  estimated_cost_usd: 0.07,
  credits: null,
  ...patch,
});

beforeEach(() => {
  vi.mocked(getScanReading).mockReset();
  vi.mocked(startScanReading).mockReset();
  vi.mocked(notifyError).mockReset();
});
afterEach(() => vi.useRealTimers());

describe("ScanReadingStatus", () => {
  it("shows the button, with the estimated cost in the confirmation, and starts only when confirmed", async () => {
    vi.mocked(getScanReading).mockResolvedValue(state());
    vi.mocked(startScanReading).mockResolvedValue(state({ status: "processing", needs_reading: false }));
    render(<ScanReadingStatus documentId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Read scan" }));
    expect(await screen.findByText(/7 pages\) will be sent to LandingAI, in the United States/)).toBeInTheDocument();
    expect(screen.getByText(/about USD 0.07/)).toBeInTheDocument();
    expect(startScanReading).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Read scan" }).at(-1)!);
    await waitFor(() => expect(startScanReading).toHaveBeenCalledWith("d1"));
    expect(await screen.findByRole("status")).toHaveTextContent("Reading scan…");
    expect(screen.queryByRole("button", { name: "Read scan" })).toBeNull();
  });

  it("cancelling the confirmation sends nothing", async () => {
    vi.mocked(getScanReading).mockResolvedValue(state());
    render(<ScanReadingStatus documentId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Read scan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(startScanReading).not.toHaveBeenCalled();
  });

  it("offers no button without a key, without edit rights, or when nothing needs reading; nothing at all for other files", async () => {
    for (const patch of [{ key_available: false }, { can_edit: false }, { needs_reading: false }]) {
      vi.mocked(getScanReading).mockResolvedValue(state(patch));
      const { unmount } = render(<ScanReadingStatus documentId="d1" />);
      await waitFor(() => expect(getScanReading).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: "Read scan" })).toBeNull();
      unmount();
    }
    vi.mocked(getScanReading).mockResolvedValue(state({ applicable: false }));
    const { container } = render(<ScanReadingStatus documentId="d1" />);
    await waitFor(() => expect(getScanReading).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("says the scan was read", async () => {
    vi.mocked(getScanReading).mockResolvedValue(state({ status: "ready", needs_reading: false, textless_page_count: 0 }));
    render(<ScanReadingStatus documentId="d1" />);
    expect(await screen.findByRole("status")).toHaveTextContent("Scan read");
  });

  it("polls while reading, then reports the end: refresh on success, a notice with the code on failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRead = vi.fn();
    vi.mocked(getScanReading)
      .mockResolvedValueOnce(state({ status: "processing", needs_reading: false }))
      .mockResolvedValueOnce(state({ status: "ready", needs_reading: false, textless_page_count: 0 }));
    render(<ScanReadingStatus documentId="d1" onRead={onRead} />);
    expect(await screen.findByText("Reading scan…")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    await waitFor(() => expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" })));
    expect(screen.getByRole("status")).toHaveTextContent("Scan read");
  });

  it("reports a failure with its code and says what happened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getScanReading)
      .mockResolvedValueOnce(state({ status: "processing", needs_reading: false }))
      .mockResolvedValueOnce(state({ status: "failed", error_code: "ocr_no_credits" }));
    render(<ScanReadingStatus documentId="d1" />);
    await screen.findByText("Reading scan…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(expect.objectContaining({ code: "ocr_no_credits" }), expect.anything()),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Your LandingAI account has no credits.");
    // A failed attempt can be tried again.
    expect(screen.getByRole("button", { name: "Read scan" })).toBeInTheDocument();
  });

  it("explains a start that the server refuses, and leaves the page as it was when the lookup fails", async () => {
    vi.mocked(getScanReading).mockResolvedValue(state());
    vi.mocked(startScanReading).mockRejectedValue(Object.assign(new Error("x"), { code: "ocr_key_missing" }));
    render(<ScanReadingStatus documentId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Read scan" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Read scan" })).at(-1)!);
    await waitFor(() => expect(notifyError).toHaveBeenCalled());

    vi.mocked(getScanReading).mockRejectedValue(new Error("down"));
    const { container } = render(<ScanReadingStatus documentId="d2" />);
    await waitFor(() => expect(getScanReading).toHaveBeenCalledWith("d2", expect.anything()));
    expect(container).toBeEmptyDOMElement();
  });
});
