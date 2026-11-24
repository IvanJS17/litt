"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ModalFieldLabel } from "@/app/components/modals/ModalFieldLabel";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import {
  credentialSourceLabel,
  useChatCredentialChoice,
} from "@/app/components/assistant/ChatCredentialPicker";
import {
  PERSONAL_WORKSPACE,
  useWorkspace,
} from "@/app/contexts/WorkspaceContext";
import type { ChatCredentialOptions } from "@/app/lib/mikeApi";

/**
 * LiTT governed BYOK: which key a piece of playbook model work runs on. The
 * server never takes a firm's key on its own, so every playbook dialog that
 * starts model work (import, new run, questionnaire draft, mentor corrections)
 * sends this choice as `credential_ref`, chosen as the chat chooses it.
 */
export interface PlaybookKey {
  options: ChatCredentialOptions | null;
  /** The ref to send, or null when no key is offered (the server then says so). */
  value: string | null;
  setValue: (ref: string) => void;
}

/**
 * The chat's default for this model and workspace (the person's own key, then
 * the firm's, then the deployment's) until the person picks another. The
 * personal workspace asks for no organization, so it never offers a firm's key.
 */
export function usePlaybookKey(params: {
  model: string;
  /** Only while a dialog that needs it is open. */
  enabled: boolean;
}): PlaybookKey {
  const { model, enabled } = params;
  const { workspaceId } = useWorkspace();
  const orgId =
    workspaceId && workspaceId !== PERSONAL_WORKSPACE ? workspaceId : null;
  const choice = useChatCredentialChoice({
    model,
    enabled: enabled && !!model,
    orgId,
  });
  // The options are those of the model and workspace they were asked for.
  // After a change they stay until the new answer arrives: never send a key
  // chosen for the previous model or workspace in the meantime.
  const scope = `${model}|${orgId ?? ""}`;
  const [loadedFor, setLoadedFor] = useState<{
    options: ChatCredentialOptions | null;
    scope: string;
  }>({ options: null, scope: "" });
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records which scope the answer in hand belongs to
    setLoadedFor((previous) =>
      previous.options === choice.options
        ? previous
        : { options: choice.options, scope },
    );
  }, [choice.options, scope]);
  const current = loadedFor.options === choice.options && loadedFor.scope === scope;
  return {
    options: current ? choice.options : null,
    value: current ? choice.value : null,
    setValue: choice.setValue,
  };
}

/** The Key select: only when two or more keys can serve the model. */
export function PlaybookKeyField({
  id,
  credential,
  disabled = false,
  onChange,
}: {
  id: string;
  credential: PlaybookKey;
  disabled?: boolean;
  /** After a pick, for the caller to clear a stale error. */
  onChange?: () => void;
}) {
  const t = useTranslations();
  const offered = credential.options?.options ?? [];
  if (offered.length < 2) return null;
  return (
    <div>
      <ModalFieldLabel htmlFor={id}>
        {t("assistant.chatCredentialPicker.key")}
      </ModalFieldLabel>
      <ModalSelect
        id={id}
        value={credential.value ?? ""}
        placeholder={t("assistant.chatCredentialPicker.chooseAKey")}
        disabled={disabled}
        onChange={(value) => {
          credential.setValue(value);
          onChange?.();
        }}
        options={offered.map((option) => ({
          value: option.credential_ref,
          label: credentialSourceLabel(option.source, t),
        }))}
        wrapLabels
      />
    </div>
  );
}
