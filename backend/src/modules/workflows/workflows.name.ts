import { splitFrontMatter } from "../../lib/modelJsonFence";

const WORKFLOW_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseScalar(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function normalizeWorkflowName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return WORKFLOW_NAME_PATTERN.test(trimmed) ? trimmed : null;
}

export function workflowNameFromSkillMd(skillMd: unknown): string | null {
  if (typeof skillMd !== "string") return null;

  // Stored text another account may have written, of any size: a name is
  // looked for in the first FRONT_MATTER_MAX_CHARS of its header, and a text
  // with no header has none (it never fails the list it is in).
  const lines = splitFrontMatter(skillMd);
  if (!lines) return null;

  for (const line of lines) {
    if (!line.startsWith("name:")) continue;
    // `trim` removes the same characters as `\s`; a value that holds a line
    // terminator inside is not a name line.
    const value = line.slice(5).trim();
    if (/[\r\u2028\u2029]/.test(value)) continue;
    return normalizeWorkflowName(parseScalar(value));
  }

  return null;
}
