import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Direct access grants are keyed by normalized email, so they follow the
// address, not the account. handle_user_email_updated used to update only the
// user_profiles mirror: an address change stranded every project / chat /
// tabular-review / workflow share on the old address, and whoever registered
// that address next inherited them. This pins the migration that moves them
// and keeps the fresh-install schema in step with it (no database needed).

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MIGRATION_NAME = "20261022_01_recovery_email_change_moves_grants.sql";
const MIGRATION_PATH = path.join(BACKEND_DIR, "migrations", MIGRATION_NAME);
const SCHEMA_PATH = path.join(BACKEND_DIR, "schema.sql");

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function functionSql(sql: string): string {
  const match = sql.match(
    /create\s+or\s+replace\s+function\s+public\.handle_user_email_updated\s*\(\)[\s\S]*?\$\$;/i,
  );
  return match?.[0] ?? "";
}

const migration = readIfExists(MIGRATION_PATH);
const schema = readIfExists(SCHEMA_PATH);
const migrationFunction = functionSql(migration);
const schemaFunction = functionSql(schema);

describe("email change moves email-keyed grants", () => {
  it("ships as one collision-free dated migration", () => {
    expect(migration).not.toBe("");
    expect(migration).toMatch(/^-- Migration date: 2026-10-22\b/m);
    expect(path.basename(MIGRATION_NAME)).toMatch(/^20261022_\d{2}_recovery_/);
    const stem = MIGRATION_NAME.slice(0, 11);
    const colliding = fs
      .readdirSync(path.join(BACKEND_DIR, "migrations"))
      .filter(
        (name) =>
          name.endsWith(".sql") &&
          name !== MIGRATION_NAME &&
          name.slice(0, 11) === stem,
      );
    expect(colliding).toEqual([]);
  });

  it("defines the same trigger function in migration and fresh schema", () => {
    expect(migrationFunction).not.toBe("");
    expect(schemaFunction).toBe(migrationFunction);
  });

  it("moves every email-keyed grant table, not just the profile mirror", () => {
    for (const sql of [migrationFunction, schemaFunction]) {
      expect(sql).toMatch(/update\s+public\.user_profiles/i);
      expect(sql).toMatch(
        /update\s+public\.project_access_grants[\s\S]*set\s+email\s*=\s*new_email/i,
      );
      expect(sql).toMatch(
        /update\s+public\.chat_access_grants[\s\S]*set\s+email\s*=\s*new_email/i,
      );
      expect(sql).toMatch(
        /update\s+public\.tabular_review_access_grants[\s\S]*set\s+email\s*=\s*new_email/i,
      );
      expect(sql).toMatch(
        /update\s+public\.workflow_shares[\s\S]*set\s+shared_with_email\s*=\s*new_email/i,
      );
    }
  });

  it("keeps the stronger role when both addresses already hold a grant", () => {
    for (const sql of [migrationFunction, schemaFunction]) {
      expect(sql).toMatch(/case\s+moved\.role\s+when\s+'owner'\s+then\s+2/i);
      expect(sql).toMatch(/case\s+kept\.role\s+when\s+'owner'\s+then\s+2/i);
      // workflow_shares has no role ladder in LiTT: editing survives if either
      // address could edit.
      expect(sql).toMatch(
        /set\s+allow_edit\s*=\s*kept\.allow_edit\s+or\s+moved\.allow_edit/i,
      );
    }
  });

  it("moves the legacy email arrays the overview RPCs still read", () => {
    for (const sql of [migrationFunction, schemaFunction]) {
      expect(sql).toMatch(
        /update\s+public\.projects[\s\S]*shared_with\s*-\s*old_email/i,
      );
      expect(sql).toMatch(
        /update\s+public\.tabular_reviews[\s\S]*shared_with\s*-\s*old_email/i,
      );
      expect(sql).toMatch(/jsonb_agg\(distinct value\)/i);
    }
  });

  it("drops grants instead of stranding them when the new address is empty", () => {
    for (const sql of [migrationFunction, schemaFunction]) {
      expect(sql).toMatch(/if\s+new_email\s*=\s*''\s+then/i);
      expect(sql).toMatch(
        /delete\s+from\s+public\.project_access_grants\s+where\s+email\s*=\s*old_email/i,
      );
    }
  });

  it("recreates the auth.users trigger idempotently", () => {
    for (const sql of [migration, schema]) {
      expect(sql).toMatch(
        /drop\s+trigger\s+if\s+exists\s+on_auth_user_email_updated\s+on\s+auth\.users/i,
      );
      expect(sql).toMatch(
        /create\s+trigger\s+on_auth_user_email_updated\s+after\s+update\s+of\s+email\s+on\s+auth\.users/i,
      );
      expect(sql).toMatch(/old\.email\s+is\s+distinct\s+from\s+new\.email/i);
    }
  });

  it("keeps the function hardened to a definer-owned public search_path", () => {
    for (const sql of [migrationFunction, schemaFunction]) {
      expect(sql).toMatch(/security\s+definer/i);
      expect(sql).toMatch(/set\s+search_path\s*=\s*public/i);
      expect(sql).not.toMatch(/set\s+search_path\s*=\s*public\s*,/i);
    }
  });
});
