"use client";

import { useEffect } from "react";

/**
 * Lands a link such as /terminos#5-5 on its clause. The legal text streams in
 * a Suspense segment that stays hidden until React reveals it, and when that
 * happens after the page's `load` event the browser has already given up on
 * the fragment: the reader is left at the top. This runs once the text is in
 * place and scrolls to the target only when the page never moved and the
 * target is out of view, so a reader who already scrolled is left alone.
 */
export function LegalFragmentScroll() {
    useEffect(() => {
        const hash = window.location.hash.slice(1);
        if (!hash || window.scrollY !== 0) return;
        let id = hash;
        try {
            id = decodeURIComponent(hash);
        } catch {
            // A malformed escape is looked up as written.
        }
        const target = document.getElementById(id);
        if (!target) return;
        const { top, bottom } = target.getBoundingClientRect();
        if (bottom > 0 && top < window.innerHeight) return;
        target.scrollIntoView({ block: "start" });
    }, []);
    return null;
}
