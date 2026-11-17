import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { accessFormHref } from "./landingConstants";
import {
    LANDING_BUTTON_PRIMARY,
    LANDING_BUTTON_SECONDARY,
    LANDING_BUTTON_SIZE,
    LANDING_BUTTON_SIZE_SM,
} from "./landingStyles";

/** Where the main button goes: the app when a session cookie is present, the login otherwise. */
export function primaryHref(signedIn: boolean): string {
    return signedIn ? "/assistant" : "/login";
}

/**
 * The page's one main action: "Iniciar sesión" for a visitor, "Abrir LiTT" for
 * someone with a session. `signedIn` comes from the server (lib/sessionHint.ts),
 * so the label is in the HTML and never changes after paint.
 */
export function PrimaryButton({
    signedIn,
    small = false,
    className,
    ...rest
}: {
    signedIn: boolean;
    small?: boolean;
    className?: string;
} & Omit<React.ComponentProps<typeof Link>, "href" | "children" | "className">) {
    const t = useTranslations();
    return (
        <Link
            {...rest}
            href={primaryHref(signedIn)}
            className={[
                LANDING_BUTTON_PRIMARY,
                small ? LANDING_BUTTON_SIZE_SM : LANDING_BUTTON_SIZE,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {signedIn ? t("landing.cta.open") : t("landing.cta.login")}
        </Link>
    );
}

/** "Solicitar acceso": the beta is by invitation, so access is asked for in the questionnaire. */
export function RequestAccessButton({
    className,
    onClick,
}: {
    className?: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
    const t = useTranslations();
    const locale = useLocale();
    return (
        <a
            href={accessFormHref("acceso", locale)}
            rel="noopener noreferrer"
            onClick={onClick}
            className={[LANDING_BUTTON_SECONDARY, LANDING_BUTTON_SIZE, className].filter(Boolean).join(" ")}
        >
            {t("landing.cta.request")}
        </a>
    );
}

/** The pair under the hero and under CUARTO, always in this order. */
export function CtaPair({ signedIn, id }: { signedIn: boolean; id?: string }) {
    return (
        <div id={id} className="flex flex-wrap items-center gap-3">
            <PrimaryButton signedIn={signedIn} />
            <RequestAccessButton />
        </div>
    );
}
