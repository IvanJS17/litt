"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  MatterRequestAssignee,
  MatterRequestComplexity,
  MatterRequestLevel,
  MatterRequestStatus,
  MatterRequestType,
} from "@mike/contracts";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import {
  REQUEST_COMPLEXITIES,
  REQUEST_LEVELS,
  REQUEST_STATUSES,
  typeName,
} from "./requestOptions";

// 44 px to touch on a phone; compact with a mouse.
export const SELECT_CLASS = `h-11 pointer-fine:h-9 ${FORM_CONTROL_GLASS_CLASS}`;

export function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-gray-900">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Words for the closed vocabularies; one place so the list, the form and the detail agree. */
export function useRequestWords() {
  const t = useTranslations();
  return {
    status: (status: MatterRequestStatus) => t(`requests.status.${status}`),
    complexity: (complexity: MatterRequestComplexity) => t(`requests.complexity.${complexity}`),
    level: (level: MatterRequestLevel) => t(`requests.level.${level}`),
    type: (type: Pick<MatterRequestType, "name" | "seed_key">) =>
      typeName(type, (seed) => t(`requests.typeSeed.${seed}`)),
    person: (assignee: Pick<MatterRequestAssignee, "display_name" | "email"> | undefined) =>
      assignee?.display_name ?? assignee?.email ?? t("requests.person.unknown"),
  };
}

export function TypeSelect({
  id,
  value,
  types,
  keepArchived,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  types: MatterRequestType[];
  /** The type a request already has stays listed even if the firm archived it. */
  keepArchived?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const words = useRequestWords();
  return (
    <select
      id={id}
      className={SELECT_CLASS}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {types
        .filter((type) => !type.archived || type.id === keepArchived)
        .map((type) => (
          <option key={type.id} value={type.id}>
            {words.type(type)}
          </option>
        ))}
    </select>
  );
}

export function ComplexitySelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: MatterRequestComplexity;
  disabled?: boolean;
  onChange: (value: MatterRequestComplexity) => void;
}) {
  const words = useRequestWords();
  return (
    <select
      id={id}
      className={SELECT_CLASS}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as MatterRequestComplexity)}
    >
      {REQUEST_COMPLEXITIES.map((option) => (
        <option key={option} value={option}>
          {words.complexity(option)}
        </option>
      ))}
    </select>
  );
}

export function StatusSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: MatterRequestStatus;
  disabled?: boolean;
  onChange: (value: MatterRequestStatus) => void;
}) {
  const words = useRequestWords();
  return (
    <select
      id={id}
      className={SELECT_CLASS}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as MatterRequestStatus)}
    >
      {REQUEST_STATUSES.map((option) => (
        <option key={option} value={option}>
          {words.status(option)}
        </option>
      ))}
    </select>
  );
}

/**
 * The assignee and the cost level travel together: choosing a person offers
 * the level the firm's roles suggest, and a person cannot be assigned without
 * one.
 */
export function AssigneeFields({
  idPrefix,
  assignees,
  userId,
  level,
  disabled,
  keepUser,
  onChange,
}: {
  idPrefix: string;
  assignees: MatterRequestAssignee[];
  userId: string;
  level: MatterRequestLevel | "";
  disabled?: boolean;
  /** The assignee a request already has stays listed even once they cannot be chosen. */
  keepUser?: string | null;
  onChange: (next: { userId: string; level: MatterRequestLevel | "" }) => void;
}) {
  const t = useTranslations();
  const words = useRequestWords();
  const known = assignees.some((person) => person.user_id === keepUser);
  return (
    <>
      <Field id={`${idPrefix}-assignee`} label={t("requests.fields.assignee")}>
        <select
          id={`${idPrefix}-assignee`}
          className={SELECT_CLASS}
          value={userId}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            const person = assignees.find((candidate) => candidate.user_id === next);
            onChange({ userId: next, level: next ? (person?.suggested_level ?? level) : "" });
          }}
        >
          <option value="">{t("requests.fields.unassigned")}</option>
          {keepUser && !known ? (
            <option value={keepUser}>{t("requests.person.unknown")}</option>
          ) : null}
          {assignees.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {words.person(person)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${idPrefix}-level`} label={t("requests.fields.level")}>
        <select
          id={`${idPrefix}-level`}
          className={SELECT_CLASS}
          value={level}
          disabled={disabled || !userId}
          onChange={(event) => onChange({ userId, level: event.target.value as MatterRequestLevel })}
        >
          <option value="" disabled>
            {t("requests.fields.chooseLevel")}
          </option>
          {REQUEST_LEVELS.map((option) => (
            <option key={option} value={option}>
              {words.level(option)}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}
