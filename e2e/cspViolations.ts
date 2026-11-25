/**
 * Content-security-policy violation collector for browser specs.
 *
 * CI serves a production build with the page policy enforced
 * (.github/workflows/e2e.yml), so a script, frame, font or connection the
 * policy refuses fails in the browser the way it fails for a user, and the
 * browser reports it as a `securitypolicyviolation` event. A feature that
 * breaks under the policy usually shows up only as a vague visible symptom (an
 * error message, a blank panel); this helper turns every refusal into a named,
 * failing assertion instead.
 *
 * Usage:
 *     const csp = await recordCspViolations(page);   // before any navigation
 *     ...drive the page...
 *     csp.expectNone();
 *
 * Events from every frame of the page are collected, including frames opened
 * later, and survive full-page navigations.
 */
import { expect, type Page } from "@playwright/test";

export type CspViolation = {
    /** The directive that refused the request, e.g. `script-src-elem` or `frame-src`. */
    directive: string;
    /** What was refused: a URL, `inline`, `eval`, `wasm-eval`, `blob`, ... */
    blockedUri: string;
    /** `enforce` or `report`: a report-only policy records but does not block. */
    disposition: string;
    /** The page (or frame) the event fired in. */
    frame: string;
    /** Where the refused code was loaded from, when the browser says. */
    sourceFile: string;
    line: number;
    /** The first characters of the refused code, when the browser says. */
    sample: string;
};

export type CspRecorder = {
    /** A copy of everything recorded so far. */
    violations: () => CspViolation[];
    /** Fails, listing each directive and blocked URI, when anything was recorded. */
    expectNone: (context?: string) => void;
};

const BINDING = "__littReportCspViolation";

export function describeCspViolation(v: CspViolation): string {
    const where = v.sourceFile ? ` (from ${v.sourceFile}:${v.line})` : "";
    return `${v.directive} blocked ${v.blockedUri || "(no uri)"} [${v.disposition}] in ${v.frame}${where}`;
}

/**
 * Start recording. Call before the first `page.goto` of the test: the listener
 * is installed with `addInitScript`, so it exists before any page script runs
 * and in every frame the page creates.
 */
export async function recordCspViolations(page: Page): Promise<CspRecorder> {
    const recorded: CspViolation[] = [];
    await page.exposeBinding(BINDING, (_source: unknown, violation: CspViolation) => {
        recorded.push(violation);
    });
    await page.addInitScript((binding: string) => {
        document.addEventListener(
            "securitypolicyviolation",
            (event) => {
                const report = (window as unknown as Record<string, (v: unknown) => void>)[binding];
                report?.({
                    directive: event.effectiveDirective || event.violatedDirective,
                    blockedUri: event.blockedURI,
                    disposition: event.disposition,
                    frame: location.href,
                    sourceFile: event.sourceFile,
                    line: event.lineNumber,
                    sample: event.sample,
                });
            },
            true,
        );
    }, BINDING);
    return {
        violations: () => [...recorded],
        expectNone: (context = "the page") => {
            expect(
                recorded.map(describeCspViolation),
                `${context} must not run into the content security policy`,
            ).toEqual([]);
        },
    };
}
