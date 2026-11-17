"use client";

import { use } from "react";
import { ClientProfile } from "@/app/components/profile/ClientProfile";

interface Props {
  params: Promise<{ id: string; matterId: string }>;
}

export default function ClientProfilePage({ params }: Props) {
  const { id, matterId } = use(params);
  return <ClientProfile key={`${id}:${matterId}`} projectId={id} matterId={matterId} />;
}
