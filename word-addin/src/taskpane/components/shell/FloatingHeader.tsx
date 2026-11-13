import React, { useState } from "react";
import type { WordChatOpenHandler } from "../../lib/wordChatTypes";
import {
  Check,
  FileCheck,
  ChevronLeft,
  Ellipsis,
  ListChecks,
  Menu,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  LiquidActionRow,
  LiquidIconButton,
  LiquidTextButton,
} from "../primitives/LiquidActionRow";
import {
  HeaderButtonUI,
  HeaderButtonsUI,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@mike/ui";
import chatIcon from "@icons/features/chat.svg";
import workflowIcon from "@icons/features/workflow.svg";
import chatHistoryIcon from "@icons/features/chat-history.svg";
import settingsIcon from "@icons/settings.svg";
import signOutIcon from "@icons/sign-out.svg";
import { ChatHistoryDropdown } from "../history/ChatHistoryDropdown";
import type { WordChatStorageMode } from "../../lib/wordChatSettings";
import { useTranslations } from "use-intl";

export type AddinSection =
  | "approved-redline"
  | "chat"
  | "actions"
  | "workflows"
  | "history"
  | "settings";

interface FloatingHeaderProps {
  section: AddinSection;
  onSectionChange: (section: AddinSection) => void;
  onNewChat: () => void;
  hasActiveChat: boolean;
  onSelectHistoryChat: WordChatOpenHandler;
  workflowDetailOpen?: boolean;
  onWorkflowBack?: () => void;
  onOpenWorkflowDetails?: () => void;
  onDeleteWorkflow?: () => void;
  canDeleteWorkflow?: boolean;
  onUseWorkflow?: () => void;
  onNewWorkflow?: () => void;
  onNewQuickAction?: () => void;
  onSignOut: () => void;
  wordDocumentId: string;
  wordChatStorage: WordChatStorageMode;
  wordChatOwnerId: string;
  /** The chat on screen, marked in the history menu. */
  currentChatId?: string | null;
}

function sections(t: ReturnType<typeof useTranslations>) {
  return [
  { value: "chat" as const, label: t("word.sectionAssistant"), icon: chatIcon },
  {
    value: "history" as const,
    label: t("word.chatHistory2"),
    icon: chatHistoryIcon,
  },
  {
    value: "actions" as const,
    label: t("word.quickActions2"),
    icon: ListChecks,
  },
  { value: "workflows" as const, label: t("word.workflows"), icon: workflowIcon },
  { value: "settings" as const, label: t("word.settings.title"), icon: settingsIcon },
];
}

export function FloatingHeader({
  section,
  onSectionChange,
  onNewChat,
  hasActiveChat,
  onSelectHistoryChat,
  workflowDetailOpen = false,
  onWorkflowBack,
  onOpenWorkflowDetails,
  onDeleteWorkflow,
  canDeleteWorkflow = false,
  onUseWorkflow,
  onNewWorkflow,
  onNewQuickAction,
  onSignOut,
  wordDocumentId,
  wordChatStorage,
  wordChatOwnerId,
  currentChatId,
}: FloatingHeaderProps): React.ReactElement {
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [workflowActionsOpen, setWorkflowActionsOpen] = useState(false);

  return (
    <header
      data-testid="floating-header"
      className="pointer-events-none absolute inset-x-0 top-0 z-40 isolate flex items-center justify-between gap-3 p-3"
    >
      {/* Content fades out under the header. This used to ramp the blur down
          in four stacked backdrop-blur layers (1/2/4/8px), but every
          backdrop-filter re-samples whatever is moving behind it on each
          frame — in WKWebView that made the streaming transcript pay for four
          full-width re-samples per scrolled frame. One blurred layer whose
          mask alpha ramps down through several stops is the standard
          single-layer approximation of a progressive blur: the cross-fade
          from blurred to sharp reads as the blur easing off, and the mask
          reaches zero well before the pane's bottom edge so no seam is left
          to catch the eye. -webkit-mask-image is spelled out because
          WKWebView still wants the prefixed form. */}
      <div
        aria-hidden="true"
        data-testid="header-scrim"
        className="pointer-events-none absolute -bottom-2 left-0 right-2 top-0 z-0"
      >
        <div className="absolute inset-0 backdrop-blur-[8px] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_16%,rgba(0,0,0,0.55)_46%,rgba(0,0,0,0.2)_72%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_0%,black_16%,rgba(0,0,0,0.55)_46%,rgba(0,0,0,0.2)_72%,transparent_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.85)_0%,rgba(255,255,255,0.62)_48%,rgba(255,255,255,0.22)_76%,rgba(255,255,255,0)_100%)] dark:bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--app-background)_85%,transparent)_0%,color-mix(in_srgb,var(--app-background)_62%,transparent)_48%,color-mix(in_srgb,var(--app-background)_22%,transparent)_76%,transparent_100%)]" />
      </div>

      <div className="relative z-10 flex items-center gap-2">
        <Dropdown open={menuOpen} onOpenChange={setMenuOpen}>
          <LiquidActionRow className="pointer-events-auto">
            <DropdownTrigger asChild>
              <LiquidIconButton
                data-testid="header-menu"
                aria-label={menuOpen ? t("word.closeMenu") : t("word.openMenu")}
                title={menuOpen ? t("word.closeMenu") : t("word.menu")}
              >
                {menuOpen ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Menu className="h-4 w-4" />
                )}
              </LiquidIconButton>
            </DropdownTrigger>
          </LiquidActionRow>
          <DropdownContent align="start" sideOffset={8} className="min-w-44">
            {sections(t).map((item) => {
              return (
                <DropdownItem
                  key={item.value}
                  data-testid={`header-section-${item.value}`}
                  onSelect={() => onSectionChange(item.value)}
                  selected={section === item.value}
                >
                  {typeof item.icon === "string" ? (
                    <img
                      src={item.icon}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                  ) : (
                    <item.icon
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  <span className="min-w-0 flex-1">{item.label}</span>
                </DropdownItem>
              );
            })}
            <DropdownItem
              onSelect={() => onSectionChange("approved-redline")}
              selected={section === "approved-redline"}
            >
              <FileCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{t("word.approvedRedlines")}</span>
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem onSelect={onSignOut}>
              <img
                src={signOutIcon}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-4 w-4 shrink-0 object-contain"
              />
              <span className="min-w-0 flex-1">{t("word.signOut")}</span>
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
        {workflowDetailOpen && (
          <LiquidActionRow
            data-testid="workflow-back-bubble"
            className="pointer-events-auto"
          >
            <LiquidTextButton
              onClick={onWorkflowBack}
              aria-label={t("word.backToWorkflows")}
              title={t("word.backToWorkflows")}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t("word.workflows")}
            </LiquidTextButton>
          </LiquidActionRow>
        )}
      </div>

      {section === "chat" ? (
        <HeaderButtonsUI className="pointer-events-auto relative z-10 backdrop-blur-2xl">
          {hasActiveChat && (
            <HeaderButtonUI
              iconOnly
              onClick={onNewChat}
              aria-label={t("word.newChat")}
              title={t("word.newChat")}
            >
              <Plus className="h-4 w-4" />
            </HeaderButtonUI>
          )}
          <ChatHistoryDropdown
            onSelect={onSelectHistoryChat}
            documentId={wordDocumentId}
            ownerId={wordChatOwnerId}
            storageMode={wordChatStorage}
            currentChatId={currentChatId}
          />
        </HeaderButtonsUI>
      ) : workflowDetailOpen ? (
        <HeaderButtonsUI className="pointer-events-auto relative z-10 backdrop-blur-2xl">
          <Dropdown
            open={workflowActionsOpen}
            onOpenChange={setWorkflowActionsOpen}
          >
            <DropdownTrigger asChild>
              <HeaderButtonUI
                iconOnly
                aria-label={t("word.workflowActions")}
                title={t("word.workflowActions")}
              >
                <Ellipsis className="h-4 w-4" />
              </HeaderButtonUI>
            </DropdownTrigger>
            <DropdownContent align="end" sideOffset={8} className="min-w-40">
              <DropdownItem onSelect={() => onOpenWorkflowDetails?.()}>
                <Pencil className="h-3.5 w-3.5" />
                <span>{t("word.editDetails")}</span>
              </DropdownItem>
              <DropdownItem
                disabled={!canDeleteWorkflow}
                onSelect={() => onDeleteWorkflow?.()}
                className="text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{t("word.delete")}</span>
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
          <LiquidTextButton onClick={onUseWorkflow}>
            <Check className="h-3.5 w-3.5" />
            {t("word.use")}
          </LiquidTextButton>
        </HeaderButtonsUI>
      ) : section === "history" ? (
        <HeaderButtonsUI className="pointer-events-auto relative z-10 backdrop-blur-2xl">
          <HeaderButtonUI
            iconOnly
            onClick={onNewChat}
            aria-label={t("word.newChat")}
            title={t("word.newChat")}
          >
            <Plus className="h-4 w-4" />
          </HeaderButtonUI>
        </HeaderButtonsUI>
      ) : section === "workflows" ? (
        <HeaderButtonsUI className="pointer-events-auto relative z-10 backdrop-blur-2xl">
          <HeaderButtonUI
            iconOnly
            onClick={onNewWorkflow}
            aria-label={t("word.newWorkflow")}
            title={t("word.newWorkflow")}
          >
            <Plus className="h-4 w-4" />
          </HeaderButtonUI>
        </HeaderButtonsUI>
      ) : section === "actions" ? (
        <HeaderButtonsUI className="pointer-events-auto relative z-10 backdrop-blur-2xl">
          <HeaderButtonUI
            iconOnly
            onClick={onNewQuickAction}
            aria-label={t("word.newQuickAction2")}
            title={t("word.newQuickAction2")}
          >
            <Plus className="h-4 w-4" />
          </HeaderButtonUI>
        </HeaderButtonsUI>
      ) : null}
    </header>
  );
}
