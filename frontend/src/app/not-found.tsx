import Link from "next/link";
import { authGlassCardUIClassName, pillButtonUIClassName } from "@mike/ui";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { useTranslations } from "next-intl";
import { pageTitle } from "@/app/lib/pageTitle";

export const generateMetadata = pageTitle("notFound");

export default function NotFound() {
    const t = useTranslations();
    return (
        <AuthPageShell withLocaleSwitcher={false}>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    <h2 className="font-serif text-2xl font-medium text-gray-950">
                        {t("errors.page.pageNotFound")}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                        {t("errors.page.thePageYoureLookingForDoesnt")}
                    </p>
                    <Link
                        href="/"
                        className={pillButtonUIClassName({
                            tone: "black",
                            size: "normal",
                            className: "mt-6",
                        })}
                    >
                        {t("errors.page.goHome")}
                    </Link>
                </div>
            </div>
        </AuthPageShell>
    );
}
