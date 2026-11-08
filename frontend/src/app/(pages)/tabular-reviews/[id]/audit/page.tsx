"use client";

import { use } from "react";
import { ReviewAuditPage } from "@/app/components/training/reviewAudit/ReviewAuditPage";

interface Props {
    params: Promise<{ id: string }>;
}

export default function TabularReviewAuditPage({ params }: Props) {
    const { id } = use(params);
    return <ReviewAuditPage reviewId={id} />;
}
