/**
 * The words of the report document, in the two languages LiTT ships. The
 * screen translates through packages/i18n; the Word file is written by the
 * backend, so it carries its own small table. Wording that mentions time spent
 * does not belong here: the report counts requests and calendar days.
 */

import type {
  MatterRequestComplexity,
  MatterRequestLevel,
  MatterRequestStatus,
  MatterRequestTypeSeed,
  ProfileFactKind,
  RadarItem,
  RetainerReportLocale,
} from "@mike/contracts";

export type ReportLabels = {
  title: string;
  matter: string;
  period: (start: string, end: string, days: number) => string;
  disclaimer: string;
  /** Said right after the disclaimer, in the report only. */
  scopeNote: string;
  requestsHeading: string;
  requestsTotal: (count: number) => string;
  noRequests: string;
  byType: string;
  byComplexity: string;
  byLevel: string;
  byStatus: string;
  unassigned: string;
  type: string;
  count: string;
  closedHeading: string;
  closedSummary: (count: number, rounds: number, average: string | null) => string;
  openHeading: string;
  noneClosed: string;
  noneOpen: string;
  colRequest: string;
  colComplexity: string;
  colStatus: string;
  colReceived: string;
  colClosed: string;
  colDays: string;
  colDaysOpen: string;
  colRounds: string;
  colLevel: string;
  profileHeading: string;
  profileTotal: (count: number) => string;
  profileChanged: string;
  noProfileChanges: string;
  colFact: string;
  colKind: string;
  colConfirmed: string;
  radarHeading: string;
  radarIntro: (from: string, to: string) => string;
  noRadar: string;
  colDate: string;
  colItem: string;
  colWhen: string;
  inDays: (count: number) => string;
  today: string;
  typeName: (seed: MatterRequestTypeSeed | null, name: string | null) => string;
  complexity: Record<MatterRequestComplexity, string>;
  level: Record<MatterRequestLevel, string>;
  status: Record<MatterRequestStatus, string>;
  kind: Record<ProfileFactKind, string>;
  radarType: Record<RadarItem["type"], string>;
  /** A date in the language's long form. */
  date: (iso: string) => string;
};

