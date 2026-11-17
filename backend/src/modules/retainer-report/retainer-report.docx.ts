/**
 * The report as a Word file: the same numbers as the screen, written as
 * Markdown and turned into DOCX by the repository's own converter
 * (lib/markdownDocx). Text a person typed (a request's title, a fact's label,
 * a type's name) is escaped, so it can never become Markdown structure.
 */

import type { RetainerReport } from "@mike/contracts";
import { markdownToDocx } from "../../lib/markdownDocx";
import { labelsFor, type ReportLabels } from "./retainer-report.labels";

/** Text typed by a person, safe inside a Markdown paragraph or table cell. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_{}\[\]<>()#+\-!|~]/g, (char) => `\\${char}`);
}

const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");
}

function requestRows(report: RetainerReport, labels: ReportLabels, kind: "closed" | "open") {
  const items = report.requests[kind];
  const head =
    kind === "closed"
      ? [labels.colRequest, labels.type, labels.colComplexity, labels.colReceived, labels.colClosed, labels.colDays, labels.colRounds]
      : [labels.colRequest, labels.type, labels.colComplexity, labels.colStatus, labels.colReceived, labels.colDaysOpen, labels.colRounds];
  const rows = items.map((request) => {
    const common = [
      escapeMarkdown(request.title),
      escapeMarkdown(labels.typeName(request.seed_key, request.type_name)),
      labels.complexity[request.complexity],
    ];
    return kind === "closed"
      ? [...common, request.received_on, request.closed_on ?? "", String(request.calendar_days), String(request.rounds)]
      : [...common, labels.status[request.status], request.received_on, String(request.calendar_days), String(request.rounds)];
  });
  return table(head, rows);
}

/** The report in Markdown, in the report's language. */
export function reportMarkdown(report: RetainerReport): string {
  const labels = labelsFor(report.locale);
  const out: string[] = [];
  out.push(`# ${labels.title}`);
  if (report.matter_name) out.push(`**${labels.matter}:** ${escapeMarkdown(report.matter_name)}`);
  out.push(labels.period(labels.date(report.period.start), labels.date(report.period.end), report.period.days));
  out.push(`**${escapeMarkdown(labels.disclaimer)}**`);
  out.push(escapeMarkdown(labels.scopeNote));

  const { requests } = report;
  out.push(`## ${labels.requestsHeading}`);
  if (requests.total === 0) {
    out.push(labels.noRequests);
  } else {
    out.push(labels.requestsTotal(requests.total));
    out.push(`### ${labels.byType}`);
    out.push(
      table(
        [labels.type, labels.count],
        requests.by_type.map((entry) => [escapeMarkdown(labels.typeName(entry.seed_key, entry.name)), String(entry.count)]),
      ),
    );
    out.push(`### ${labels.byComplexity}`);
    out.push(
      table(
        [labels.colComplexity, labels.count],
        (Object.keys(requests.by_complexity) as (keyof typeof requests.by_complexity)[]).map((key) => [
          labels.complexity[key],
          String(requests.by_complexity[key]),
        ]),
      ),
    );
    out.push(`### ${labels.byLevel}`);
    out.push(
      table(
        [labels.colLevel, labels.count],
        (Object.keys(requests.by_level) as (keyof typeof requests.by_level)[]).map((key) => [
          key === "unassigned" ? labels.unassigned : labels.level[key],
          String(requests.by_level[key]),
        ]),
      ),
    );
    out.push(`### ${labels.byStatus}`);
    out.push(
      table(
        [labels.colStatus, labels.count],
        (Object.keys(requests.by_status) as (keyof typeof requests.by_status)[]).map((key) => [
          labels.status[key],
          String(requests.by_status[key]),
        ]),
      ),
    );
  }

  out.push(`## ${labels.closedHeading}`);
  if (requests.closed.length === 0) {
    out.push(labels.noneClosed);
  } else {
    const average = requests.closed_average_calendar_days;
    out.push(labels.closedSummary(requests.closed.length, requests.closed_rounds_total, average === null ? null : String(average)));
    out.push(requestRows(report, labels, "closed"));
  }

  out.push(`## ${labels.openHeading}`);
  out.push(requests.open.length === 0 ? labels.noneOpen : requestRows(report, labels, "open"));

  out.push(`## ${labels.profileHeading}`);
  out.push(labels.profileTotal(report.profile.confirmed_total));
  out.push(`### ${labels.profileChanged}`);
  out.push(
    report.profile.confirmed_in_period.length === 0
      ? labels.noProfileChanges
      : table(
          [labels.colFact, labels.colKind, labels.colConfirmed],
          report.profile.confirmed_in_period.map((fact) => [
            escapeMarkdown(fact.label),
            labels.kind[fact.kind],
            fact.confirmed_on,
          ]),
        ),
  );

  out.push(`## ${labels.radarHeading}`);
  out.push(labels.radarIntro(labels.date(report.horizon.start), labels.date(report.horizon.end)));
  out.push(
    report.radar.upcoming.length === 0
      ? labels.noRadar
      : table(
          [labels.colDate, labels.colItem, labels.colWhen],
          report.radar.upcoming.map((item) => [
            item.due_on,
            `${escapeMarkdown(item.label)} (${labels.radarType[item.type]})`,
            item.days_left === 0 ? labels.today : labels.inDays(item.days_left),
          ]),
        ),
  );
  out.push(`*${escapeMarkdown(labels.disclaimer)}*`);
  out.push(`*${escapeMarkdown(labels.scopeNote)}*`);
  return out.join("\n\n") + "\n";
}

export function reportDocx(report: RetainerReport): Promise<Buffer> {
  return markdownToDocx(reportMarkdown(report));
}

/** `reporte-iguala-2026-11-17.docx` / `retainer-report-2026-11-17.docx`. */
export function reportFilename(report: RetainerReport): string {
  const stem = report.locale === "es-MX" ? "reporte-iguala" : "retainer-report";
  return `${stem}-${report.period.end}.docx`;
}
