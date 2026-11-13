import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ManagedAccountNotice } from "./ManagedAccountNotice";

describe("ManagedAccountNotice", () => {
  it("says what the invitation will create, names the firm and links the Terms", () => {
    render(<ManagedAccountNotice firm="Despacho Aurora" />);
    expect(
      screen.getByRole("heading", { name: "Account managed by Despacho Aurora" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/you won't have a personal workspace/)).toBeInTheDocument();
    expect(screen.getByText(/If you leave Despacho Aurora, your account will have a personal workspace again/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See section 5.5 of the Terms" })).toHaveAttribute("href", "/terminos");
  });
});
