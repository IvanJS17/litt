import Image from "next/image";
import { Bot } from "lucide-react";
import type { McpGrantApp } from "@/app/lib/mikeApi";

const LOGOS: Record<McpGrantApp, string> = {
  claude: "/icons/providers/anthropic.svg",
  chatgpt: "/icons/providers/openai.svg",
};

/**
 * The brand of Claude or ChatGPT when the server recognised the app by the
 * host of its client id (`app`), a generic app icon for every other one. The
 * name an app gives itself never picks the logo. Decorative: the name is
 * always written next to it.
 */
export function ConnectedAppIcon({
  app,
  size = "md",
}: {
  app: McpGrantApp | null;
  /** `sm` is the bare mark inside a tab; `md` sits in a tile at the head of a card. */
  size?: "sm" | "md";
}) {
  const px = size === "sm" ? 16 : 22;
  if (size === "sm" && app)
    return <Image src={LOGOS[app]} alt="" width={px} height={px} className="dark:invert" />;
  return (
    <span
      data-slot="connected-app-icon"
      data-app={app ?? "generic"}
      className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-interactive-soft"
    >
      {app ? (
        <Image src={LOGOS[app]} alt="" width={px} height={px} className="dark:invert" />
      ) : (
        <Bot aria-hidden="true" className="size-5 text-gray-500" />
      )}
    </span>
  );
}
