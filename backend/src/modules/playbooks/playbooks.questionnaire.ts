// LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Starting
// a playbook with questions"): the ten fixed questions a draft starts from.
// They are product text, not legal content: no rule, position or law ships
// with LiTT. Every question is optional.

import { PlaybookRequestError } from "./playbooks.operations";

export const PLAYBOOK_QUESTION_IDS = [
  "q1",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q7",
  "q8",
  "q9",
  "q10",
] as const;

export type PlaybookQuestionId = (typeof PLAYBOOK_QUESTION_IDS)[number];

export type PlaybookQuestion = {
  id: PlaybookQuestionId;
  text: string;
  help?: string;
};

/** The answered questions only, trimmed; a question left blank is absent. */
export type PlaybookAnswers = Partial<Record<PlaybookQuestionId, string>>;

export const MAX_PLAYBOOK_ANSWER_CHARS = 4_000;
export const MAX_PLAYBOOK_ANSWERS_CHARS = 30_000;
/** Clauses the client prefers (question 8), as .docx or .pdf. */
export const MAX_PLAYBOOK_DRAFT_ATTACHMENTS = 5;

export const PLAYBOOK_QUESTIONS: readonly PlaybookQuestion[] = [
  {
    id: "q1",
    text: "¿A quién representas y quién es la contraparte típica?",
  },
  {
    id: "q2",
    text: "Giro y tamaño del cliente, y regulación de su sector (financiero, salud, datos personales, gobierno…).",
  },
  {
    id: "q3",
    text: "Tipo de documento: arrendamiento, servicios, NDA, compraventa, suministro, laboral…",
  },
  {
    id: "q4",
    text: "Jurisdicción y ley aplicable; si acepta arbitraje y en qué sede.",
  },
  {
    id: "q5",
    text: "Apetito de riesgo: conservador, equilibrado o flexible.",
  },
  {
    id: "q6",
    text: "Líneas rojas: lo que este cliente nunca acepta.",
  },
  {
    id: "q7",
    text: "Lo que sí puede ceder en una negociación.",
  },
  {
    id: "q8",
    text: "Cláusulas o redacciones preferidas del cliente; se pueden adjuntar.",
    help: `Puedes adjuntar hasta ${MAX_PLAYBOOK_DRAFT_ATTACHMENTS} documentos .docx o .pdf.`,
  },
  {
    id: "q9",
    text: "Antecedentes: conflictos pasados, relación con la contraparte y lo que salió mal antes.",
  },
  {
    id: "q10",
    text: "Idioma, moneda y formato de firma.",
  },
];

/** What GET /playbooks/questionnaire answers with. */
export function playbookQuestionnaire() {
  return {
    questions: PLAYBOOK_QUESTIONS,
    maxAnswerChars: MAX_PLAYBOOK_ANSWER_CHARS,
    maxAnswersChars: MAX_PLAYBOOK_ANSWERS_CHARS,
    maxAttachments: MAX_PLAYBOOK_DRAFT_ATTACHMENTS,
  };
}

const KNOWN = new Set<string>(PLAYBOOK_QUESTION_IDS);

/**
 * The answers a draft is asked for. Only known question ids, each a string;
 * blank answers count as unanswered. Absent answers are valid: every
 * question is optional, and a draft with none is all "general practice".
 */
export function parseAnswers(raw: unknown): PlaybookAnswers {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new PlaybookRequestError(
      "Las respuestas deben enviarse como un objeto por pregunta.",
    );
  const answers: PlaybookAnswers = {};
  let total = 0;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN.has(id))
      throw new PlaybookRequestError(`La pregunta «${id.slice(0, 20)}» no existe.`);
    if (value === undefined || value === null) continue;
    if (typeof value !== "string")
      throw new PlaybookRequestError("Cada respuesta debe ser texto.");
    const answer = value.trim();
    if (!answer) continue;
    if (answer.length > MAX_PLAYBOOK_ANSWER_CHARS)
      throw new PlaybookRequestError(
        `Cada respuesta admite hasta ${MAX_PLAYBOOK_ANSWER_CHARS.toLocaleString("es-MX")} caracteres.`,
      );
    total += answer.length;
    answers[id as PlaybookQuestionId] = answer;
  }
  if (total > MAX_PLAYBOOK_ANSWERS_CHARS)
    throw new PlaybookRequestError(
      `Las respuestas suman más de ${MAX_PLAYBOOK_ANSWERS_CHARS.toLocaleString("es-MX")} caracteres. Acórtalas.`,
    );
  return answers;
}
