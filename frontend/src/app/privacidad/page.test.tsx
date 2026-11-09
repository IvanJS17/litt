import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignupLegal } from "@/app/components/legal/LegalDocument";
import PrivacyPage from "./page";
import TermsPage from "../terminos/page";

describe("legal pages", () => {
    it("shows the Privacy Notice without a session", () => {
        render(<PrivacyPage />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Aviso de Privacidad/i);
        expect(screen.getByText("Available in Spanish only.")).toBeInTheDocument();
    });

    it("shows the Terms and Conditions without a session", () => {
        render(<TermsPage />);
        expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Términos y Condiciones/i);
    });

    it("shows the sign-up line with both links and the simplified notice", () => {
        render(<SignupLegal />);
        expect(screen.getByRole("link", { name: "Términos y Condiciones" })).toHaveAttribute("href", "/terminos");
        expect(screen.getByRole("link", { name: "Aviso de Privacidad" })).toHaveAttribute("href", "/privacidad");
        expect(screen.getByText(/Ciruelos 137/)).toBeInTheDocument();
        expect(screen.getByText("Available in Spanish only.")).toBeInTheDocument();
    });
});
