"use client";

import { BackingSection } from "../criterion/BackingSection";
import { MentorCriteriaContrasts } from "../contrast/MentorCriteriaContrasts";
import { MentorCriterionMap } from "../map/MentorCriterionMap";
import { MentorReadings } from "../reading/MentorReadings";
import { MentorReviewAudits } from "../reviewAudit/MentorReviewAudits";

// The «Criterio» tab of the mentor panel (docs/training.md, layer 3): a
// container of sections, one per piece of evidence about how a pupil builds
// their own criterion. To add a section, import it and render it below with
// the same two props; the section carries its own heading, loading state and
// failure message, so this file holds no logic. Every section reads only the
// pupil's current mentor's view and shows counts or the pupil's own words:
// no score, average or comparison between pupils.

export function CriterionTab({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    return (
        <div className="min-w-0 space-y-8">
            <MentorCriterionMap orgId={orgId} pupilId={pupilId} />
            <BackingSection orgId={orgId} traineeId={pupilId} />
            <MentorReviewAudits orgId={orgId} pupilId={pupilId} />
            <MentorReadings orgId={orgId} pupilId={pupilId} />
            <MentorCriteriaContrasts orgId={orgId} pupilId={pupilId} />
        </div>
    );
}
