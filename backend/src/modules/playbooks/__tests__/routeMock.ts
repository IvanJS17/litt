// The user facade as the playbook suites see it: their own getUserApiKeys
// double, plus the governed-route functions resolving to the deployment's
// key for the model's provider. The route rules themselves (pinning, fail
// closed, credential lookup) are covered in user.chatRoute.test.ts; these
// suites check what playbooks do with a route.

import { vi } from "vitest";
import { chatRouteColumns, chatRouteOf } from "../../user/user.chatRoute";
import { providerForModel } from "../../../lib/llm/models";
import type { ChatRoute } from "../../user/user.chatRoute";

type KeysFn = (userId: string, ...rest: unknown[]) => unknown;

export function userServiceMock(getUserApiKeys: KeysFn) {
  const keysFor = async (userId: string) => (await getUserApiKeys(userId)) ?? {};
  return {
    getUserApiKeys,
    getEffectiveApiKeys: (userId: string) => getUserApiKeys(userId),
    chatRouteColumns,
    chatRouteOf,
    pinChatRoute: vi.fn(async (_db: unknown, args: { userId: string; model: string }) => {
      const provider = providerForModel(args.model);
      return {
        ok: true,
        route: { provider, model: args.model, credentialRef: `env:${provider}` },
        apiKeys: await keysFor(args.userId),
      };
    }),
    loadPinnedChatRoute: vi.fn(async (_db: unknown, args: { userId: string; route: ChatRoute }) => ({
      ok: true,
      route: args.route,
      apiKeys: await keysFor(args.userId),
    })),
    recordChatEgress: vi.fn(async () => {}),
  };
}
