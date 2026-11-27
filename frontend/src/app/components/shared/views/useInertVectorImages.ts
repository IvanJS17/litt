import { useEffect, type RefObject } from "react";

/**
 * Largest vector image part shown. Its data URL is about a third larger than
 * the bytes; 8 MiB of bytes stays under the 32 MB data URL limit of the most
 * restrictive supported browser (Firefox) and far above ordinary drawings.
 */
export const VECTOR_IMAGE_BYTE_LIMIT = 8 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;
// A transparent pixel stands in for a vector image that is too large or unreadable.
const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const VECTOR_TYPE = "image/svg+xml";
const RASTER = Symbol("raster");

async function toDataUrl(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${VECTOR_TYPE};base64,${btoa(binary)}`;
}

/**
 * What an object URL holds. Only a declared image type that is not a vector
 * image keeps its object URL; a vector image (declared, or any other type with
 * an svg root) is shown from a data URL; anything else is not shown.
 */
async function kindOf(blob: Blob): Promise<"raster" | "vector" | "other"> {
    const type = blob.type.split(";")[0].trim().toLowerCase();
    if (type === VECTOR_TYPE) return "vector";
    if (type.startsWith("image/")) return "raster";
    const start = new TextDecoder().decode(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
    return /<svg[\s>/]/i.test(start) ? "vector" : "other";
}

/** The source to show instead of `url`, or RASTER when the image is left alone. */
async function inertSource(url: string): Promise<string | typeof RASTER> {
    try {
        const blob = await (await fetch(url)).blob();
        const kind = await kindOf(blob);
        if (kind === "raster") return RASTER;
        if (kind === "other" || blob.size > VECTOR_IMAGE_BYTE_LIMIT) return PLACEHOLDER;
        return await toDataUrl(blob);
    } catch {
        return PLACEHOLDER;
    }
}

/**
 * Vector images of a Word file are shown from a `data:` URL rather than an
 * object URL of the application's origin, and an object URL stays only on a
 * declared raster image type. The library paints the image first; its source
 * is replaced after one read of its bytes. Only what the page shows changes:
 * the editor's own document and its saved bytes are untouched, and the
 * library's object URLs are neither revoked nor replaced at their source.
 */
export function useInertVectorImages(host: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const element = host.current;
        if (!element) return;
        let active = true;
        const known = new Map<string, string | typeof RASTER>();
        const pending = new Map<string, Promise<string | typeof RASTER>>();
        const apply = (image: HTMLImageElement, url: string, source: string | typeof RASTER) => {
            if (source !== RASTER && active && image.getAttribute("src") === url) image.setAttribute("src", source);
        };
        const inspect = (image: HTMLImageElement) => {
            const url = image.getAttribute("src");
            if (!url?.startsWith("blob:")) return;
            if (known.has(url)) return apply(image, url, known.get(url)!);
            let read = pending.get(url);
            if (!read) {
                read = inertSource(url).then((source) => {
                    known.set(url, source);
                    pending.delete(url);
                    return source;
                });
                pending.set(url, read);
            }
            void read.then((source) => apply(image, url, source));
        };
        const scan = (node: Node) => {
            if (!(node instanceof Element)) return;
            if (node instanceof HTMLImageElement) inspect(node);
            node.querySelectorAll("img").forEach(inspect);
        };
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === "attributes" && record.target instanceof HTMLImageElement) inspect(record.target);
                else record.addedNodes.forEach(scan);
            }
        });
        observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
        scan(element);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [host]);
}
