import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../../__tests__/helpers/linearCost";
import {
  normalizeWorkflowName,
  workflowNameFromSkillMd,
} from "../workflows.name";

describe("normalizeWorkflowName", () => {
  it("accepts lowercase workflow names", () => {
    expect(normalizeWorkflowName(" contract-intake ")).toBe(
      "contract-intake",
    );
  });

  it("rejects invalid workflow names", () => {
    expect(normalizeWorkflowName("/contract-intake")).toBeNull();
    expect(normalizeWorkflowName("Contract Intake")).toBeNull();
  });
});

describe("workflowNameFromSkillMd", () => {
  it("reads name from skill frontmatter", () => {
    expect(
      workflowNameFromSkillMd(`---
name: contract-intake
metadata:
  mike-display-name: "Contract Intake"
---
# Contract Intake`),
    ).toBe("contract-intake");
  });

  it("ignores a name nested inside metadata", () => {
    expect(
      workflowNameFromSkillMd(`---
metadata:
  name: contract-intake
  mike-display-name: "Contract Intake"
---`),
    ).toBeNull();
  });
});

describe("workflowNameFromSkillMd on long stored text", () => {
    it("reads a long name line in linear time", () => {
        // Cubic cost: the sizes stay small enough to measure before the bound.
        expectLinearCost((n) => workflowNameFromSkillMd(`---\nname:${" ".repeat(n)}a\rb\n---\nbody`), { small: 48, large: 1_536 });
        expect(workflowNameFromSkillMd(`---\nname:${" ".repeat(12_000)}a\rb\n---\nbody`)).toBeNull();
    });
    it("reads an unclosed header and a long body in linear time", () => {
        expectLinearCost((n) => workflowNameFromSkillMd("---\nname: a\n" + "- x\n".repeat(n)), { small: 400, large: 12_000 });
        expectLinearCost((n) => workflowNameFromSkillMd("---\nname: a\n---\n" + "x".repeat(n)), { small: 2_000, large: 64_000 });
    });
    it("reads the name from the first lines of a header longer than the bound", () => {
        const long = (before: string, after: string) => `---\n${before}description: ${"x".repeat(100_000)}\n${after}---\nbody`;
        expect(workflowNameFromSkillMd(long("name: kept\n", ""))).toBe("kept");
        expect(workflowNameFromSkillMd(long("name: kept\n", "name: later\n"))).toBe("kept");
        // A name past the bound is not looked for, and nothing fails.
        expect(workflowNameFromSkillMd(long("", "name: late\n"))).toBeNull();
        expect(workflowNameFromSkillMd("---\nname: kept\n---\n" + "x".repeat(2_000_000))).toBe("kept");
    });
    it("still gives no name for a header that never closes", () => {
        expect(workflowNameFromSkillMd("---\nname: kept\n" + "x".repeat(100_000))).toBeNull();
    });
    it("gives the same name as before for ordinary headers", () => {
        const name = (line: string) => workflowNameFromSkillMd(`---\n${line}\n---\nbody`);
        expect(name("name: contract-intake")).toBe("contract-intake");
        expect(name('name: "contract-intake"')).toBe("contract-intake");
        expect(name("name: 'contract-intake'")).toBe("contract-intake");
        expect(name("name:   contract-intake \t ")).toBe("contract-intake");
        expect(name("name:contract-intake")).toBe("contract-intake");
        expect(name("name: Contract Intake")).toBeNull();
        expect(name("name:")).toBeNull();
        expect(name("description: x\nname: a-b")).toBe("a-b");
        expect(name("name: a\u2028b\nname: later")).toBe("later");
        expect(workflowNameFromSkillMd("---\r\nname: crlf-name\r\n---\r\nbody")).toBe("crlf-name");
        expect(workflowNameFromSkillMd("name: a\n")).toBeNull();
        expect(workflowNameFromSkillMd(null)).toBeNull();
    });
});
