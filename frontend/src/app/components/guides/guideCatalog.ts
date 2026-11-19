import type { TrainingMembership, TrainingStage } from "@mike/contracts";

/**
 * The guide catalog (`guides.<id>.*` in the interface catalog): one entry per
 * feature, plus the two role guides. `FeatureGuideModal` renders any of them,
 * so a guide is added with its texts and its id here, never with a component.
 */
export const FEATURE_GUIDE_IDS = [
    "chat",
    "projects_documents",
    "tabular_review",
    "playbooks_workflows",
    "donna_requests",
    "donna_client_profile",
    "donna_radar",
    "donna_retainer_report",
    "training",
    "connected_apps_mcp",
    "model_selector",
] as const;

export const ROLE_GUIDE_IDS = ["pupil", "mentor"] as const;

export type FeatureGuideId = (typeof FEATURE_GUIDE_IDS)[number];
export type RoleGuideId = (typeof ROLE_GUIDE_IDS)[number];
export type GuideId = FeatureGuideId | RoleGuideId;

export const GUIDE_IDS: readonly GuideId[] = [...FEATURE_GUIDE_IDS, ...ROLE_GUIDE_IDS];

export type GuideSection = { heading: string; body?: string; items: string[] };
export type GuideTab = { id: TrainingStage; label: string; body: string };
export type GuideContent = {
    title: string;
    summary: string;
    sections: GuideSection[];
    tabsLabel?: string;
    tabs: GuideTab[];
};

type Bag = Record<string, unknown>;
const values = (bag: unknown): unknown[] =>
    bag && typeof bag === "object" ? Object.values(bag as Bag) : [];

/**
 * The catalog keeps lists as numbered objects (`s1`, `i1`…: the message
 * loader does not carry arrays), so a guide is read back into lists here.
 */
export function parseGuide(raw: unknown): GuideContent {
    const guide = (raw ?? {}) as Bag;
    const tabs = Object.entries((guide.tabs ?? {}) as Bag).map(([id, tab]) => ({
        id: id as TrainingStage,
        label: String((tab as Bag).label ?? id),
        body: String((tab as Bag).body ?? ""),
    }));
    return {
        title: String(guide.title ?? ""),
        summary: String(guide.summary ?? ""),
        tabsLabel: typeof guide.tabsLabel === "string" ? guide.tabsLabel : undefined,
        tabs,
        sections: values(guide.sections).map((section) => {
            const s = section as Bag;
            return {
                heading: String(s.heading ?? ""),
                body: typeof s.body === "string" ? s.body : undefined,
                items: values(s.items).map(String),
            };
        }),
    };
}

/**
 * The stage a guide for training opens on: «pasante» if the person is a
 * pasante anywhere (the stricter rules), else «junior»; null when they have
 * no stage (a lawyer, or not in training).
 */
export function stageFromMemberships(
    memberships: readonly TrainingMembership[],
): TrainingStage | null {
    const stages = memberships.flatMap((m) => (m.mentor_user_id === null ? [] : m.stages.map((s) => s.stage)));
    if (stages.includes("pasante")) return "pasante";
    return stages.includes("junior") ? "junior" : null;
}
