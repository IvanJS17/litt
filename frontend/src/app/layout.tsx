import type { Metadata } from "next";
// Self-hosted Inter and EB Garamond; sets --font-inter and --font-eb-garamond.
import "./fonts/fonts.css";
import "./globals.css";
import { Providers } from "@/app/components/providers";
import { THEME_BOOT_SCRIPT } from "@/app/lib/theme";

export const metadata: Metadata = {
    // LiTT's public address (deploy/prod/README.md). MikeOSS, the upstream,
    // is credited in the README.
    metadataBase: new URL("https://litt.asteroitt.com"),
    title: "LiTT - Legal AI Platform",
    description:
        "AI-powered legal document analysis and contract review platform.",
    icons: {
        icon: [
            { url: "/icon.svg", type: "image/svg+xml" },
            { url: "/favicon.ico" },
        ],
        apple: "/apple-touch-icon.png",
    },
    openGraph: {
        type: "website",
        url: "https://litt.asteroitt.com",
        siteName: "LiTT",
        title: "LiTT - Legal AI Platform",
        description:
            "AI-powered legal document analysis and contract review platform.",
        images: [
            {
                url: "/link-image.jpg",
                width: 1200,
                height: 651,
                alt: "LiTT",
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: "LiTT - Legal AI Platform",
        description:
            "AI-powered legal document analysis and contract review platform.",
        images: ["/link-image.jpg"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        // The boot script may add `dark` and color-scheme to <html> before
        // React hydrates it; that difference is intended.
        <html lang="en" suppressHydrationWarning>
            <head>
                <script
                    dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
                />
            </head>
            <body
                className="font-sans antialiased"
            >
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
