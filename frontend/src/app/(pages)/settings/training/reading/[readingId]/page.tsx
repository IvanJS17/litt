"use client";

import { useParams } from "next/navigation";
import { ReadingPage } from "@/app/components/training/reading/ReadingPage";

export default function TrainingReadingPage() {
  const { readingId } = useParams<{ readingId: string }>();
  return <ReadingPage readingId={readingId} />;
}
