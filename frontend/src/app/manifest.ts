import type { MetadataRoute } from "next";

/**
 * "Add to Home Screen": LiTT opens as its own full-screen app, on the
 * assistant. The colours are the brand's papel and tinta. There is no
 * service worker, so the app has no offline mode: it needs a connection, as
 * the site does. Icons are the ones already in /public and the app folder.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "LiTT",
        short_name: "LiTT",
        description: "LiTT",
        start_url: "/assistant",
        scope: "/",
        display: "standalone",
        background_color: "#ECECE6",
        theme_color: "#ECECE6",
        icons: [
            { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
    };
}
