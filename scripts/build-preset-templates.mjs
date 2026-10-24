// Rebuild the catalog after adding unmodified publisher files to public/.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(
  new URL("../frontend/public/preset-templates/", import.meta.url),
);
const output = new URL(
  "../frontend/src/app/components/library/presetTemplates.json",
  import.meta.url,
);
// LiTT ships no publisher: upstream's US forms are not a base for Mexican
// practice. Add a reviewed source here, with its license, before its files.
const publishers = {};

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const catalog = (existsSync(root) ? walk(root) : [])
  .sort()
  .map((path) => {
    const relativePath = relative(root, path).split("\\").join("/");
    const format = extname(path).slice(1);
    if (!["docx", "pdf", "md"].includes(format))
      throw new Error(`Unsupported preset: ${relativePath}`);
    const publisher = relativePath.split("/")[0];
    const source = publishers[publisher];
    if (!source || !relativePath.includes("/"))
      throw new Error(`Unknown publisher: ${relativePath}`);
    const bytes = readFileSync(path);
    return {
      id: relativePath,
      filename: relativePath.split("/").at(-1),
      title: relativePath
        .split("/")
        .at(-1)
        .replace(/\.[^.]+$/, "")
        .replace(/-/g, " "),
      publisher,
      group: dirname(relativePath) === "." ? "" : dirname(relativePath),
      format,
      ...source,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Cataloged ${catalog.length} preset files.`);
