"use client";

import { use } from "react";
import { RuleProposals } from "@/app/components/radar/RuleProposals";

interface Props {
  params: Promise<{ id: string }>;
}

export default function RuleProposalsPage({ params }: Props) {
  const { id } = use(params);
  return <RuleProposals key={id} projectId={id} />;
}
