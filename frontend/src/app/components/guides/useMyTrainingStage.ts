"use client";

import { useEffect, useState } from "react";
import type { TrainingMembership, TrainingStage } from "@mike/contracts";
import { getMyTraining } from "@/app/lib/mikeApi";
import { stageFromMemberships } from "./guideCatalog";

export type MyTrainingStage = {
    loaded: boolean;
    /** The stage guides open on; null for a lawyer without a stage. */
    stage: TrainingStage | null;
    /** Where the person is a mentor (the mentor guide is offered there). */
    isMentor: boolean;
    memberships: TrainingMembership[];
};

/**
 * «Si estás en formación»: the person's stage from `GET /training/me`, with
 * no new endpoint. A failed read shows nothing extra (the guides stay as for
 * a lawyer); it never blocks the screen it sits on.
 */
export function useMyTrainingStage(enabled = true): MyTrainingStage {
    const [state, setState] = useState<{ done: boolean; memberships: TrainingMembership[] }>({
        done: false,
        memberships: [],
    });
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        getMyTraining().then(
            (memberships) => {
                if (!cancelled) setState({ done: true, memberships });
            },
            () => {
                if (!cancelled) setState({ done: true, memberships: [] });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [enabled]);
    return {
        loaded: state.done,
        stage: stageFromMemberships(state.memberships),
        isMentor: state.memberships.some((m) => m.is_mentor),
        memberships: state.memberships,
    };
}
