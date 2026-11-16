import { useTranslations } from "next-intl";
import { FileGlyph } from "./AssistantSpecimen";

const FILES = [
    { n: 1, kind: "PDF" },
    { n: 2, kind: "PDF" },
    { n: 3, kind: "PDF" },
    { n: 4, kind: "PDF" },
    { n: 5, kind: "DOCX" },
    { n: 6, kind: "DOCX" },
] as const;

/**
 * The project's example: the documents of one matter and its tabs. An
 * illustration (`role="img"` with a description), so the rows are hidden from
 * a screen reader; the fictitious names are in the catalog.
 */
export function ProjectSpecimen() {
    const t = useTranslations();
    return (
        <div role="img" aria-label={t("landing.project.aria")} className="overflow-hidden rounded-xl bg-surface-desk font-sans">
            <div
                aria-hidden="true"
                className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-foreground/14 px-3.5 py-3 text-xs/[1.3] font-medium text-muted-foreground"
            >
                <span>
                    {t("landing.specimen.crumbRoot")} › <b className="font-semibold text-foreground">{t("landing.specimen.crumbProject")}</b>
                </span>
                <span className="ml-auto flex gap-3.5">
                    <span className="pb-0.5 text-foreground shadow-[0_1.5px_0_0_var(--foreground)]">
                        {t("landing.specimen.tabDocs")}
                    </span>
                    <span>{t("landing.project.tabChats")}</span>
                    <span>{t("landing.project.tabTables")}</span>
                </span>
            </div>
            <ul aria-hidden="true">
                {FILES.map(({ n, kind }) => (
                    <li
                        key={n}
                        className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-foreground/14 px-3.5 py-2.5 text-[13px]/[1.35] text-foreground last:border-b-0"
                    >
                        <FileGlyph label={kind} className="h-[26px] w-[22px] text-[6.5px]/none" />
                        <span className="truncate">{t(`landing.project.p${n}`)}</span>
                        <span className="text-xs whitespace-nowrap text-muted-foreground">{t(`landing.project.p${n}m`)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
