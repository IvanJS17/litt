/**
 * LiTT: governed egress for the memory curator.
 *
 * Upstream's curator streams straight through `streamChatWithTools`, which
 * resolves provider keys from env/user storage with no pinned route, no
 * versioned credential and no egress receipt. Until an authorized decision
 * extends `EGRESS_POLICY` to a real provider host, the curator fails closed:
 * the consolidation job stops before it reads any credential, and the default
 * stream refuses before any provider request. Only the fake interception host
 * is allowlisted (tests).
 */
import { providerForModel } from "../../lib/llm/models";
import type { StreamChatParams, StreamChatResult } from "../../lib/llm/types";
import { resolveEgressTarget } from "../../lib/recovery/sharedContracts";

/** Typed, secret-free signal for a governance block on curator egress. */
export class MemoryCuratorEgressBlockedError extends Error {
  readonly kind = "real_provider_egress_blocked" as const;

  constructor(host: string) {
    super(`memory curator egress is blocked for host "${host}"`);
    this.name = "MemoryCuratorEgressBlockedError";
  }
}

function hostForModel(model: string | null | undefined): string {
  if (!model) return "";
  try {
    return providerForModel(model);
  } catch {
    return "";
  }
}

/** True only when the policy allowlists the model's provider host. */
export function curatorEgressAllowed(model: string | null | undefined): boolean {
  const host = hostForModel(model);
  return host !== "" && resolveEgressTarget("memory-curator", host).allowed;
}

/**
 * Default curator stream. Refuses every non-allowlisted provider before the
 * request is built; the sender only runs for an allowlisted host.
 */
export function createGovernedCuratorStream(
  sender: (params: StreamChatParams) => Promise<StreamChatResult>,
): (params: StreamChatParams) => Promise<StreamChatResult> {
  return async (params) => {
    if (!curatorEgressAllowed(params.model)) {
      throw new MemoryCuratorEgressBlockedError(hostForModel(params.model));
    }
    return sender(params);
  };
}
