"use client";

import { use } from "react";
import { MatterReport } from "@/app/components/report/MatterReport";

interface Props {
  params: Promise<{ id: string; matterId: string }>;
}

export default function MatterReportPage({ params }: Props) {
  const { id, matterId } = use(params);
  return <MatterReport key={`${id}:${matterId}`} projectId={id} matterId={matterId} />;
}
