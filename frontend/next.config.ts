import { execFileSync } from "node:child_process";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import createNextIntlPlugin from "next-intl/plugin";
import { resolveSourceCommit } from "@mike/client";

// The repository root: the parent of this directory, here and in the Docker
// image (frontend/Dockerfile mirrors the layout at /app/frontend and
// /app/packages). The shared packages the app imports, @mike/ui and
// @mike/client (packages/ui, packages/client), live there.
const REPO_ROOT = path.resolve(__dirname, "..");

// next-intl reads the request's locale and catalog from this file
// (cookie, then Accept-Language, then es-MX). See src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
    /* config options here */
    reactCompiler: true,
    // The production image (frontend/Dockerfile) sets NEXT_OUTPUT=standalone
    // so it ships only the traced server files, not the full dependency tree.
    // `next start` (e2e, local) keeps the default output.
    ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
    typescript: {
        // `next build` type-checks this program instead of tsconfig.json. It
        // excludes test files, so the production image (built from an
        // allowlisted Docker context, see Dockerfile) never depends on test
        // fixtures or sibling apps. Tests are type-checked by `npm run
        // typecheck` (tsc over tsconfig.json) in CI instead.
        tsconfigPath: "tsconfig.build.json",
    },
    turbopack: {
        // Turbopack resolves nothing outside its root, and Next uses the same
        // directory as outputFileTracingRoot (the two must agree). The root
        // is therefore the repository, so the tsconfig `paths` aliases for the
        // shared packages resolve; standalone output nests under frontend/.
        root: REPO_ROOT,
    },
    experimental: {
        // Webpack builds (`next build --webpack`) transpile only files under
        // this directory unless told otherwise; the shared packages live one
        // level up.
        externalDir: true,
    },
    webpack: (config) => {
        // The shared packages have no node_modules of their own. A bare import
        // from a file under packages/ walks up to the repository root and never
        // reaches this directory's node_modules, so add it as the fallback
        // (word-addin/webpack.config.js does the same for the add-in).
        config.resolve.modules = [
            ...(config.resolve.modules ?? ["node_modules"]),
            path.join(__dirname, "node_modules"),
        ];
        return config;
    },
    async rewrites() {
        return [
            {
                source: "/sitemap.xml",
                destination: "/api/sitemap/sitemap.xml",
            },
            {
                source: "/sitemap_:slug.xml",
                destination: "/api/sitemap/sitemap_:slug.xml",
            },
        ];
    },
    async redirects() {
        return [
            {
                source: "/account",
                destination: "/settings",
                permanent: true,
            },
            {
                source: "/account/:path*",
                destination: "/settings/:path*",
                permanent: true,
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default function config(phase: string): NextConfig {
    // AGPL-3.0 §13: the commit this build serves, inlined for the "Código
    // fuente" link. `next build` fails without GIT_SHA; `next dev` falls back
    // to the checkout's HEAD.
    const sourceCommit = resolveSourceCommit({
        explicit: process.env.GIT_SHA,
        production: phase === PHASE_PRODUCTION_BUILD,
        readGitHead: () =>
            execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: __dirname,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }),
    });
    return withNextIntl({ ...nextConfig, env: { LITT_SOURCE_COMMIT: sourceCommit } });
}
