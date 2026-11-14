"use client";

import { FirmKeysLink, useKeyScope } from "@/app/components/settings/KeyScope";
import { WebSearchSection } from "@/app/components/settings/WebSearchSection";

export default function WebSearchPage() {
    const { personalBlocked } = useKeyScope("web_search");
    return (
        <div className="space-y-6">
            <WebSearchSection />
            {personalBlocked ? <FirmKeysLink /> : null}
        </div>
    );
}
