"use client";

import { ModelGuideUI } from "@mike/ui";

/**
 * The web's model guide («¿Cuál elijo?»): the shared `ModelGuideUI`, a dialog
 * on a desktop and a bottom sheet on a phone. Props are the shared ones.
 */
export function ModelGuideModal(
  props: React.ComponentProps<typeof ModelGuideUI>,
) {
  return <ModelGuideUI {...props} />;
}
