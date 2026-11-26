// An in-memory stand-in for the Supabase client that executes filters as
// well as recording writes, shared by the playbook module tests.
import type { Db } from "../../../lib/supabase";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export type Row = Record<string, unknown>;

/** Execute filters as well as record writes, to exercise tenant isolation. */
export function database(
  rows: Row[],
  members: Row[] = [],
  profiles: Row[] = [],
  overrides: Row[] = [],
) {
  // A fixture's shared_with becomes viewer grants, as the 20261017_04
  // migration moved them.
  const shares = rows.flatMap((row) =>
    ((row.shared_with as string[] | undefined) ?? []).map((email) => ({
      id: `share-${row.id}-${email}`,
      playbook_id: row.id,
      shared_with_email: email,
      role: "viewer",
    })),
  );
  rows.forEach((row) => delete row.shared_with);
  const tables: Record<string, Row[]> = {
    playbooks: rows,
    playbook_shares: shares,
    playbook_org_access_overrides: overrides,
    org_members: members,
    user_profiles: profiles,
    organizations: [
      { id: ORG, kind: "team" },
      { id: OTHER, kind: "team" },
    ],
    playbook_runs: [],
  };
  const writes: { table: string; op: string; payload: Row }[] = [];
  const from = (table: string) => {
    const predicates: ((row: Row) => boolean)[] = [];
    let op = "select";
    let payload: Row = {};
    let upserts: Row[] = [];
    let conflict: string[] = [];
    const orders: [string, boolean][] = [];
    const settle = () => {
      let result = (tables[table] ?? []).filter((row) =>
        predicates.every((test) => test(row)),
      );
      if (op !== "select") {
        writes.push({ table, op, payload });
        if (op === "insert") {
          // One row or a list of rows, as the client takes either.
          const inserted = Array.isArray(payload) ? (payload as Row[]) : [payload];
          // idx_playbook_imports_one_running_proposal and
          // idx_playbook_imports_one_running_correction.
          const runningBatch = (row: Row) =>
            (row.kind === "proposal" || row.kind === "correction") && row.status === "running";
          if (
            table === "playbook_imports" &&
            inserted.some(
              (row) =>
                runningBatch(row) &&
                (tables[table] ?? []).some(
                  (other) =>
                    runningBatch(other) &&
                    other.kind === row.kind &&
                    other.playbook_id === row.playbook_id,
                ),
            )
          )
            return { data: [] as Row[], error: { code: "23505", message: "duplicate key" } };
          (tables[table] ??= []).push(...inserted);
          result = inserted;
        }
        if (op === "update")
          result.forEach((row) => Object.assign(row, payload));
        if (op === "delete")
          tables[table] = (tables[table] ?? []).filter(
            (row) => !result.includes(row),
          );
        if (op === "upsert") {
          for (const value of upserts) {
            const existing = (tables[table] ??= []).find((row) =>
              conflict.every((key) => row[key] === value[key]),
            );
            if (existing) Object.assign(existing, value);
            else tables[table].push({ id: `${table}-${tables[table].length}`, ...value });
          }
          result = upserts;
        }
      }
      // Keyset reads (lib/batchedQuery selectAllByKey) need the order.
      if (op === "select")
        result = [...result].sort((a, b) => {
          for (const [key, ascending] of orders) {
            const left = String(a[key]);
            const right = String(b[key]);
            if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
      return { data: result, error: null as { code: string; message: string } | null };
    };
    const query = {
      throwOnError: () => query,
      select: () => query,
      eq: (key: string, value: unknown) => {
        predicates.push((row) => row[key] === value);
        return query;
      },
      is: (key: string, value: unknown) => {
        if (!key.includes("."))
          predicates.push((row) => (row[key] ?? null) === value);
        return query;
      },
      in: (key: string, values: unknown[]) => {
        predicates.push((row) => values.includes(row[key]));
        return query;
      },
      lt: (key: string, value: unknown) => {
        predicates.push((row) => String(row[key]) < String(value));
        return query;
      },
      gt: (key: string, value: unknown) => {
        predicates.push((row) => String(row[key]) > String(value));
        return query;
      },
      contains: (key: string, values: unknown[]) => {
        predicates.push((row) =>
          values.every((value) => (row[key] as unknown[]).includes(value)),
        );
        return query;
      },
      order: (key: string, options?: { ascending?: boolean }) => {
        orders.push([key, options?.ascending !== false]);
        return query;
      },
      limit: () => query,
      insert: (value: Row) => {
        op = "insert";
        payload = value;
        return query;
      },
      update: (value: Row) => {
        op = "update";
        payload = value;
        return query;
      },
      delete: () => {
        op = "delete";
        return query;
      },
      upsert: (values: Row[], options: { onConflict: string }) => {
        op = "upsert";
        upserts = values;
        payload = { rows: values.length };
        conflict = options.onConflict.split(",");
        return query;
      },
      single: async () => ({
        data: settle().data[0] ?? null,
        error: null,
      }),
      maybeSingle: async () => ({
        data: settle().data[0] ?? null,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(settle()).then(resolve),
    };
    return query;
  };
  // The SQL functions of 20261107_54_litt_playbook_change_guards, each one
  // statement here as it is one transaction there.
  const rpc = async (name: string, args: Row) => {
    const playbook = (tables.playbooks ?? []).find((row) => row.id === args.p_playbook_id);
    if (name === "accept_playbook_change") {
      if (!playbook) return { data: "missing", error: null };
      if (playbook.updated_at !== args.p_read_updated_at) return { data: "stale", error: null };
      const change = (tables.playbook_changes ?? []).find(
        (row) =>
          row.id === args.p_change_id &&
          row.playbook_id === args.p_playbook_id &&
          row.status === "pending",
      );
      if (!change) return { data: "decided", error: null };
      const now = new Date().toISOString();
      Object.assign(change, { status: "accepted", decided_by: args.p_user_id, decided_at: now });
      Object.assign(playbook, { content_json: args.p_content, updated_at: now });
      writes.push({ table: "playbooks", op: "rpc", payload: { name } });
      return { data: "accepted", error: null };
    }
    if (name === "discard_playbook_proposal_sources") {
      if (playbook?.status !== "draft") return { data: [], error: null };
      const ids = args.p_source_ids as unknown[];
      const gone = (tables.playbook_sources ?? []).filter(
        (row) => row.playbook_id === args.p_playbook_id && ids.includes(row.id),
      );
      tables.playbook_sources = (tables.playbook_sources ?? []).filter((row) => !gone.includes(row));
      writes.push({ table: "playbook_sources", op: "rpc", payload: { name } });
      return { data: gone.map((row) => row.storage_key), error: null };
    }
    // The review publication RPC (upstream's contract model, below).
    return publicationRpc(tables, writes)(name, args);
  };
  // The account's confirmed address, which queued jobs read when they run: in
  // these fixtures a person's address is `<id>@example.com`.
  const auth = {
    admin: {
      getUserById: async (id: string) => ({
        data: { user: { email: `${id}@example.com`, email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      }),
    },
  };
  return { db: { from, rpc, auth } as unknown as Db, writes, tables };
}

// Sequential contract model only. PostgreSQL tests establish the actual
// publication transaction, rollback and concurrent winner behavior.
export function publicationRpc(
  tables: Record<string, Row[]>,
  writes: { table: string; op: string; payload: Row }[] = [],
) {
  return async (name: string, args: Row) => {
    if (name !== "publish_playbook_review") throw new Error(`Unexpected RPC: ${name}`);
    const run = tables.playbook_runs.find((row) => row.id === args.p_run_id && row.user_id === args.p_user_id);
    if (!run) return { data: { disposition: "missing" }, error: null };
    if (run.status !== "running") return { data: {
      disposition: run.status === "completed" ? "existing" : "terminal", run: structuredClone(run),
    }, error: null };
    let disposition = "published";
    let versionId: unknown = null;
    const findings = structuredClone(args.p_findings) as Row[];
    const version = args.p_version as Row | null;
    if (version) {
      const doc = (tables.documents ?? []).find((row) => row.id === args.p_document_id);
      const source = (tables.document_versions ?? []).find((row) => row.id === args.p_expected_version_id);
      if (!doc || run.document_id !== doc.id || doc.current_version_id !== source?.id ||
        source?.storage_path !== args.p_expected_storage_path || source?.deleted_at) disposition = "source_changed";
      else {
        const number = (tables.document_versions ?? []).filter((row) => row.document_id === doc.id).length + 1;
        versionId = version.id;
        tables.document_versions.push({ ...version, document_id: doc.id, version_number: number, deleted_at: null });
        for (const item of args.p_edits as Row[]) {
          const { finding_index, reason, ...edit } = item;
          (tables.document_edits ??= []).push({ ...edit, document_id: doc.id, version_id: versionId, status: "pending" });
          const { id, ...fields } = edit;
          findings[Number(finding_index)].edit = { ...fields, kind: "edit", edit_id: id,
            document_id: doc.id, version_id: versionId, version_number: number, reason, status: "pending" };
        }
        doc.current_version_id = versionId;
      }
    }
    const payload = { status: "completed", summary: args.p_summary, findings_json: findings,
      edited_version_id: versionId, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    Object.assign(run, payload);
    writes.push({ table: "playbook_runs", op: "update", payload });
    return { data: { disposition, run: structuredClone(run) }, error: null };
  };
}
