import type { RadarBucket, RadarItem } from "@mike/contracts";

export const REASON_MAX = 500;

/** The groups of the radar page, in the order they are shown. */
export const GROUPS = ["overdue", "next_30", "later", "review"] as const satisfies readonly RadarBucket[];
export type RadarGroup = (typeof GROUPS)[number] | "closed";

const alive = (item: RadarItem) => item.state === "open" || item.state === "acknowledged";

/** Alive items by bucket (already ordered by the server), then the handled ones. */
export function groupItems(items: readonly RadarItem[]): [RadarGroup, RadarItem[]][] {
  const groups: [RadarGroup, RadarItem[]][] = GROUPS.map((group) => [
    group,
    items.filter((item) => alive(item) && item.bucket === group),
  ]);
  groups.push(["closed", items.filter((item) => !alive(item))]);
  return groups.filter(([, list]) => list.length > 0);
}

export const radarHref = (projectId: string, matterId: string) =>
  `/projects/${encodeURIComponent(projectId)}/matters/${encodeURIComponent(matterId)}/radar`;
export const profileHref = (projectId: string, matterId: string) =>
  `/projects/${encodeURIComponent(projectId)}/matters/${encodeURIComponent(matterId)}/profile`;
