import { FileText, KeyRound, UserRound } from "lucide-react";
import { UserAvatar, type UserAvatarSize } from "@/app/components/ui/user-avatar";
import { FileTypeIcon } from "@/app/components/shared/FileTypeIcon";
import {
  ChatSkeuoIcon,
  OrganizationSkeuoIcon,
  TabularReviewSkeuoIcon,
  WorkflowSkeuoIcon,
} from "@/app/components/shared/AppSidebarSkeuoIcons";
import { ClosedProjectSvgIcon } from "@/app/components/shared/FolderSvgIcon";
import { useTranslations } from "next-intl";
import type { AuditEvent } from "@/app/lib/mikeApi";
import { auditSubject, auditSubjectEmail, auditSubjectKind } from "./auditPresentation";

export function HistorySubjectIcon({ event, avatarSize }: { event: AuditEvent; avatarSize?: UserAvatarSize }) {
  const t = useTranslations();
  const type = auditSubjectKind(event);
  const { name } = auditSubject(event, t);
  const className = "h-4 w-4 shrink-0";
  if (type === "document")
    return (
      <FileTypeIcon
        fileType={
          typeof event.detail?.file_type === "string"
            ? event.detail.file_type
            : name
        }
        className={className}
      />
    );
  if (type === "chat" || type === "chats")
    return <ChatSkeuoIcon className={className} />;
  if (type === "organization")
    return <OrganizationSkeuoIcon className={className} />;
  if (type === "review" || type === "tabular_review")
    return <TabularReviewSkeuoIcon className={className} />;
  if (type === "workflow") return <WorkflowSkeuoIcon className={className} />;
  if (type === "project") return <ClosedProjectSvgIcon className={className} />;
  // Recipients without an authorized roster photo use the same monogram as
  // new share recipients. Never look up photos by an arbitrary event email.
  if (type === "member" || type === "recipient")
    return (
      <UserAvatar
        size={avatarSize}
        name={name === "-" || name.includes("@") ? null : name}
        email={auditSubjectEmail(event)}
      />
    );
  const Icon =
    type === "account" ? UserRound : type === "provider" ? KeyRound : FileText;
  return <Icon aria-hidden="true" className={className} />;
}
