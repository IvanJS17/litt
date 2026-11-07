"use client";

import { useState } from "react";
import { notify } from "@/app/lib/notify";
import { useTranslations } from "next-intl";

// Module-level text has no translator in scope: the codemod leaves it.
const FILTERS = [{ label: "All files" }];

export function MatterFiles({ count, user }: { count: number; user: { name: string } }) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const save = () => notify(t("demo.files.savedYourChanges"));
    const menu = [{ label: t("demo.files.renameName", { name: user.name }), id: "rename" }];
    return (
        <section aria-label={t("demo.files.matterFiles")} className="flex gap-2">
            <h2 title={t("demo.files.filesSharedInThisMatter")}>{t("demo.files.files")}</h2>
            <input placeholder={t("demo.files.searchFiles")} />
            <p>
                {t("demo.files.welcomeBackNameYouHaveCount", { count, name: user.name })}
            </p>
            <span>{t("demo.files.countMattersSelected", { count })}</span>
            <p>
                {t("demo.files.dontLoseYourWork")}
            </p>
            {open ? t("demo.files.readyToGo") : null}
            <button type="button" onClick={() => setOpen(true)}>
                LiTT
            </button>
            <ul>{FILTERS.concat(menu).map((item) => <li key={item.label}>{item.label}</li>)}</ul>
            <button type="button" onClick={save}>{t("demo.files.save")}</button>
        </section>
    );
}

export const EmptyFiles = () => {
    const t = useTranslations();
    return (
    <p>{t("demo.files.nothingHereYet")}</p>
);
};
