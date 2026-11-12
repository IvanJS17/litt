import Link from "next/link";
import { pillButtonUIClassName } from "@mike/ui";
import { useTranslations } from "next-intl";

export default function NotFound() {
    const t = useTranslations();
    return (
        <div className="min-h-screen bg-white flex items-center justify-center px-4">
            <div className="text-center max-w-md">
                <h1 className="text-3xl font-eb-garamond font-light text-gray-900 mb-3">
                    {t("errors.page.pageNotFound")}
                </h1>
                <p className="text-[0.9375rem] text-gray-500 leading-relaxed mb-8">
                    {t("errors.page.thePageYoureLookingForDoesnt")}
                </p>

                <Link
                    href="/"
                    className={pillButtonUIClassName({
                        tone: "black",
                        size: "normal",
                    })}
                >
                    {t("errors.page.goHome")}
                </Link>
            </div>
        </div>
    );
}