const longDate = (locale: RetainerReportLocale) => (iso: string) =>
  new Intl.DateTimeFormat(locale, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

const es: ReportLabels = {
  title: "Reporte de la iguala",
  matter: "Asunto",
  period: (start, end, days) => `Periodo: del ${start} al ${end} (${days} días naturales).`,
  disclaimer:
    "Ayuda de planeación. La fecha no es un término legal y LiTT no calcula términos procesales.",
  scopeNote:
    "Solo incluye los datos que el despacho confirmó en los documentos revisados; puede haber vencimientos que no aparezcan.",
  requestsHeading: "Solicitudes atendidas",
  requestsTotal: (count) => `Solicitudes del periodo (recibidas, cerradas o abiertas al cierre): ${count}.`,
  noRequests: "No hubo solicitudes en este periodo.",
  byType: "Por tipo",
  byComplexity: "Por complejidad",
  byLevel: "Por nivel de quien atendió",
  byStatus: "Por estado",
  unassigned: "Sin asignar",
  type: "Tipo",
  count: "Solicitudes",
  closedHeading: "Solicitudes cerradas en el periodo",
  closedSummary: (count, rounds, average) =>
    `Cerradas: ${count}. Rondas de negociación: ${rounds}.${average ? ` Promedio de días naturales hasta el cierre: ${average}.` : ""}`,
  openHeading: "Solicitudes abiertas",
  noneClosed: "Ninguna solicitud se cerró en este periodo.",
  noneOpen: "No hay solicitudes abiertas.",
  colRequest: "Solicitud",
  colComplexity: "Complejidad",
  colStatus: "Estado",
  colReceived: "Recibida",
  colClosed: "Cerrada",
  colDays: "Días naturales",
  colDaysOpen: "Días abierta",
  colRounds: "Rondas",
  colLevel: "Nivel",
  profileHeading: "Ficha del cliente",
  profileTotal: (count) => `Datos confirmados vigentes en la ficha: ${count}.`,
  profileChanged: "Datos confirmados en el periodo",
  noProfileChanges: "No se confirmaron datos nuevos en este periodo.",
  colFact: "Dato",
  colKind: "Clase",
  colConfirmed: "Confirmado el",
  radarHeading: "Próximos vencimientos",
  radarIntro: (from, to) => `Fechas confirmadas entre el ${from} y el ${to}.`,
  noRadar: "No hay vencimientos confirmados en este periodo.",
  colDate: "Fecha",
  colItem: "Vencimiento",
  colWhen: "Faltan",
  inDays: (count) => (count === 1 ? "1 día" : `${count} días`),
  today: "Hoy",
  typeName: (seed, name) =>
    name ??
    ({
      contracts_clients: "Contratos con clientes",
      contracts_suppliers: "Contratos con proveedores",
      intellectual_property: "Propiedad intelectual",
      shareholder_meetings: "Asambleas",
      corporate_books: "Libros corporativos",
      other: "Otra",
    } as Record<string, string>)[seed ?? "other"] ??
    "Otra",
  complexity: { routine: "Rutinaria", standard: "Estándar", complex: "Compleja" },
  level: { apprentice: "Pasante", junior: "Junior", senior: "Sénior", partner: "Socio" },
  status: {
    received: "Recibida",
    in_review: "En revisión",
    with_client: "Con el cliente",
    with_counterparty: "Con la contraparte",
    closed: "Firmada o cerrada",
    cancelled: "Cancelada",
  },
  kind: { contract: "Contrato", date: "Fecha", power_of_attorney: "Poder", obligation: "Obligación", other: "Otro" },
  radarType: { expiry: "Vencimiento", notice: "Último día para avisar", power_expiry: "Vencimiento del poder" },
  date: longDate("es-MX"),
};

const en: ReportLabels = {
  title: "Retainer report",
  matter: "Matter",
  period: (start, end, days) => `Period: ${start} to ${end} (${days} calendar days).`,
  disclaimer: "Planning aid. The date is not a legal deadline and LiTT does not calculate procedural deadlines.",
  scopeNote:
    "It only includes the facts the firm confirmed in the documents it reviewed; some deadlines may not appear.",
  requestsHeading: "Requests handled",
  requestsTotal: (count) => `Requests in the period (received, closed or still open at its end): ${count}.`,
  noRequests: "There were no requests in this period.",
  byType: "By type",
  byComplexity: "By complexity",
  byLevel: "By level of who handled them",
  byStatus: "By state",
  unassigned: "Unassigned",
  type: "Type",
  count: "Requests",
  closedHeading: "Requests closed in the period",
  closedSummary: (count, rounds, average) =>
    `Closed: ${count}. Negotiation rounds: ${rounds}.${average ? ` Average calendar days to close: ${average}.` : ""}`,
  openHeading: "Open requests",
  noneClosed: "No request was closed in this period.",
  noneOpen: "There are no open requests.",
  colRequest: "Request",
  colComplexity: "Complexity",
  colStatus: "State",
  colReceived: "Received",
  colClosed: "Closed",
  colDays: "Calendar days",
  colDaysOpen: "Days open",
  colRounds: "Rounds",
  colLevel: "Level",
  profileHeading: "Client profile",
  profileTotal: (count) => `Confirmed facts currently in the profile: ${count}.`,
  profileChanged: "Facts confirmed in the period",
  noProfileChanges: "No new facts were confirmed in this period.",
  colFact: "Fact",
  colKind: "Kind",
  colConfirmed: "Confirmed on",
  radarHeading: "Upcoming deadlines",
  radarIntro: (from, to) => `Confirmed dates between ${from} and ${to}.`,
  noRadar: "There are no confirmed deadlines in this period.",
  colDate: "Date",
  colItem: "Deadline",
  colWhen: "In",
  inDays: (count) => (count === 1 ? "1 day" : `${count} days`),
  today: "Today",
  typeName: (seed, name) =>
    name ??
    ({
      contracts_clients: "Contracts with clients",
      contracts_suppliers: "Contracts with suppliers",
      intellectual_property: "Intellectual property",
      shareholder_meetings: "Shareholder meetings",
      corporate_books: "Corporate books",
      other: "Other",
    } as Record<string, string>)[seed ?? "other"] ??
    "Other",
  complexity: { routine: "Routine", standard: "Standard", complex: "Complex" },
  level: { apprentice: "Apprentice", junior: "Junior", senior: "Senior", partner: "Partner" },
  status: {
    received: "Received",
    in_review: "In review",
    with_client: "With the client",
    with_counterparty: "With the counterparty",
    closed: "Signed or closed",
    cancelled: "Cancelled",
  },
  kind: { contract: "Contract", date: "Date", power_of_attorney: "Power of attorney", obligation: "Obligation", other: "Other" },
  radarType: { expiry: "Expiry", notice: "Last day to give notice", power_expiry: "Power of attorney expiry" },
  date: longDate("en-US"),
};

const TABLE: Record<RetainerReportLocale, ReportLabels> = { "es-MX": es, "en-US": en };

export const labelsFor = (locale: RetainerReportLocale): ReportLabels => TABLE[locale];
