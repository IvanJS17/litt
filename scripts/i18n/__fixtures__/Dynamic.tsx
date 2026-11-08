import { KEY } from "./keys";

export function Dynamic({ status, ns, count }: { status: string; ns: string; count: number }) {
    const t = useTranslations("demo.files");
    const scoped = useTranslations(ns);
    return (
        <div>
            <p>{t("readyToGo")}</p>
            <p>{t(`status.${status}`)}</p>
            <p>{t(KEY, { count })}</p>
            <p>{t.rich("rich." + status, { b: (c) => <b>{c}</b> })}</p>
            <p>{t.markup(status)}</p>
            <p>{scoped("anything")}</p>
        </div>
    );
}
