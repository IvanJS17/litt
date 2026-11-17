import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { FileDirectory } from "./FileDirectory";

// Every tab is empty here, so the texts that explain an empty tab show.
vi.mock("./useDirectoryData", () => ({
    useDirectoryData: () => ({
        loadingTabs: {},
        standaloneDocuments: [],
        templateDocuments: [],
        fileFolders: [],
        templateFolders: [],
        projects: [],
        loadTab: vi.fn(),
    }),
}));

function renderEs(destination?: "project" | "new-project") {
    return render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            <FileDirectory
                selectedDocuments={[]}
                onChange={vi.fn()}
                showTabs
                destination={destination}
            />
        </IntlClientProvider>,
    );
}

describe("FileDirectory tabs", () => {
    it("names the tabs and describes the active one (es-MX)", async () => {
        const user = userEvent.setup({ delay: null });
        renderEs("project");

        expect(screen.getByRole("button", { name: "Mi biblioteca" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Plantillas" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Otros proyectos" })).toBeInTheDocument();
        expect(
            screen.getByText("Documentos que subiste fuera de cualquier proyecto."),
        ).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Plantillas" }));
        expect(
            screen.getByText(
                "Tus plantillas de Biblioteca › Plantillas: documentos base para redactar. No son workflows ni playbooks.",
            ),
        ).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Otros proyectos" }));
        expect(
            screen.getByText("Documentos de tus otros proyectos, para copiarlos aquí."),
        ).toBeInTheDocument();
    });

    it("explains each empty tab inside a project", async () => {
        const user = userEvent.setup({ delay: null });
        renderEs("project");

        expect(
            screen.getByText(
                "No tienes documentos en tu biblioteca fuera de proyectos. Los documentos de este proyecto ya están en el proyecto.",
            ),
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Plantillas" }));
        expect(
            screen.getByText(
                "Aún no tienes plantillas. Puedes agregarlas en Biblioteca › Plantillas.",
            ),
        ).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Otros proyectos" }));
        expect(
            screen.getByText("No tienes otros proyectos con documentos todavía."),
        ).toBeInTheDocument();
    });

    it("does not say the project already has the documents when there is no project yet", () => {
        renderEs("new-project");
        expect(
            screen.getByText("No tienes documentos en tu biblioteca fuera de proyectos."),
        ).toBeInTheDocument();
        expect(screen.queryByText(/ya están en el proyecto/)).not.toBeInTheDocument();
    });

    it("keeps the wording neutral for callers that are not a project", async () => {
        const user = userEvent.setup({ delay: null });
        renderEs();
        await user.click(screen.getByRole("button", { name: "Otros proyectos" }));
        expect(screen.getByText("Documentos de tus proyectos.")).toBeInTheDocument();
        expect(screen.queryByText(/copiarlos aquí/)).not.toBeInTheDocument();
    });

    it("uses the English names in en-US", () => {
        render(<FileDirectory selectedDocuments={[]} onChange={vi.fn()} showTabs />);
        const tabs = screen.getAllByRole("button").map((b) => b.textContent);
        expect(tabs).toEqual(expect.arrayContaining(["My library", "Templates", "Other projects"]));
        expect(
            within(document.body).getByText("Documents you uploaded outside any project."),
        ).toBeInTheDocument();
    });
});
