// The firm's criteria in a trainee's turn (docs/training.md, "One mold of
// criterion"): the assistant may consult what people of the firm wrote
// (list_firm_criteria) and is told how to present positions.
//
// Like every training behavior it can only narrow the turn: the text asks the
// model for more care and the tool only reads, with the caller's own
// membership. A person with no stage gets neither.

import type { TrainingStage } from "@mike/contracts";
import type { TrainingTurnPlan } from "./types";

/**
 * Appended to the system prompt of a trainee's turn. In Spanish, like the
 * other prompts of the server; the model answers in the user's language.
 */
export const FIRM_CRITERIA_ADDENDUM = `QUIEN ESCRIBE ESTÁ EN FORMACIÓN. Reglas para este turno:
- Si el asunto admite más de una postura razonable, preséntalas todas. No declares una como la única.
- Distingue lo documentado (los documentos del asunto y los criterios del despacho que traiga list_firm_criteria) de lo que sabes de memoria. Marca lo de memoria como «sin verificar» e invita a confirmarlo en la fuente oficial.
- Puedes consultar list_firm_criteria cuando el planteamiento toque una materia o un tema sobre el que el despacho pudo escribir una postura. Atribuye cada criterio a su autor tal como lo devuelve la herramienta («según …») y di que es una postura del despacho, no derecho vigente ni la única postura.
- Nunca inventes un criterio, un voto particular, un autor ni una fecha que la herramienta no devolvió. Si no devuelve nada, dilo.`;

/** What the plan of a turn gains from the firm's criteria; null without a stage or an organization. */
export function firmCriteriaPlan(
    stage: TrainingStage | null,
    orgId: string | null,
): { systemAddendum: string; firmCriteriaOrgId: string } | null {
    if (!stage || !orgId) return null;
    return { systemAddendum: FIRM_CRITERIA_ADDENDUM, firmCriteriaOrgId: orgId };
}

/** The plan with the firm's criteria added: after any addendum another behavior set. */
export function withFirmCriteria(
    plan: TrainingTurnPlan,
    stage: TrainingStage | null,
    orgId: string | null,
): TrainingTurnPlan {
    const gained = firmCriteriaPlan(stage, orgId);
    if (!gained) return plan;
    return {
        ...plan,
        systemAddendum: plan.systemAddendum ? `${plan.systemAddendum}\n\n${gained.systemAddendum}` : gained.systemAddendum,
        toolPolicy: { ...plan.toolPolicy, firmCriteriaOrgId: gained.firmCriteriaOrgId },
    };
}
