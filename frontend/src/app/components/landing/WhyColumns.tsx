import { Check, Cpu, Database, Monitor } from "lucide-react";
import { useTranslations } from "next-intl";
import {
    CATALOG_MODEL_IDS,
    KEY_PROVIDERS,
    LOCAL_MODEL,
    OPENROUTER_MODEL,
    catalogModelName,
} from "./landingModels";

/** A small example on a sheet, drawn with HTML and CSS and described once (`role="img"`). */
function Example({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div role="img" aria-label={label} className="rounded-xl bg-surface-desk font-sans text-[13px]/[1.35] overflow-hidden">
            <div aria-hidden="true">{children}</div>
        </div>
    );
}

function KeysSpecimen() {
    const t = useTranslations();
    return (
        <Example label={t("landing.why.keys.aria")}>
            <p className="border-b border-foreground/14 px-3 py-2.5 text-xs/[1.3] font-medium text-muted-foreground">
                {t("landing.why.keys.heading")}
            </p>
            <ul>
                {KEY_PROVIDERS.map(({ name, saved }) => (
                    <li
                        key={name}
                        className="flex min-h-10 items-center gap-2.5 border-b border-foreground/14 px-3 py-2 text-foreground"
                    >
                        {t(`landing.why.names.${name}`)}
                        <span
                            className={`ml-auto inline-flex items-center gap-1.5 text-xs whitespace-nowrap ${saved ? "text-foreground" : "text-muted-foreground"}`}
                        >
                            {saved ? <Check className="size-[13px]" strokeWidth={1.6} /> : null}
                            {saved ? t("landing.why.keys.saved") : t("landing.why.keys.none")}
                        </span>
                    </li>
                ))}
            </ul>
            <p className="px-3 py-2.5 text-xs/[1.4] text-muted-foreground">{t("landing.why.keys.foot")}</p>
        </Example>
    );
}

const ROW = "flex min-h-10 items-center gap-2.5 px-3 py-2 text-foreground";
const GROUP = "px-3 pt-2.5 pb-1 text-[11px]/[1.3] font-medium text-muted-foreground";

/**
 * The model picker: what you can choose from. Models with the firm's key come
 * from the app's catalog; GLM-Legal (closed weights) sits under OpenRouter and
 * only the open model sits under the firm's own server.
 */
function ModelPickerSpecimen() {
    const t = useTranslations();
    return (
        <Example label={t("landing.why.picker.aria")}>
            <ul>
                <li className={GROUP}>{t("landing.why.picker.groupKeys")}</li>
                {CATALOG_MODEL_IDS.map((id, index) => (
                    <li key={id} className={`${ROW} ${index === 0 ? "bg-interactive-soft-strong" : ""}`}>
                        {catalogModelName(id)}
                        {index === 0 ? <Check className="ml-auto size-3.5" strokeWidth={1.6} /> : null}
                    </li>
                ))}
                <li className={GROUP}>{t("landing.why.picker.groupRouter")}</li>
                <li className={ROW}>
                    {t(`landing.why.names.${OPENROUTER_MODEL.name}`)}
                    <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
                        {t(`landing.why.names.${OPENROUTER_MODEL.maker}`)}
                    </span>
                </li>
                <li className={GROUP}>{t("landing.why.picker.groupLocal")}</li>
                <li className={`${ROW} pb-2.5`}>
                    {t(`landing.why.names.${LOCAL_MODEL.name}`)}
                    <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">{t("landing.why.picker.local")}</span>
                </li>
            </ul>
        </Example>
    );
}

function Node({ icon, name, sub }: { icon: React.ReactNode; name: string; sub: string }) {
    return (
        <span className="grid min-w-0 justify-items-center gap-1 rounded-lg bg-surface-sheet px-1.5 py-3 text-center text-foreground shadow-elev-sheet">
            {icon}
            <span>{name}</span>
            <small className="text-[11px]/[1.3] font-normal text-muted-foreground">{sub}</small>
        </span>
    );
}

/** The firm's network with the app, the data and an open model inside; drawn, no image. */
function PerimeterDiagram() {
    const t = useTranslations();
    const icon = "size-[18px]";
    return (
        <Example label={t("landing.why.perimeter.aria")}>
            <div className="relative px-3.5 pt-[30px] pb-3.5 text-xs/[1.3] font-medium">
                <span className="pointer-events-none absolute inset-2 rounded-lg border-[1.5px] border-dashed border-foreground/42" />
                <span className="absolute top-0.5 left-[18px] bg-surface-desk px-1.5 text-[11px]/none font-medium text-muted-foreground">
                    {t("landing.why.perimeter.label")}
                </span>
                <div className="relative grid grid-cols-3 gap-2">
                    <Node
                        icon={<Monitor className={icon} strokeWidth={1.3} />}
                        name={t("landing.why.perimeter.appName")}
                        sub={t("landing.why.perimeter.appSub")}
                    />
                    <Node
                        icon={<Database className={icon} strokeWidth={1.3} />}
                        name={t("landing.why.perimeter.dataName")}
                        sub={t("landing.why.perimeter.dataSub")}
                    />
                    <Node
                        icon={<Cpu className={icon} strokeWidth={1.3} />}
                        name={t("landing.why.perimeter.modelName")}
                        sub={t("landing.why.perimeter.modelSub")}
                    />
                </div>
                <p className="relative mt-2.5 text-center font-normal text-muted-foreground">
                    {t("landing.why.perimeter.note")}
                </p>
            </div>
        </Example>
    );
}

function WhyColumn({
    id,
    title,
    body,
    children,
}: {
    id: string;
    title: string;
    body: string;
    children: React.ReactNode;
}) {
    return (
        <article aria-labelledby={id} className="flex min-w-0 flex-col gap-3.5 border-t border-foreground pt-7 pb-9">
            <h3 id={id} className="landing-h3-sm">
                {title}
            </h3>
            <p className="landing-pretty max-w-[40ch] text-muted-foreground">{body}</p>
            <div className="mt-auto rounded-[20px] bg-surface-sheet p-3 shadow-elev-sheet">{children}</div>
        </article>
    );
}

/**
 * SEGUNDO · Por qué LiTT: the firm's own keys, the model it chooses and
 * installing it on its own servers. Three columns with a rule on top (not
 * cards) from 960 px, one under another on a phone, each with a small example
 * aligned at the bottom.
 */
export function WhyColumns() {
    const t = useTranslations();
    return (
        <div className="grid grid-cols-1 gap-x-12 min-[960px]:grid-cols-3">
            <WhyColumn id="landing-why-byok" title={t("landing.why.byok.title")} body={t("landing.why.byok.body")}>
                <KeysSpecimen />
            </WhyColumn>
            <WhyColumn id="landing-why-model" title={t("landing.why.model.title")} body={t("landing.why.model.body")}>
                <ModelPickerSpecimen />
            </WhyColumn>
            <WhyColumn id="landing-why-host" title={t("landing.why.host.title")} body={t("landing.why.host.body")}>
                <PerimeterDiagram />
            </WhyColumn>
        </div>
    );
}
