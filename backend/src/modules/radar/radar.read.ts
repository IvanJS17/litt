import type { MatterRadar } from "@mike/contracts";
import type { ServiceResult } from "../../lib/serviceResult";
import { internalFailure } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { authorizeMatterMember } from "../matters/matters.service";
import { loadMatterRadar } from "./radar.items";

/** The radar of a matter, for any active member of it. */
export async function getMatterRadar(
  db: Db,
  actor: { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown; now?: Date },
): Promise<ServiceResult<MatterRadar>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    return await loadMatterRadar(db, access.data, actor.now ?? new Date());
  } catch (error) {
    return internalFailure(error);
  }
}
