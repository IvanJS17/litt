// Test-only page: mounts the same DocxEditor, modules and fonts that
// EigenpalDocxRenderer uses and exposes just enough control for Playwright.
import { createRoot } from "react-dom/client";
import { DocxEditor } from "@docx-editor.dev/react";
import type { Editor } from "@docx-editor.dev/core/contracts/editor";
import { packagedFonts } from "@docx-editor.dev/fonts";
import "@docx-editor.dev/core/styles/editor.css";
import { docxModules } from "../../src/app/lib/docxReviewModule";
import "./contract";


const fonts = packagedFonts();
const root = createRoot(document.getElementById("root")!);
let editor: Editor | null = null;

window.harness = {
    load: (bytes) => new Promise((resolve) => {
        editor = null;
        root.render(
            <DocxEditor
                key={Math.random()}
                document={new Uint8Array(bytes)}
                fonts={fonts}
                mode="edit"
                modules={docxModules}
                author="Prueba"
                chrome
                menu={false}
                rulers={false}
                onReady={(ready) => { editor = ready; resolve({ parseError: ready.snapshot().parseError ?? null }); }}
            />,
        );
    }),
    save: async () => Array.from(new Uint8Array(await editor!.save())),
    replaceText: (find, text) => {
        const match = editor!.findMatches(find)[0];
        return !!match && editor!.exec({ type: "replaceMatch", match, text }).ok;
    },
};
