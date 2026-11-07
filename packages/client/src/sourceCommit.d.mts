export declare const SOURCE_REPOSITORY_URL: string;

export declare function sourceCodeUrl(
    commit: string | null | undefined,
): string | null;

export declare function resolveSourceCommit(options: {
    explicit: string | undefined;
    production: boolean;
    readGitHead: () => string;
}): string;
