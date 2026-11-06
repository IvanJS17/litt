import React from "react";
import { LittWordmark } from "@mike/litt-brand-ui";
import { cn } from "../../../shared/lib/utils";

interface WordAddinLogoProps {
  size?: "md" | "lg";
  className?: string;
}

/**
 * The outlined LiTT wordmark on branded Word add-in surfaces. X is 22px (the
 * minimum) or 33px, multiples of 11 so the pixel letters stay on whole pixels.
 */
export function WordAddinLogo({
  size = "md",
  className,
}: WordAddinLogoProps): React.ReactElement {
  return (
    <div className={cn("flex", className)}>
      <LittWordmark x={size === "lg" ? 33 : 22} />
    </div>
  );
}
