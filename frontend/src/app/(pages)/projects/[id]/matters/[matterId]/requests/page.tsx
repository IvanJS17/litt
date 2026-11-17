"use client";

import { use } from "react";
import { MatterRequests } from "@/app/components/requests/MatterRequests";

interface Props {
  params: Promise<{ id: string; matterId: string }>;
}

export default function MatterRequestsPage({ params }: Props) {
  const { id, matterId } = use(params);
  return <MatterRequests key={`${id}:${matterId}`} projectId={id} matterId={matterId} />;
}
