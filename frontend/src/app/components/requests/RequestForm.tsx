"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  MatterRequestAssignee,
  MatterRequestComplexity,
  MatterRequestInput,
  MatterRequestLevel,
  MatterRequestType,
} from "@mike/contracts";
import { FormTextInput } from "@/app/components/ui/form-field";
import { AssigneeFields, ComplexitySelect, Field, TypeSelect } from "./requestFields";
import { TITLE_MAX } from "./requestOptions";

/** The form that opens a request: its title, type, complexity and, if known, who takes it. */
export function RequestForm({
  types,
  assignees,
  saving,
  onSubmit,
  onCancel,
}: {
  types: MatterRequestType[];
  assignees: MatterRequestAssignee[];
  saving: boolean;
  onSubmit: (input: MatterRequestInput) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const id = useId();
  const firstType = types.find((type) => !type.archived)?.id ?? "";
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState(firstType);
  const [complexity, setComplexity] = useState<MatterRequestComplexity>("standard");
  const [assignee, setAssignee] = useState<{ userId: string; level: MatterRequestLevel | "" }>({
    userId: "",
    level: "",
  });
  const ready = title.trim() !== "" && typeId !== "" && (assignee.userId === "" || assignee.level !== "");

  return (
    <form
      aria-label={t("requests.form.title")}
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || saving) return;
        onSubmit({
          title: title.trim(),
          type_id: typeId,
          complexity,
          ...(assignee.userId && assignee.level
            ? { assignee_user_id: assignee.userId, assignee_level: assignee.level }
            : {}),
        });
      }}
    >
      <h2 className="font-serif text-lg text-gray-900">{t("requests.form.title")}</h2>
      <Field id={`${id}-title`} label={t("requests.fields.title")}>
        <FormTextInput
          id={`${id}-title`}
          value={title}
          maxLength={TITLE_MAX}
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-type`} label={t("requests.fields.type")}>
          <TypeSelect id={`${id}-type`} value={typeId} types={types} disabled={saving} onChange={setTypeId} />
        </Field>
        <Field id={`${id}-complexity`} label={t("requests.fields.complexity")}>
          <ComplexitySelect id={`${id}-complexity`} value={complexity} disabled={saving} onChange={setComplexity} />
        </Field>
        <AssigneeFields
          idPrefix={id}
          assignees={assignees}
          userId={assignee.userId}
          level={assignee.level}
          disabled={saving}
          onChange={setAssignee}
        />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={saving} onClick={onCancel}>
          {t("requests.form.cancel")}
        </TextButtonUI>
        <PillButtonUI
          type="submit"
          tone="black"
          size="normal"
          className="pointer-coarse:min-h-11"
          disabled={!ready || saving}
          aria-busy={saving}
        >
          {saving ? t("requests.form.creating") : t("requests.form.create")}
        </PillButtonUI>
      </div>
    </form>
  );
}
