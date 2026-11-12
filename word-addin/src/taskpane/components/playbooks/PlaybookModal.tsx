import { clientTranslator } from "@mike/client";
import React, { useEffect, useMemo, useState } from "react";
import type { Playbook } from "../../types";
import { listPlaybooks } from "../../api/mikeApi";
import { Modal } from "../primitives/Modal";
import { PickerList } from "../primitives/PickerList";
import { reportFault } from "../../lib/notify";
import { useTranslations } from "use-intl";

/** What a playbook is called in the picker and on its pill. */
export function playbookTitle(playbook: Pick<Playbook, "name">): string {
  return playbook.name.trim() || clientTranslator()("word.untitledPlaybook");
}

interface PlaybookModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (playbook: Playbook) => void;
  initialPlaybookId?: string;
}

/**
 * Picks a playbook to run on the next message, laid out like the workflow
 * picker (WorkflowModal) and listing what the web picker lists: the
 * Personal playbooks the user can open.
 */
export function PlaybookModal({
  open,
  onClose,
  onSelect,
  initialPlaybookId,
}: PlaybookModalProps): React.ReactElement | null {
  const t = useTranslations();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [selectedId, setSelectedId] = useState(initialPlaybookId ?? "");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSearch("");
    setSelectedId(initialPlaybookId ?? "");
    listPlaybooks()
      .then((items) => {
        // LiTT: a draft would only be refused by the review.
        if (!cancelled)
          setPlaybooks((items ?? []).filter((item) => item.status !== "draft"));
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setPlaybooks([]);
        setError(
          reportFault(reason, {
            fallback: clientTranslator()("word.loadPlaybooksFailed"),
            operation: "playbooks.review",
          }).message,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPlaybookId, open]);

  const items = useMemo(
    () =>
      playbooks.map((playbook) => ({
        id: playbook.id,
        title: playbookTitle(playbook),
        meta: playbook.content.documentTypes.join(", "),
        searchText: [
          playbook.name,
          playbook.description,
          ...playbook.content.documentTypes,
        ].join(" "),
      })),
    [playbooks],
  );
  const selected = playbooks.find((playbook) => playbook.id === selectedId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("word.addPlaybook")}
      primaryAction={{
        label: t("word.use"),
        disabled: !selected,
        onClick: () => {
          if (!selected) return;
          onSelect(selected);
          onClose();
        },
      }}
    >
      <PickerList
        items={items}
        search={search}
        onSearchChange={setSearch}
        loading={loading}
        error={error}
        selectedId={selectedId}
        searchPlaceholder={t("word.searchPlaybooks")}
        loadingLabel={t("word.loadingPlaybooks")}
        emptyMessage={t("word.noPlaybooksFound")}
        onSelect={(id) => setSelectedId(id === selectedId ? "" : id)}
      />
    </Modal>
  );
}
