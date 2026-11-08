// Express routers for the periodic full reading (LiTT training layer 3,
// docs/training.md).
//
//   /training/me/readings
//       GET ?org_id=                  my readings and whether one is due
//       POST {org_id}                 start the due reading (or the open one)
//       GET  /:id/document            the text to read, without the assistant
//       POST /:id/swap                another document, once
//       PUT  /:id/findings            what I found, written once
//       POST /:id/compare             the machine's reading, then the comparison
//   /orgs/:orgId/training/pupils/:userId/readings
//       GET                           my pupil's readings (current mentor only)
//
// Thin handlers: parse, call the facade, map the ServiceResult.

import type { TrainingReadingCompareBody } from "@mike/contracts";
import { Router, type Request, type Response } from "express";
import { sendServiceFailure, type ServiceResult } from "../../lib/serviceResult";
import { createServerSupabase } from "../../lib/supabase";
import { asyncRoute, routerErrorHandler } from "../../middleware/asyncRoute";
import { requireAuth } from "../../middleware/auth";
import {
    compareReading,
    getMyReadings,
    getReadingDocument,
    listPupilReadings,
    startReading,
    submitFindings,
    swapReading,
} from "./trainingFullReading.service";

function send<T>(res: Response, result: ServiceResult<T>, status = 200) {
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(status).json(result.data);
}

const person = (res: Response) => ({
    userId: res.locals.userId as string,
    userEmail: (res.locals.userEmail as string | undefined) ?? null,
});

/** Mounted at /training. */
export const trainingReadingsRouter = Router();

trainingReadingsRouter.get("/me/readings", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getMyReadings(createServerSupabase(), { userId: res.locals.userId as string, orgId: req.query.org_id }));
}));

trainingReadingsRouter.post("/me/readings", requireAuth, asyncRoute(async (req, res) => {
    const result = await startReading(createServerSupabase(), {
        ...person(res),
        orgId: (req.body as { org_id?: unknown } | undefined)?.org_id,
    });
    if (!result.ok) return void sendServiceFailure(res, result);
    res.status(result.data.created ? 201 : 200).json(result.data.reading);
}));

trainingReadingsRouter.get("/me/readings/:readingId/document", requireAuth, asyncRoute(async (req, res) => {
    send(res, await getReadingDocument(createServerSupabase(), { ...person(res), readingId: req.params.readingId }));
}));

trainingReadingsRouter.post("/me/readings/:readingId/swap", requireAuth, asyncRoute(async (req, res) => {
    send(res, await swapReading(createServerSupabase(), { ...person(res), readingId: req.params.readingId }));
}));

trainingReadingsRouter.put("/me/readings/:readingId/findings", requireAuth, asyncRoute(async (req, res) => {
    send(res, await submitFindings(createServerSupabase(), {
        ...person(res),
        readingId: req.params.readingId,
        body: req.body,
    }));
}));

trainingReadingsRouter.post("/me/readings/:readingId/compare", requireAuth, asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as TrainingReadingCompareBody;
    send(res, await compareReading(createServerSupabase(), {
        ...person(res),
        readingId: req.params.readingId,
        credentialRef: body.credential_ref,
    }));
}));

trainingReadingsRouter.use(routerErrorHandler("[training-full-reading]"));

/** Mounted at /orgs/:orgId/training/pupils/:userId/readings. */
export const pupilReadingsRouter = Router({ mergeParams: true });

pupilReadingsRouter.get("/", requireAuth, asyncRoute(async (req: Request, res) => {
    send(res, await listPupilReadings(createServerSupabase(), {
        actorId: res.locals.userId as string,
        actorEmail: (res.locals.userEmail as string | undefined) ?? null,
        orgId: String(req.params.orgId),
        traineeId: String(req.params.userId),
    }));
}));

pupilReadingsRouter.use(routerErrorHandler("[training-full-reading]"));
