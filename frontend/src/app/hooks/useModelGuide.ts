"use client";

// The model guide's texts are read by the web and the Word add-in alike, so
// the hook lives in @mike/ui; this keeps the web's import path.
export { useModelGuide, type ModelGuideEntry } from "@mike/ui";
