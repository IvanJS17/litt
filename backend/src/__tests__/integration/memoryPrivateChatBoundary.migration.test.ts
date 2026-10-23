import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// App memory is private to one user. The old
// memory_source_allows_app_memory(surface, project) answered "eligible" for a
// standalone chat with no project, without asking who owns the conversation,
// so a chat shared through chat_access_grants could teach the owner's private
// memory with a colleague's words. This pins the conversation-and-actor form
// in both the migration and the fresh schema (no database needed).

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MIGRATION_NAME = "20261022_02_recovery_memory_private_chat_boundary.sql";
const MIGRATION_PATH = path.join(BACKEND_DIR, "migrations", MIGRATION_NAME);
const SCHEMA_PATH = path.join(BACKEND_DIR, "schema.sql");

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function functionSql(sql: string, name: string): string {
  const match = sql.match(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  return match?.[0] ?? "";
}

const migration = readIfExists(MIGRATION_PATH);
const schema = readIfExists(SCHEMA_PATH);

const APP_MEMORY = "memory_source_allows_app_memory";
const PROJECT_PRIVATE = "memory_project_is_private";
const migrationAppMemory = functionSql(migration, APP_MEMORY);
const schemaAppMemory = functionSql(schema, APP_MEMORY);
const migrationProjectPrivate = functionSql(migration, PROJECT_PRIVATE);
const schemaProjectPrivate = functionSql(schema, PROJECT_PRIVATE);

describe("private-chat boundary for app memory", () => {
  it("ships as one collision-free dated migration", () => {
    expect(migration).not.toBe("");
    expect(migration).toMatch(/^-- Migration date: 2026-10-22\b/m);
    expect(MIGRATION_NAME).toMatch(/^20261022_02_recovery_/);
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

  it("replaces the project-only signature instead of overloading it", () => {
    expect(migration).toMatch(
      /drop\s+function\s+if\s+exists\s+public\.memory_source_allows_app_memory\s*\(\s*text\s*,\s*uuid\s*\)\s*;/i,
    );
    // A stale two-argument definition would keep the shared-chat hole alive.
    expect(schema).not.toMatch(
      /function\s+public\.memory_source_allows_app_memory\s*\(\s*p_surface\s+text\s*,\s*p_project_id\s+uuid\s*\)/i,
    );
    expect(migrationAppMemory).toMatch(
      /p_surface\s+text\s*,\s*p_conversation_id\s+uuid\s*,\s*p_actor_user_id\s+uuid\s*,\s*p_project_id\s+uuid/i,
    );
  });

  it("defines the same functions in migration and fresh schema", () => {
    expect(migrationProjectPrivate).not.toBe("");
    expect(schemaProjectPrivate).toBe(migrationProjectPrivate);
    expect(migrationAppMemory).not.toBe("");
    expect(schemaAppMemory).toBe(migrationAppMemory);
  });

  it("moves the project test into memory_project_is_private", () => {
    for (const sql of [migrationProjectPrivate, schemaProjectPrivate]) {
      expect(sql).toMatch(/from\s+public\.projects\s+project/i);
      expect(sql).toMatch(/project\.org_id\s+is\s+null/i);
      expect(sql).toMatch(/from\s+public\.project_access_grants/i);
    }
  });

  it("decides chat eligibility from the conversation owner, org and grants", () => {
    for (const sql of [migrationAppMemory, schemaAppMemory]) {
      expect(sql).toMatch(
        /from\s+public\.chats\s+chat[\s\S]*chat\.id\s*=\s*p_conversation_id[\s\S]*chat\.user_id\s*=\s*p_actor_user_id[\s\S]*chat\.org_id\s+is\s+null/i,
      );
      expect(sql).toMatch(
        /from\s+public\.chat_access_grants\s+grant_row[\s\S]*grant_row\.chat_id\s*=\s*chat\.id/i,
      );
      // The project verdict is no longer enough on its own: a project-less
      // chat is eligible only when the conversation itself is private.
      expect(sql).not.toMatch(
        /when\s+p_surface\s*=\s*'chat'\s+and\s+p_project_id\s+is\s+null\s+then\s+true/i,
      );
      expect(sql).toMatch(
        /p_project_id\s+is\s+null\s+or\s+public\.memory_project_is_private\s*\(\s*p_project_id\s*\)/i,
      );
    }
  });

  it("applies the same three tests to tabular reviews", () => {
    for (const sql of [migrationAppMemory, schemaAppMemory]) {
      expect(sql).toMatch(
        /from\s+public\.tabular_review_chats\s+chat[\s\S]*join\s+public\.tabular_reviews\s+review/i,
      );
      expect(sql).toMatch(/review\.user_id\s*=\s*p_actor_user_id/i);
      expect(sql).toMatch(/review\.org_id\s+is\s+null/i);
      expect(sql).toMatch(
        /from\s+public\.tabular_review_access_grants\s+grant_row[\s\S]*grant_row\.tabular_review_id\s*=\s*review\.id/i,
      );
      expect(sql).toMatch(/when\s+p_surface\s*=\s*'tabular'\s+then\s*p_project_id\s+is\s+not\s+null/i);
      // Chat and tabular each ask the project verdict exactly once.
      expect(
        sql.match(/public\.memory_project_is_private\s*\(\s*p_project_id\s*\)/gi),
      ).toHaveLength(2);
    }
  });

  it("passes the conversation and actor from every SQL caller", () => {
    const callers = [
      // write_memory_file: the app-scope curator write guard.
      /memory_source_allows_app_memory\(\s*p_source_surface,\s*p_source_chat_id,\s*p_updated_by,\s*activity\.project_id\s*\)/,
      // schedule_memory_consolidation: the terminal turn stamp.
      /memory_source_allows_app_memory\(\s*p_surface,\s*p_conversation_id,\s*p_actor_user_id,\s*canonical_project_id\s*\)/,
      // schedule_memory_consolidation: one queued actor at a time.
      /memory_source_allows_app_memory\(\s*p_surface,\s*p_conversation_id,\s*queued_state\.actor_user_id,\s*activity\.project_id\s*\)/,
    ];
    for (const sql of [migration, schema]) {
      for (const caller of callers) expect(sql).toMatch(caller);
    }
    // An upgraded deployment keeps working only if the migration replaces the
    // two functions that embed the call.
    for (const name of ["write_memory_file", "schedule_memory_consolidation"]) {
      expect(functionSql(migration, name)).toBe(functionSql(schema, name));
    }
  });

  it("keeps the definer hardening and explicit privileges", () => {
    for (const sql of [migrationAppMemory, schemaAppMemory]) {
      expect(sql).toMatch(/security\s+definer/i);
      expect(sql).toMatch(/set\s+search_path\s*=\s*public\s*$/im);
    }
    for (const sql of [migrationProjectPrivate, schemaProjectPrivate]) {
      expect(sql).toMatch(/security\s+definer/i);
      expect(sql).toMatch(/set\s+search_path\s*=\s*public\s*$/im);
    }
    for (const sql of [migration, schema]) {
      expect(sql).toMatch(
        /revoke\s+all\s+on\s+function\s+public\.memory_project_is_private\(uuid\)\s+from\s+public,\s*anon,\s*authenticated/i,
      );
      expect(sql).toMatch(
        /revoke\s+all\s+on\s+function\s+public\.memory_source_allows_app_memory\(text,\s*uuid,\s*uuid,\s*uuid\)\s+from\s+public,\s*anon,\s*authenticated/i,
      );
      expect(sql).toMatch(
        /grant\s+execute\s+on\s+function\s+public\.memory_project_is_private\(uuid\)\s+to\s+service_role/i,
      );
      expect(sql).toMatch(
        /grant\s+execute\s+on\s+function\s+public\.memory_source_allows_app_memory\(text,\s*uuid,\s*uuid,\s*uuid\)\s+to\s+service_role/i,
      );
      expect(sql).not.toMatch(
        /revoke\s+all\s+on\s+function\s+public\.memory_source_allows_app_memory\(text,\s*uuid\)\s+from/i,
      );
    }
  });
});
