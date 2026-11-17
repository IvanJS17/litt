import { describe, expect, it } from "vitest";
import { suggestedLevel } from "../requests.assignees";
import { isIsoDate, parseCreate, parsePatch, today } from "../requests.shared";

const TYPE = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";

describe("request input", () => {
  it("trims the title and keeps the assignee with its level", () => {
    const parsed = parseCreate({
      title: "  Contrato  ",
      type_id: TYPE,
      complexity: "routine",
      assignee_user_id: USER,
      assignee_level: "senior",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "Contrato",
        typeId: TYPE,
        complexity: "routine",
        receivedOn: null,
        assigneeUserId: USER,
        assigneeLevel: "senior",
      },
    });
  });

  it("refuses an assignee without a level, a level without an assignee and unknown words", () => {
    const base = { title: "x", type_id: TYPE, complexity: "routine" };
    expect(parseCreate({ ...base, assignee_user_id: USER }).ok).toBe(false);
    expect(parseCreate({ ...base, assignee_level: "senior" }).ok).toBe(false);
    expect(parseCreate({ ...base, complexity: "easy" }).ok).toBe(false);
    expect(parseCreate({ ...base, title: "x".repeat(161) }).ok).toBe(false);
    expect(parseCreate(null).ok).toBe(false);
  });

  it("parses only the known fields of a change and never time fields", () => {
    expect(parsePatch({ version: 3, status: "closed", closed_on: "2026-11-09" })).toEqual({
      ok: true,
      value: { version: 3, status: "closed", closedOn: "2026-11-09" },
    });
    expect(parsePatch({ version: 3, assignee_user_id: null })).toEqual({
      ok: true,
      value: { version: 3, assignee: { userId: null, level: null } },
    });
    for (const extra of [{ hours: 2 }, { estimate_minutes: 30 }, { matter_id: TYPE }, { created_by: USER }])
      expect(parsePatch({ version: 1, ...extra }).ok).toBe(false);
    expect(parsePatch({ status: "closed" }).ok).toBe(false);
  });

  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("02/11/2026")).toBe(false);
  });

  it("dates today where the firms are, not in UTC", () => {
    // 03:30 UTC on 2026-11-17 is still the evening of the 16th in Mexico City.
    expect(today(new Date("2026-11-17T03:30:00Z"))).toBe("2026-11-16");
    expect(today(new Date("2026-11-17T12:00:00Z"))).toBe("2026-11-17");
  });
});

describe("suggested cost level", () => {
  it("reads the training stage before the organization role", () => {
    expect(suggestedLevel("pasante", "owner")).toBe("apprentice");
    expect(suggestedLevel("junior", "admin")).toBe("junior");
    expect(suggestedLevel(null, "owner")).toBe("partner");
    expect(suggestedLevel(null, "admin")).toBe("senior");
    expect(suggestedLevel(null, "member")).toBeNull();
  });
});
