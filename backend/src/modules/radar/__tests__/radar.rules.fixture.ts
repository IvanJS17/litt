import type { ObligationRuleDef } from "../radar.rules";

// A FIXTURE to exercise validation. It is not legal content and is not part of the catalog.
export const fixture: ObligationRuleDef = {
  code: "fixture.notice",
  version: 1,
  nameKey: "radar.rules.title",
  appliesWhenKey: "radar.rules.description",
  anchorKey: "radar.rules.countsFrom",
  anchorName: "fecha_ejemplo",
  kind: "deadline",
  milestones: [{ kind: "due", ops: [{ unit: "months", amount: -2 }] }],
  requiresBusinessDays: false,
  citations: [{ sourceCode: "LEY", law: "Ley de ejemplo", location: "Artículo 1", text: "Texto de ejemplo.", url: "https://example.gob.mx/ley", lastReform: "DOF 20-10-2023" }],
  consultedOn: "2026-11-17",
  verification: { status: "verified", verifiedBy: "socium-legal", verifiedOn: "2026-11-17" },
};
