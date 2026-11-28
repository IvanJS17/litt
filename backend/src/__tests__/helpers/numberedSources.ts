import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sources the database numbers when a version comes without a number,
 * read from the `source in (...)` of `create_document_version` in the schema.
 */
export function numberedSources(): string[] {
  const schema = readFileSync(join(__dirname, "../../../schema.sql"), "utf8");
  const body = schema.slice(schema.indexOf("function public.create_document_version("));
  const list = /source in \(([^)]*)\)/.exec(body)?.[1];
  if (!list) throw new Error("numbering list not found in schema.sql");
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}
