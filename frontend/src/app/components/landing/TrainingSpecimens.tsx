import { useTranslations } from "next-intl";

const CARD =
    "grid content-start gap-2.5 rounded-2xl bg-surface-sheet p-4 font-sans text-[0.8125rem]/[1.45] shadow-elev-sheet";
const LABEL = "text-xs font-medium text-muted-foreground";

function Row({ label, text }: { label: string; text: string }) {
    return (
        <div className="grid gap-0.5">
            <p className="text-xs font-semibold">{label}</p>
            <p>{text}</p>
        </div>
    );
}

/** Step 1: the pasante writes their approach and marks how sure they are (fictitious). */
function ApproachCard() {
    const t = useTranslations();
    const levels = ["i1", "i2", "i3", "i4"] as const;
    return (
        <div className={CARD}>
            <p className={LABEL}>
                {t("landing.training.ex.plan")} · {t("landing.training.ex.count")}
            </p>
            <p className="rounded-lg bg-surface-field p-2.5">{t("landing.training.ex.planText")}</p>
            <p className={LABEL}>{t("landing.training.ex.sure")}</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {levels.map((level) => (
                    <li key={level} className={level === "i3" ? "font-semibold underline underline-offset-4" : "text-muted-foreground"}>
                        {t(`landing.training.ex.levels.${level}`)}
                    </li>
                ))}
            </ul>
            <p className="text-muted-foreground">
                {t("landing.training.ex.hint")} · {t("landing.training.ex.counterparty")}
            </p>
        </div>
    );
}

/** Step 2: the private note that compares the pasante's approach with the answer. */
function ContrastCard() {
    const t = useTranslations();
    return (
        <div className={CARD}>
            <p className={LABEL}>{t("landing.training.ex.note")}</p>
            <Row label={t("landing.training.ex.match")} text={t("landing.training.ex.matchText")} />
            <Row label={t("landing.training.ex.miss")} text={t("landing.training.ex.missText")} />
            <Row label={t("landing.training.ex.lacked")} text={t("landing.training.ex.lackedText")} />
            <p className="text-muted-foreground">{t("landing.training.ex.verdict")}</p>
        </div>
    );
}

/** Step 3: the mentor's two-minute review (fictitious pupil and matter). */
function ReviewCard() {
    const t = useTranslations();
    return (
        <div className={CARD}>
            <p className="text-xs font-semibold">{t("landing.training.ex.supervise")}</p>
            <Row label={t("landing.training.ex.proposed")} text={t("landing.training.ex.proposedText")} />
            <Row label={t("landing.training.ex.corrected")} text={t("landing.training.ex.correctedText")} />
            <Row label={t("landing.training.ex.doubted")} text={t("landing.training.ex.doubtedText")} />
            <Row label={t("landing.training.ex.unverified")} text={t("landing.training.ex.unverifiedText")} />
            <p className="font-semibold">{t("landing.training.ex.approve")}</p>
            <p className="text-muted-foreground">{t("landing.training.ex.promote")}</p>
        </div>
    );
}

/** The example under each step; the page says once that its data are fictitious. */
export function TrainingSpecimen({ step }: { step: "s1" | "s2" | "s3" }) {
    const t = useTranslations();
    return (
        <figure className="m-0 grid gap-2" aria-label={t("landing.training.ex.label")}>
            {step === "s1" ? <ApproachCard /> : step === "s2" ? <ContrastCard /> : <ReviewCard />}
            <figcaption className="text-xs text-muted-foreground">{t("landing.training.ex.label")}</figcaption>
        </figure>
    );
}
