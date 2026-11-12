/**
 * The workflow modals compare option VALUES ("Other", "United States"),
 * never their translated labels, so the custom fields still appear in es-MX.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Locale } from "@litt/i18n";

vi.mock("../../../word-addin/src/taskpane/api/mikeApi", () => ({
    updateWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
}));
vi.mock("../../../word-addin/src/taskpane/lib/errorReporting", () => ({
    reportError: vi.fn(),
    isReported: () => false,
}));

import { LocaleProvider } from "../../../word-addin/src/taskpane/i18n/LocaleProvider";
import { loadLocale } from "../../../word-addin/src/taskpane/i18n/loadLocale";
import { WorkflowDetailsModal } from "../../../word-addin/src/taskpane/components/workflows/WorkflowDetailsModal";
import type { Workflow } from "../../../word-addin/src/taskpane/types";

const workflow: Workflow = {
    id: "wf-1",
    metadata: {
        title: "Custom workflow",
        type: "assistant",
        language: "Klingon",
        practice: "Space law",
        jurisdictions: ["Mars"],
    },
    skill_md: "# Steps",
    is_system: false,
    allow_edit: true,
};

async function renderIn(locale: Locale) {
    const initial = await loadLocale(locale);
    return render(
        <LocaleProvider initial={initial}>
            <WorkflowDetailsModal
                open
                workflow={workflow}
                onClose={() => {}}
                onUpdated={() => {}}
                onDeleted={() => {}}
                deleteConfirmOpen={false}
                onDeleteConfirmOpenChange={() => {}}
            />
        </LocaleProvider>,
    );
}

describe("workflow details modal custom values", () => {
    it.each(["en-US", "es-MX"] as const)("shows the custom fields in %s", async (locale) => {
        await renderIn(locale);
        expect(screen.getByDisplayValue("Klingon")).toBeTruthy();
        expect(screen.getByDisplayValue("Space law")).toBeTruthy();
        expect(screen.getByDisplayValue("Mars")).toBeTruthy();
    });
});
