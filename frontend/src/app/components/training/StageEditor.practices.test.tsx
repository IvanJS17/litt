import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { StageEditor } from "./TrainingSettings";
import { firmPracticeAreas, useFirmPracticeAreas } from "./firmPracticeAreas";
import { practiceOptionLabel } from "./trainingShared";
import { renderHook } from "@testing-library/react";

// The subject of a stage, in es-MX: «Todas las materias», the areas of the
// firm's profile with their Spanish names, then «Otra materia». The saved
// value is still the English name.

vi.mock("@/app/lib/mikeApi", () => ({ getOrgFirmProfile: vi.fn() }));
// The dropdown is Radix; a native select keeps this test about the options.
vi.mock("@/app/components/modals/ModalSelect", () => ({
    ModalSelect: (props: {
        "aria-label"?: string;
        value: string;
        options: { value: string; label: string }[];
        onChange: (value: string) => void;
    }) => (
        <select aria-label={props["aria-label"]} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
            {props.options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));

const Es = ({ children }: { children: React.ReactNode }) => (
    <IntlClientProvider locale="es-MX" messages={esMX}>
        {children}
    </IntlClientProvider>
);

beforeEach(() => vi.clearAllMocks());

describe("the practice areas of a stage", () => {
    it("offers the firm's areas in Spanish between «Todas las materias» and «Otra materia»", async () => {
        const onSave = vi.fn();
        render(
            <Es>
                <StageEditor
                    id="s"
                    practices={["Corporate and M&A", "Employment", "Tax"]}
                    disabled={false}
                    onSave={onSave}
                />
            </Es>,
        );
        const select = screen.getByRole("combobox", { name: "Materia" });
        const items = Array.from(select.querySelectorAll("option")).map((item) => item.textContent);
        expect(items).toEqual([
            "Todas las materias",
            esMX.settings.personalisationFields.areas.corporateAndMa,
            "Laboral",
            "Fiscal",
            "Otra materia",
        ]);
        expect(screen.queryByText("Employment")).toBeNull();
        expect(screen.queryByText("Litigation")).toBeNull();

        fireEvent.change(select, { target: { value: "Employment" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar etapa" }));
        // The line under the editor says what the chosen stage changes.
        expect(screen.getByText("Intenta primero: escribe su planteamiento antes de que la IA responda.")).toBeInTheDocument();
        fireEvent.change(screen.getByRole("combobox", { name: "Etapa" }), { target: { value: "junior" } });
        expect(screen.getByText("La IA responde con su metodología y en modo de responsabilidad.")).toBeInTheDocument();
        fireEvent.change(screen.getByRole("combobox", { name: "Etapa" }), { target: { value: "pasante" } });
        // What is saved is the stored English name, never the label.
        expect(onSave).toHaveBeenCalledWith("Employment", "pasante");
    });

    it("uses the whole list when the profile names none, and says where the areas come from", () => {
        expect(firmPracticeAreas(undefined)).toContain("Litigation");
        expect(firmPracticeAreas([])).not.toContain("Other");
        expect(firmPracticeAreas(["Tax", " Tax ", ""])).toEqual(["Tax"]);
        render(
            <Es>
                <StageEditor id="s" practices={firmPracticeAreas(null)} disabled={false} onSave={vi.fn()} />
            </Es>,
        );
        expect(screen.getByText(/salen del perfil del despacho/)).toBeInTheDocument();
    });

    it("reads the profile of the firm and falls back when it cannot", async () => {
        vi.mocked(api.getOrgFirmProfile).mockResolvedValueOnce({
            profile: { practice_areas: ["Family Law"] },
            can_manage: false,
        } as never);
        const { result, rerender } = renderHook(({ org }) => useFirmPracticeAreas(org), {
            initialProps: { org: "org-1" },
        });
        await waitFor(() => expect(result.current).toEqual(["Family Law"]));
        vi.mocked(api.getOrgFirmProfile).mockRejectedValueOnce(new Error("boom"));
        rerender({ org: "org-2" });
        await waitFor(() => expect(result.current).toContain("Litigation"));
        expect(api.getOrgFirmProfile).toHaveBeenCalledWith("org-2");
    });

    it("labels a saved practice in Spanish, and leaves a hand-typed one as saved", () => {
        const t = ((key: string) =>
            key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], esMX)) as never;
        expect(practiceOptionLabel("employment", t)).toBe("Laboral");
        expect(practiceOptionLabel("general transactions", t)).toBe("Transacciones generales");
        expect(practiceOptionLabel("mercantil", t)).toBe("mercantil");
    });
});
