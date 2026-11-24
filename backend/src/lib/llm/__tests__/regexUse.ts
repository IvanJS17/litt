import { vi } from "vitest";

/**
 * A wildcard between two searched parts: tried again from every occurrence of
 * the first part, so the time grows with the square of the text. Written as
 * the source text of a pattern: `[\s\S]*`, `.*`, `.+`, `[^x]*`, or a run of
 * whitespace after a line break (`\n\s*`). A bounded gap such as `[^x]{0,200}` is not one.
 */
export const UNBOUNDED_WILDCARD =
  /\[\\s\\S\][*+]|(?<!\\)\.[*+]|\[\^[^\]]*\][*+]|\\n\)?\\s[*+]/;

/** The source of every pattern run (`test` or `exec`) while `run` executes. */
export function patternsApplied(run: () => void): string[] {
  const sources: string[] = [];
  const test = RegExp.prototype.test;
  const exec = RegExp.prototype.exec;
  const testSpy = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
    sources.push(this.source);
    return test.call(this, value);
  });
  const execSpy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (this: RegExp, value: string) {
    sources.push(this.source);
    return exec.call(this, value);
  });
  try {
    run();
  } finally {
    testSpy.mockRestore();
    execSpy.mockRestore();
  }
  return sources;
}
