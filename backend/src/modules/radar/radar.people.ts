import type { ProfilePerson } from "@mike/contracts";
import { loadCreatorProfiles } from "../../lib/userLookup";
import type { Db } from "../../lib/supabase";

/** The people the radar names (who acted, who turned a rule on or off), by id, once each. */
export async function namePeople(db: Db, userIds: readonly (string | null)[]): Promise<ProfilePerson[]> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  const profiles = await loadCreatorProfiles(db, ids.map((user_id) => ({ user_id })));
  return ids.map((user_id) => {
    const profile = profiles.get(user_id);
    return { user_id, name: profile?.display_name ?? profile?.email ?? null };
  });
}
