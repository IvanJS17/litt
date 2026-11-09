import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

const LINK_CLASS = "font-medium underline transition-colors hover:text-gray-950";

/** Renders a legal.* message whose <terms> and <privacy> tags become links. */
export function LegalLinks({ message }: { message: "notice" | "intro" | "signupLine" }) {
    const t = useTranslations("legal");
    return (
        <>
            {t.rich(message, {
                terms: (chunks: ReactNode) => (
                    <Link href="/terminos" target="_blank" className={LINK_CLASS}>
                        {chunks}
                    </Link>
                ),
                privacy: (chunks: ReactNode) => (
                    <Link href="/privacidad" target="_blank" className={LINK_CLASS}>
                        {chunks}
                    </Link>
                ),
            })}
        </>
    );
}

/** "By continuing you accept the Terms and the Privacy Notice", under auth forms. */
export function LegalNotice() {
    return (
        <p className="mt-1 text-center text-xs leading-4 text-gray-500 [@media(min-height:701px)]:mt-4">
            <LegalLinks message="notice" />
        </p>
    );
}
