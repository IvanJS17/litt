import React, { useEffect, useState } from "react";
import quickActionsIcon from "@icons/features/quick-actions.svg";
import { getUserProfile } from "../../api/mikeApi";
import { LittMonogramPixel } from "@mike/ui";
import type { QuickAction } from "../../types";
import { useQuickActions } from "../../lib/quickActionStore";
import { quickActionDisplayName } from "../../lib/quickActions";

// The «L.» pixel monogram at one of its native sizes; it is never scaled.
const ICON_SIZE = 32;
const GREETING_GAP = 10; // px between the monogram and the greeting

export function InitialView({
  onSelect,
}: {
  onSelect: (action: QuickAction) => void;
}): React.ReactElement {
  const [name, setName] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const quickActions = useQuickActions();

  useEffect(() => {
    let cancelled = false;
    void getUserProfile()
      .then((profile) => {
        // First name only: in a 350px pane a full name in the large serif
        // wraps to three lines and pushes the quick actions down.
        const firstName = profile.displayName?.trim().split(/\s+/)[0];
        if (!cancelled) setName(firstName || "there");
      })
      .catch(() => {
        // Only the greeting's name is at stake; "Hi there" is a complete
        // greeting, so a failed profile read needs no interruption.
        if (!cancelled) setName("there");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The greeting mounts transparent and fades in on the next frame; the
  // monogram beside it is drawn in place and never moves.
  useEffect(() => {
    if (!name) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [name]);

  return (
    <div className="flex w-full flex-col items-center text-center">
      {/* The monogram stays still (Marca LiTT v1.0, prohibition 10: the
          square is never animated). It waits for the name so the centered
          row has its final width the moment it appears; only the greeting's
          opacity transitions. */}
      <div className="mb-8 flex min-h-10 w-full items-center justify-center">
        {name && (
          <div
            className="flex min-w-0 items-center justify-center"
            style={{ gap: GREETING_GAP }}
          >
            <div data-testid="initial-mike-icon" className="h-8 w-8 shrink-0">
              <LittMonogramPixel size={ICON_SIZE} decorative />
            </div>
            <h1
              className="min-w-0 text-left font-serif text-3xl font-light text-gray-900 transition-opacity duration-700 ease-in-out [overflow-wrap:anywhere] motion-reduce:transition-none"
              style={{ opacity: shown ? 1 : 0 }}
            >
              Hi, {name}
            </h1>
          </div>
        )}
      </div>
      <div className="flex h-5 items-center justify-center">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
          <img
            src={quickActionsIcon}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-3.5 w-3.5 shrink-0 object-contain"
          />
          Quick actions
        </span>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
        {quickActions
          .filter((action) => action.enabled)
          .map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onSelect(action)}
              className="inline-flex h-8 items-center justify-center rounded-full border border-white/70 bg-white/55 px-3 font-medium text-gray-600 shadow-[0_3px_9px_rgba(21,26,38,0.06),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] transition-all hover:bg-white hover:text-gray-900 active:scale-[0.98]"
            >
              {quickActionDisplayName(action)}
            </button>
          ))}
      </div>
    </div>
  );
}
