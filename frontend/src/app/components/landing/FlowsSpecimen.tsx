import { Play } from "lucide-react";
import { useTranslations } from "next-intl";

const FLOWS = [
    { n: 1, tag: "tagAssistant" },
    { n: 2, tag: "tagTable" },
    { n: 3, tag: "tagPlaybook" },
    { n: 4, tag: "tagAssistant" },
    { n: 5, tag: "tagTable" },
] as const;

/**
 * The workflows' example: five saved workflows and playbooks, each with its
 * area and kind, and the line that runs the first on the project. An
 * illustration (`role="img"`). The kind is a 1 px ring in the sans, not
 * Departure Mono (that is for the page's few small labels).
 */
export function FlowsSpecimen() {
    const t = useTranslations();
    return (
        <div role="img" aria-label={t("landing.flows.aria")} className="overflow-hidden rounded-xl bg-surface-desk font-sans">
            <ul aria-hidden="true">
                {FLOWS.map(({ n, tag }) => (
                    <li
                        key={n}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-foreground/14 px-3.5 py-3 text-[13px]/[1.35]"
                    >
                        <span className="font-medium text-foreground">{t(`landing.flows.w${n}`)}</span>
                        <span className="col-start-1 text-xs text-muted-foreground">{t(`landing.flows.w${n}p`)}</span>
                        <span className="col-start-2 row-span-2 row-start-1 inline-flex h-5 items-center rounded-full px-[7px] text-[11px]/none font-medium whitespace-nowrap text-foreground ring-1 ring-inset ring-interactive-border">
                            {t(`landing.flows.${tag}`)}
                        </span>
                    </li>
                ))}
            </ul>
            <p
                aria-hidden="true"
                className="flex items-center gap-2 bg-interactive-soft px-3.5 py-3 text-xs/[1.3] font-medium text-foreground"
            >
                <Play className="size-3.5 shrink-0" fill="currentColor" strokeWidth={0} />
                <span>{t("landing.flows.run")}</span>
            </p>
        </div>
    );
}
