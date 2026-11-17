"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import type { ProfileExtraction, ProfileExtractionRoute, ProfileSourceVersion } from "@mike/contracts";
import { Field, SELECT_CLASS } from "@/app/components/requests/requestFields";
import { extractionProviderName } from "./profileOptions";

/**
 * Assisted extraction (docs/client-profile.md): the lawyer picks one version
 * and asks the space's AI to propose facts from its text. The line under the
 * button says, before the click, where the text goes and with whose key: the
 * provider of the route the chat uses in this space (own or firm key only). Each proposal comes back
 * as a pending fact with its quote, to be confirmed or rejected one by one.
 */
export function ProfileExtractPanel({
  versions,
  route,
  running,
  onRun,
}: {
  versions: ProfileSourceVersion[];
  route: ProfileExtractionRoute;
  running: boolean;
  onRun: (versionId: string) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [versionId, setVersionId] = useState("");
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="space-y-1">
        <h2 id={`${id}-title`} className="font-serif text-lg text-gray-900">
          {t("clientProfile.extract.title")}
        </h2>
        <p className="text-sm text-gray-600">{t("clientProfile.extract.description")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <Field id={`${id}-version`} label={t("clientProfile.extract.version")}>
            <select
              id={`${id}-version`}
              className={SELECT_CLASS}
              value={versionId}
              disabled={running}
              onChange={(event) => setVersionId(event.target.value)}
            >
              <option value="">{t("clientProfile.extract.chooseVersion")}</option>
              {versions.map((version) => (
                <option key={version.version_id} value={version.version_id}>
                  {t("clientProfile.form.versionOption", {
                    name: version.filename ?? version.document_id,
                    version: version.version_number ?? "–",
                  })}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PillButtonUI
          type="button"
          tone="black"
          size="normal"
          className="pointer-coarse:min-h-11"
          disabled={versionId === "" || running}
          aria-busy={running}
          aria-describedby={`${id}-helper`}
          onClick={() => onRun(versionId)}
        >
          {running ? t("clientProfile.extract.running") : t("clientProfile.extract.button")}
        </PillButtonUI>
      </div>
      <p id={`${id}-helper`} className="text-xs text-gray-600">
        {t("clientProfile.extract.helper", { provider: extractionProviderName(route.provider) })}
      </p>
    </section>
  );
}

/** What a run did: how many facts it proposed and why the rest were discarded. */
export function ProfileExtractResult({ result }: { result: ProfileExtraction }) {
  const t = useTranslations();
  const id = useId();
  const discarded: [string, number, string][] = [
    ["quote", result.discarded_quote_not_found, t("clientProfile.extract.result.discardedQuote", { count: result.discarded_quote_not_found })],
    ["invalid", result.discarded_invalid, t("clientProfile.extract.result.discardedInvalid", { count: result.discarded_invalid })],
    ["duplicate", result.discarded_duplicate, t("clientProfile.extract.result.discardedDuplicate", { count: result.discarded_duplicate })],
  ];
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-1">
      <h3 id={`${id}-title`} className="text-sm font-medium text-gray-900">
        {t("clientProfile.extract.result.title")}
      </h3>
      <p className="text-sm text-gray-900" role="status">
        {t("clientProfile.extract.result.proposed", { count: result.proposed })}
      </p>
      {discarded
        .filter(([, count]) => count > 0)
        .map(([key, , text]) => (
          <p key={key} className="text-sm text-gray-600">
            {text}
          </p>
        ))}
      {result.proposed > 0 ? <p className="text-xs text-gray-600">{t("clientProfile.extract.result.review")}</p> : null}
    </section>
  );
}
