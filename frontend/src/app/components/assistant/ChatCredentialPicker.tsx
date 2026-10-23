"use client";

import { useEffect, useState } from "react";
import { ChevronDown, KeyRound } from "lucide-react";
import {
    Dropdown,
    DropdownContent,
    DropdownLabel,
    DropdownRadioGroup,
    DropdownRadioItem,
    DropdownTrigger,
} from "@/shared/ui/dropdown";
import { textButtonUIClassName } from "@/shared/ui/TextButtonUI.styles";
import {
    getChatCredentialOptions,
    type ChatCredentialOptions,
    type ChatCredentialSource,
} from "@/app/lib/mikeApi";

const SOURCE_LABELS: Record<ChatCredentialSource, string> = {
    personal: "Your key",
    organization: "Organization key",
    deployment: "Deployment key",
    operator: "Operator endpoint",
};

export function credentialSourceLabel(source: ChatCredentialSource): string {
    return SOURCE_LABELS[source];
}

/**
 * LiTT governed BYOK: which key a NEW conversation runs on. The model picker
 * chooses provider and model; this chooses the credential. All three are
 * fixed on the conversation by its first answer and never change after.
 *
 * `value` follows the server's default until the user picks; an option that
 * stops being offered (another model, another workspace) falls back to it.
 */
export function useChatCredentialChoice(params: {
    model: string;
    enabled: boolean;
    projectId?: string | null;
    orgId?: string | null;
}): {
    options: ChatCredentialOptions | null;
    value: string | null;
    setValue: (ref: string) => void;
    failed: boolean;
} {
    const { model, enabled, projectId, orgId } = params;
    const [options, setOptions] = useState<ChatCredentialOptions | null>(null);
    const [failed, setFailed] = useState(false);
    const [picked, setPicked] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !model) return;
        const controller = new AbortController();
        getChatCredentialOptions({
            model,
            projectId,
            orgId,
            signal: controller.signal,
        })
            .then((result) => {
                setOptions(result);
                setFailed(false);
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setOptions(null);
                setFailed(true);
            });
        return () => controller.abort();
    }, [enabled, model, projectId, orgId]);

    const offered = options?.options ?? [];
    const value =
        picked && offered.some((option) => option.credential_ref === picked)
            ? picked
            : (options?.default ?? null);
    return { options, value, setValue: setPicked, failed };
}

export function ChatCredentialPicker({
    options,
    value,
    onChange,
    compact = false,
}: {
    options: ChatCredentialOptions | null;
    value: string | null;
    onChange: (ref: string) => void;
    compact?: boolean;
}) {
    const offered = options?.options ?? [];
    const selected = offered.find((option) => option.credential_ref === value);
    const label = selected
        ? credentialSourceLabel(selected.source)
        : offered.length > 0
          ? "Choose a key"
          : "No key";
    return (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    aria-label={`Key for this conversation: ${label}`}
                    className={textButtonUIClassName({
                        size: compact ? "icon-xs" : "xs",
                        className: "h-7.5",
                    })}
                >
                    <KeyRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    {!compact && <span className="whitespace-nowrap">{label}</span>}
                    {!compact && (
                        <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
                    )}
                </button>
            </DropdownTrigger>
            <DropdownContent align="end" className="w-64">
                <DropdownLabel>Key</DropdownLabel>
                <p className="px-3 pb-1 text-xs text-muted-foreground">
                    The conversation keeps this key, and its model, once it
                    starts.
                </p>
                {offered.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                        No key is available for this model. Add one in
                        Settings or choose another model.
                    </p>
                ) : (
                    <DropdownRadioGroup
                        value={value ?? ""}
                        onValueChange={onChange}
                    >
                        {offered.map((option) => (
                            <DropdownRadioItem
                                key={option.credential_ref}
                                value={option.credential_ref}
                                className="cursor-pointer"
                            >
                                {credentialSourceLabel(option.source)}
                            </DropdownRadioItem>
                        ))}
                    </DropdownRadioGroup>
                )}
            </DropdownContent>
        </Dropdown>
    );
}
