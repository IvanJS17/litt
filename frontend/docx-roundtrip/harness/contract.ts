// What the test page exposes on window for Playwright (shared by the page and the spec).
export type Harness = {
    load(bytes: number[]): Promise<{ parseError: unknown }>;
    save(): Promise<number[]>;
    replaceText(find: string, text: string): boolean;
};

declare global {
    interface Window {
        harness: Harness;
    }
}
