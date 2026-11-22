import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { vi, type MockInstance } from "vitest";

/**
 * A spy on the `jsonrepair` package, to count how often the repair is called.
 * The package is read with `require` and its function taken when a module
 * loads, so call this BEFORE loading the module under test (`vi.resetModules()`
 * and a dynamic `import`), and restore the spy after the test.
 */
export function spyOnJsonrepair(): MockInstance<(text: string) => string> {
    const load = createRequire(join(__dirname, "jsonrepairCalls.ts"));
    const inner = load(join(dirname(load.resolve("jsonrepair")), "regular", "jsonrepair.js")) as { jsonrepair: (text: string) => string };
    return vi.spyOn(inner, "jsonrepair");
}
