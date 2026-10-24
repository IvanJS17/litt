import fs from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PublicationIntent } from "./sharedContracts";

// The Record is exhaustive at typecheck time: SQL cannot invent another
// publication vocabulary or silently omit an outcome in the shared contract.
const outcomes: Record<PublicationIntent["outcome"], true> = {
  pending: true,
  uploaded: true,
  unknown_outcome: true,
  reconciled: true,
  failed: true,
};

describe("persistent publication shared contract", () => {
  // The custom LiTT migration series is retired (S1): the only schema of
  // record is `backend/schema.sql` plus the runner's ledger.
  for (const file of ["schema.sql"]) {
    it(`${file} admits exactly PublicationIntent outcomes`, () => {
      const sql = fs.readFileSync(
        resolve(process.cwd(), file),
        "utf8",
      );
      const constraint = sql.match(
        /constraint ai_review_drive_publications_state_check check\s*\(\s*status in\s*\(([^)]+)\)/,
      )?.[1];
      expect(constraint).toBeDefined();
      const actual = [...constraint!.matchAll(/'([^']+)'/g)]
        .map((match) => match[1])
        .sort();
      expect(actual).toEqual(Object.keys(outcomes).sort());
    });
  }
});
