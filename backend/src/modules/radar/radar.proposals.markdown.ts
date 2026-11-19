/**
 * The Markdown file a lawyer takes to legal (S8b, docs/obligation-rules.md,
 * "Rule proposals"). THE FORMAT LIVES IN THIS ONE FILE: legal asked for these
 * columns in this order (board t_2bf126c1), and a change of format is a change
 * here and nothing else. Pure: no database, no clock (the caller passes the
 * time).
 *
 * What the file never does: invent a code, a name or a "when it applies" (they
 * are «por llenar» for legal to write), mark anything as verified (`estado` is
 * always `propuesta`), or normalize the quote (it goes as stored, because a
 * script compares it with the official text; only `\`, `|` and line breaks
 * are escaped so the table holds and the rendered cell reads as stored).
 */

export const EXPORT_LEGEND =
  "Borrador sin verificar. No se puede usar hasta que legal lo verifique y se agregue al catálogo. La cita se comprobó solo contra el texto subido, no contra la fuente oficial. El plazo lo propuso la IA y no está verificado.";
export const TO_FILL = "por llenar";
export const TERM_PREFIX = "Sin verificar: ";
export const NO_VALUE = "—";

export const EXPORT_COLUMNS = [
  "#",
  "id_propuesta",
  "codigo",
  "Obligación propuesta (IA)",
  "Cuándo aplica",
  "Dato de partida (IA)",
  "Plazo propuesto (borrador, sin verificar)",
  "Cita literal (texto subido)",
  "Ley y artículo (según el texto subido)",
  "Pág.",
  "URL oficial",
  "Última reforma DOF",
  "estado",
  "Notas de legal",
] as const;

export type ExportProposal = {
  id: string;
  law: string;
  article: string;
  obligation: string;
  anchorName: string;
  plazoPropuesto: string | null;
  quote: string;
  page: number | null;
  /** Where the text came from: one table per source. */
  source: {
    documentName: string | null;
    versionNumber: number | null;
    versionId: string;
    textSha256: string;
    provider: string;
    model: string;
  };
};

export type ExportContext = {
  projectName: string;
  /** The moment of the export, ISO 8601. */
  exportedAt: string;
};

/**
 * A cell of a table. A backslash is escaped first, then `|`, then line breaks
 * become `<br>`: rendered, the cell reads exactly the stored text, and a `\|`
 * in a quote cannot end the cell early. Nothing else is touched.
 */
export function cell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, "<br>");
}

const header = (title: string) => `\n## ${title}\n`;

function row(index: number, proposal: ExportProposal): string {
  const cells = [
    String(index),
    `\`${proposal.id}\``,
    TO_FILL,
    cell(proposal.obligation),
    TO_FILL,
    cell(proposal.anchorName),
    proposal.plazoPropuesto === null ? NO_VALUE : cell(`${TERM_PREFIX}${proposal.plazoPropuesto}`),
    `**${cell(proposal.article)}:** «${cell(proposal.quote)}»`,
    cell(`${proposal.law} — ${proposal.article}`),
    proposal.page === null ? NO_VALUE : String(proposal.page),
    TO_FILL,
    TO_FILL,
    "propuesta",
    TO_FILL,
  ];
  return `| ${cells.join(" | ")} |`;
}

/** The file name: `propuestas-reglas-<proyecto>-<AAAAMMDD>.md`, ASCII and safe in a header. */
export function exportFileName(projectName: string, exportedAt: string): string {
  const slug =
    projectName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "proyecto";
  // The firm's calendar day, not UTC: an export at 19:00 in Mexico City is still today.
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(exportedAt));
  return `propuestas-reglas-${slug}-${day.replace(/-/g, "")}.md`;
}

export function renderProposalsMarkdown(proposals: readonly ExportProposal[], context: ExportContext): string {
  const lines: string[] = [
    "# LiTT · Propuestas de reglas nuevas (borrador para legal)",
    "",
    `> **${EXPORT_LEGEND}**`,
    "",
    `- Exportado: ${context.exportedAt}`,
    `- Proyecto: ${context.projectName}`,
    `- Número de propuestas: ${proposals.length}`,
    "- Solo propuestas enviadas a legal y no descartadas. No incluye reglas del catálogo ni datos de clientes.",
  ];
  const sources = new Map<string, ExportProposal[]>();
  for (const proposal of proposals) {
    const key = [proposal.source.versionId, proposal.source.textSha256, proposal.source.provider, proposal.source.model].join("\u0000");
    sources.set(key, [...(sources.get(key) ?? []), proposal]);
  }
  let index = 0;
  for (const group of sources.values()) {
    const { source } = group[0];
    lines.push(
      header(`Texto fuente: ${source.documentName ?? "(sin nombre)"}, versión ${source.versionNumber ?? "—"}`),
      `- Documento: ${source.documentName ?? "(sin nombre)"}`,
      `- Versión: ${source.versionNumber ?? "—"}`,
      `- text_sha256: \`${source.textSha256}\``,
      `- Proveedor y modelo: ${source.provider} / ${source.model}`,
      `- Propuestas de este texto: ${group.length}`,
      "",
      `| ${EXPORT_COLUMNS.join(" | ")} |`,
      `|${EXPORT_COLUMNS.map(() => "---").join("|")}|`,
      ...group.map((proposal) => row((index += 1), proposal)),
    );
  }
  return `${lines.join("\n")}\n`;
}
