import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// LiTT training layer 2 in PostgreSQL: granting an urgency pass
// (20261107_61_litt_training_urgency_pass_grant.sql).
// performance.litt-training-urgency-pass.sql holds the assertions (grant
// matrix, project, duplicate, limit, departures, privileges) and runs in CI
// with the performance.*.sql loop. This suite runs the same file locally and
// proves it depends on the rule: with a grant function that also lets an
// owner grant, it fails. Opt in with MIKE_TEST_POSTGRES_CONTAINER=<postgres
// container>; the suite owns a disposable database and never touches the
// application's.
const container = process.env.MIKE_TEST_POSTGRES_CONTAINER;
const database = `mike_test_training_urgency_pass_${process.pid}_${Date.now()}`;
const MIGRATION = "migrations/20261107_61_litt_training_urgency_pass_grant.sql";
const ASSERTIONS = "src/__tests__/sql/performance.litt-training-urgency-pass.sql";
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
function sql(query: string) {
    execFileSync("docker", ["exec", "-i", container!, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-Xq"], {
        input: query, encoding: "utf8", timeout: 120_000, stdio: ["pipe", "pipe", "pipe"],
    });
}
function sqlError(query: string): string {
    try {
        sql(query);
    } catch (error) {
        return String((error as { stderr?: string }).stderr ?? error);
    }
    return "";
}

describe.skipIf(!container)("LiTT training urgency pass grant in PostgreSQL", () => {
    let created = false;
    beforeAll(() => {
        execFileSync("docker", ["exec", container!, "createdb", "-U", "postgres", database]);
        created = true;
        sql(`create schema auth;
            create table auth.users (id uuid primary key, email text,
                raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
            create function auth.uid() returns uuid language sql stable as
                $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
        sql(read("schema.sql"));
        // Re-running the migration over the final shape must be a no-op.
        sql(read(MIGRATION));
        sql(read(MIGRATION));
    }, 120_000);
    afterAll(() => {
        if (created) execFileSync("docker", ["exec", container!, "dropdb", "-U", "postgres", "--force", database]);
    });

    it("lets only the pupil's current mentor grant, within the limits", () => {
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);

    it("fails without the rule: a grant function that also lets an owner grant", () => {
        // The real function with one extra door: an organization owner.
        const leaky = read(MIGRATION).replace(
            "if p_actor is null or p_actor = p_trainee\n    or not coalesce(public.training_can_read_learning(p_actor, p_org, p_trainee), false) then\n    return jsonb_build_object('outcome', 'not_found');\n  end if;\n  perform 1 from public.training_pupils p\n    where p.org_id = p_org and p.trainee_user_id = p_trainee and p.mentor_user_id = p_actor\n    for update;",
            "if p_actor is null or p_actor = p_trainee\n    or not (coalesce(public.training_can_read_learning(p_actor, p_org, p_trainee), false)\n      or exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_actor and m.role = 'owner')) then\n    return jsonb_build_object('outcome', 'not_found');\n  end if;\n  perform 1 from public.training_pupils p\n    where p.org_id = p_org and p.trainee_user_id = p_trainee\n    for update;",
        );
        expect(leaky).not.toBe(read(MIGRATION));
        sql(leaky);
        expect(sqlError(read(ASSERTIONS))).toMatch(/grant matrix: owner got granted/);
        sql(read(MIGRATION));
        expect(sqlError(read(ASSERTIONS))).toBe("");
    }, 120_000);
});
