import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { resolveSourceCommit } from "./src/shared/lib/sourceCommit.mjs";

const nextConfig: NextConfig = {
    /* config options here */
    reactCompiler: true,
    typescript: {
        // `next build` type-checks this program instead of tsconfig.json. It
        // excludes test files, so the production image (built from an
        // allowlisted Docker context, see Dockerfile) never depends on test
        // fixtures or sibling apps. Tests are type-checked by `npm run
        // typecheck` (tsc over tsconfig.json) in CI instead.
        tsconfigPath: "tsconfig.build.json",
    },
    turbopack: {
        root: __dirname,
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
    return { ...nextConfig, env: { LITT_SOURCE_COMMIT: sourceCommit } };
}
