import React from "react";
import {
  COMPOSER_GHOST_BUTTON_CLASS,
  COMPOSER_GHOST_WORD_SIZE_CLASS,
} from "@mike/ui";
import { cn } from "../../../shared/lib/utils";

type ComposerButtonProps = React.ComponentProps<"button"> & {
  active?: boolean;
};

/**
 * Compact composer action adapted from the frontend's document and workflow
 * controls: the ghost button of the send button's family (32 px, 10 px
 * corners). It stays label-free in the narrow Word pane while retaining a
 * descriptive tooltip and accessible name.
 */
export function ComposerButton({
  active = false,
  className,
  type = "button",
  ...props
}: ComposerButtonProps): React.ReactElement {
  return (
    <button
      type={type}
      className={cn(
        COMPOSER_GHOST_BUTTON_CLASS,
        COMPOSER_GHOST_WORD_SIZE_CLASS,
        active && "text-gray-700",
        className
      )}
      {...props}
    />
  );
}
