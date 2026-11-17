"use client";

import { use } from "react";
import { MatterRadar } from "@/app/components/radar/MatterRadar";

interface Props {
  params: Promise<{ id: string; matterId: string }>;
}

export default function MatterRadarPage({ params }: Props) {
  const { id, matterId } = use(params);
  return <MatterRadar key={`${id}:${matterId}`} projectId={id} matterId={matterId} />;
}
