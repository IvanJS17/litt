"use client";

import { useTranslations } from "next-intl";
import type { RequestTypePlaybook, RequestTypePlaybookOption } from "@mike/contracts";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";

/**
 * The playbooks suggested for one request type of the firm. An owner or admin
 * ticks the firm's ready playbooks (a multi-select of native checkboxes); a
 * member reads the linked names. Unticking unlinks and keeps the history.
 */
export function RequestTypePlaybooks({
  typeName,
  links,
  available,
  canManage,
  disabled,
  onToggle,
}: {
  typeName: string;
  links: RequestTypePlaybook[];
  available: RequestTypePlaybookOption[];
  canManage: boolean;
  disabled: boolean;
  onToggle: (playbook: RequestTypePlaybookOption, linked: boolean) => void;
}) {
  const t = useTranslations();
  const linkedIds = new Set(links.map((link) => link.playbook_id));
  if (!canManage) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-900">{t("requests.types.playbooksHeading")}</p>
        {links.length === 0 ? (
          <p className="text-xs text-gray-500">{t("requests.types.playbooksNoneLinked")}</p>
        ) : (
          <ul className="space-y-0.5">
            {links.map((link) => (
              <li key={link.playbook_id} className="break-words text-sm text-gray-900">
                {link.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="text-xs font-medium text-gray-900">
        {t("requests.types.playbooksLegend", { name: typeName })}
      </legend>
      {available.length === 0 ? (
        <p className="text-xs text-gray-500">{t("requests.types.playbooksNoneAvailable")}</p>
      ) : (
        <ul className="space-y-1">
          {available.map((playbook) => {
            const checked = linkedIds.has(playbook.id);
            return (
              <li key={playbook.id}>
                <label className="flex min-w-0 items-start gap-2 text-sm text-gray-900 pointer-coarse:min-h-11 pointer-coarse:items-center">
                  <input
                    type="checkbox"
                    className={TABLE_CHECKBOX_CLASS}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(playbook, !checked)}
                  />
                  <span className="min-w-0 break-words">{playbook.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
