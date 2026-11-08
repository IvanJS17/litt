// Express routers for LiTT training layer 3 «Criterio» (docs/training.md).
//
//   /orgs/:orgId/training/pupils/:userId/notes
//       PUT /:noteId/verdict     the pupil's current mentor corrects a verdict
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import { Router } from "express";
import { sendServiceFailure } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import { overrideNoteVerdict } from "./trainingCriterion.service";

/** Mounted at /orgs/:orgId/training/pupils/:userId/notes. */
export const pupilNotesRouter = Router({ mergeParams: true });

pupilNotesRouter.put("/:noteId/verdict", requireAuth, asyncRoute(async (req, res) => {
    const result = await overrideNoteVerdict(createServerSupabase(), {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: req.params.orgId,
        traineeId: req.params.userId,
        noteId: req.params.noteId,
        body: req.body,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.json(result.data);
}));

pupilNotesRouter.use(routerErrorHandler("[training-criterion]"));
