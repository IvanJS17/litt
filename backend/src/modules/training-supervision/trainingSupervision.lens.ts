// A pupil's evidence is read through the eyes of the viewer (their current
// mentor): the practice area of a matter and whether they may open it, each
// asked once per matter.

import type { Db } from "../../lib/supabase";
import { projectPractice } from "../../lib/training";
import { judgeWork, openMatters, workKey, type WorkRef, type WorkSight } from "../../lib/trainingWork";

export type Viewer = { orgId: string; traineeId: string; actorId: string; actorEmail: string | null };

/** A project's practice area, memoized; whether the viewer may open it. */
export function projectLens(db: Db, viewer: Viewer) {
    const practices = new Map<string, Promise<string | null>>();
    const access = new Map<string, Promise<boolean>>();
    const sights = new Map<string, Promise<WorkSight>>();
    return {
        /** The place of a work and whether the viewer may see it (a chat's work is judged once). */
        work(work: WorkRef) {
            if (!sights.has(workKey(work))) sights.set(workKey(work), judgeWork(db, work, viewer));
            return sights.get(workKey(work)) as Promise<WorkSight>;
        },
        practice(projectId: string | null) {
            if (!projectId) return Promise.resolve(null);
            if (!practices.has(projectId)) practices.set(projectId, projectPractice(db, projectId));
            return practices.get(projectId) as Promise<string | null>;
        },
        mayOpen(projectId: string | null) {
            if (!projectId) return Promise.resolve(true);
            if (!access.has(projectId))
                access.set(
                    projectId,
                    openMatters(db, viewer, [projectId]).then((opened) => opened.has(projectId)),
                );
            return access.get(projectId) as Promise<boolean>;
        },
    };
}
