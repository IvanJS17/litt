"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQueryParamTab } from "@/app/hooks/useQueryParamTab";
import {
  AlertCircle,
  Check,
  ClipboardCheck,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Star,
  Trash2,
  Users,
  WandSparkles,
} from "lucide-react";
import {
  PlaybookActionItems,
  PlaybookTable,
  playbookPath,
  type PlaybookActionHandlers,
} from "@/app/components/playbooks/PlaybookTable";
import { PlaybookEditor } from "@/app/components/playbooks/PlaybookEditor";
import {
  PLAYBOOK_VIEWS,
  PlaybookToolbar,
  type PlaybookView,
} from "@/app/components/playbooks/PlaybookToolbar";
import { NewPlaybookModal } from "@/app/components/playbooks/NewPlaybookModal";
import {
  NewPlaybookMenu,
  playbookModels,
} from "@/app/components/playbooks/NewPlaybookMenu";
import {
  PlaybookIntakeModal,
  type PlaybookIntakeRequest,
} from "@/app/components/playbooks/PlaybookIntakeModal";
import { PlaybookDraftBanner } from "@/app/components/playbooks/PlaybookDraftBanner";
import { PlaybookCorrections } from "@/app/components/playbooks/PlaybookCorrections";
import { usePlaybookCorrectionPupils } from "@/app/components/playbooks/usePlaybookCorrectionPupils";
import { usePlaybookProvenance } from "@/app/components/playbooks/usePlaybookProvenance";
import { PlaybookDetailsModal } from "@/app/components/playbooks/PlaybookDetailsModal";
import type { PlaybookDetails } from "@/app/components/playbooks/PlaybookDetailsFields";
import { PlaybookPageSkeleton } from "@/app/components/playbooks/PlaybookPageSkeleton";
import {
  PlaybookNewRun,
  type ReviewMode,
} from "@/app/components/playbooks/PlaybookNewRun";
import {
  PlaybookReviewDocuments,
  type ReviewDocument,
} from "@/app/components/playbooks/PlaybookReviewDocuments";
import { PlaybookRuns } from "@/app/components/playbooks/PlaybookRuns";
import {
  PlaybookRunActionItems,
  PlaybookRunsTable,
  type PlaybookRunActionHandlers,
} from "@/app/components/playbooks/PlaybookRunsTable";
import {
  PlaybookSources,
  type PlaybookSourcesHandle,
} from "@/app/components/playbooks/PlaybookSources";
import { createPlaybookRule } from "@/app/components/playbooks/playbookRules";
import { HeaderButtonUI, Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { reportFault, notifyError } from "@/app/lib/userFacingError";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { Modal } from "@/app/components/modals/Modal";
import { ModalFieldLabel } from "@/app/components/modals/ModalFieldLabel";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ModalTextInput } from "@/app/components/modals/ModalTextInput";
import { modelDisplayName, SETTINGS_MODELS } from "@mike/client";
import { useOllamaModels } from "@/app/hooks/useOllamaModels";
import { useModelApiKeys } from "@/app/hooks/useModelApiKeys";
import { buildPlaybookModelOptions } from "@/app/components/playbooks/playbookModelOptions";
import {
  getDocumentFile,
  createPlaybook,
  deletePlaybook,
  getPlaybookConfiguration,
  getPlaybook,
  getPlaybookImport,
  listRunningPlaybookImports,
  startPlaybookImport,
  startPlaybookDraft,
  setPlaybookState,
  copyPlaybook,
  listPlaybooks,
  getPlaybookPeople,
  listPlaybookShares,
  sharePlaybook,
  revokePlaybookShare,
  reviewDocumentWithPlaybook,
  deletePlaybookRun,
  listAllPlaybookRuns,
  type PlaybookRunListItem,
  uploadLibraryDocument,
  type Playbook,
  type PlaybookImport,
  type PlaybookShare,
  type PlaybookContent,
  type PlaybookConfiguration,
  type PlaybookReviewScope,
  type PlaybookRun,
} from "@/app/lib/mikeApi";

import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import { showToast } from "@/app/components/ui/toast";
import { useWorkspaceIdentity } from "@/app/hooks/useWorkspaceIdentity";
import { assistantPathWithPlaybook } from "@/app/lib/assistantPlaybookLink";
import {
  notifyPlaybookRunsChanged,
  subscribePlaybookRunChanges,
} from "@/app/lib/playbookRunActivity";
import { usePlaybookAutosave } from "@/app/hooks/usePlaybookAutosave";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import { AddDocumentsModal } from "@/app/components/modals/AddDocumentsModal";
import { AccessModal } from "@/app/components/modals/AccessModal";
import { useAuth } from "@/app/contexts/AuthContext";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { settleBulkRequests } from "@/app/lib/bulkRequests";
import type {
  ContentVisibility,
  Document,
} from "@/app/components/shared/types";

const PLAYBOOK_IMPORT_FILE = /\.(docx|pdf)$/i;
/** How often a compiling import is checked on. */
const IMPORT_POLL_MS = 3000;

function uploadDocument(file: File): ReviewDocument {
  return {
    id: JSON.stringify(["upload", file.name, file.size, file.lastModified]),
    name: file.name,
    kind: "upload",
    file,
    status: "ready",
  };
}

function savedDocument(document: Document): ReviewDocument {
  return {
    id: JSON.stringify(["saved", document.id, document.current_version_id]),
    name: document.filename,
    kind: "saved",
    document,
    status: "ready",
  };
}

function isWordDocument(filename: string) {
  return filename.toLowerCase().endsWith(".docx");
}

async function extractReviewText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
      .promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        (content.items as Array<{ str?: string }>)
          .map((item) => item.str ?? "")
          .join(" "),
      );
    }
    return pages
      .map((text, index) => `[Page ${index + 1}]\n${text}`)
      .join("\n\n");
  }
  return file.text();
}

const LIST_TABS = ["all", "mine", "shared", "runs"] as const;
type ListTab = (typeof LIST_TABS)[number];

/**
 * Rendered by the playbooks layout, so moving between the list and a
 * playbook keeps the loaded list and any pending autosave.
 */
export function PlaybooksWorkspaceLayout() {
  const identity = useWorkspaceIdentity();
  return <PlaybooksWorkspace key={identity} />;
}

function PlaybooksWorkspace() {
  const t = useTranslations();
  const tCorrections = useTranslations("training.criterion.corrections");
  const { workspaceId, activeOrganization } = useWorkspace();
  const router = useRouter();
  const params = useParams<{ playbookId?: string }>();
  const routeId =
    typeof params?.playbookId === "string" ? params.playbookId : null;
  const isOrganization = !!workspaceId && workspaceId !== "personal";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The list's Runs tab: the caller's runs across the workspace's playbooks.
  const [allRuns, setAllRuns] = useState<PlaybookRunListItem[] | null>(null);
  const [allRunsError, setAllRunsError] = useState<string | null>(null);
  const [allRunsVersion, setAllRunsVersion] = useState(0);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [runDeleteTargets, setRunDeleteTargets] = useState<
    PlaybookRunListItem[] | null
  >(null);
  const { user } = useAuth();
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessTargetId, setAccessTargetId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // "With questions". The dialog keeps its answers while closed, so a draft
  // that fails can be retried; a new key clears them once one is ready.
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeKey, setIntakeKey] = useState(0);
  const [detailsTargetId, setDetailsTargetId] = useState<string | null>(null);
  const [shares, setShares] = useState<PlaybookShare[]>([]);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [savedFilesOpen, setSavedFilesOpen] = useState(false);
  const apiKeys = useModelApiKeys();
  const ollamaModels = useOllamaModels();
  const configuredModelOptions = useMemo(
    () => [
      ...SETTINGS_MODELS,
      ...ollamaModels.map((model) => ({
        ...model,
        label: modelDisplayName(model.id),
        source: t("playbooks.local"),
      })),
    ],
    [ollamaModels],
  );
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  // The URL decides which playbook is open; selection follows it at once so
  // the editor does not wait for navigation to finish.
  const [selectedId, setSelectedId] = useState<string | null>(routeId);
  const [syncedRouteId, setSyncedRouteId] = useState(routeId);
  if (syncedRouteId !== routeId) {
    setSyncedRouteId(routeId);
    setSelectedId(routeId);
  }
  const [content, setContent] = useState<PlaybookContent | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  // Each tab is in the URL (?tab=), on the list and on a playbook alike. Only
  // the page being shown keeps its own value in the URL.
  const [tab, setTab] = useQueryParamTab(LIST_TABS, "all", false, !routeId);
  const [playbookView, setPlaybookView] = useQueryParamTab(
    PLAYBOOK_VIEWS,
    "rules",
    false,
    !!routeId,
  );
  // Back from a playbook returns to the list tab it was opened from.
  const lastListTab = useRef<ListTab>("all");
  useEffect(() => {
    if (!routeId) lastListTab.current = tab;
  }, [routeId, tab]);
  // A run chosen from the list of all runs, opened on its playbook's Runs tab.
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const sourcesRef = useRef<PlaybookSourcesHandle>(null);
  const [search, setSearch] = useState("");
  const [editorRevision, setEditorRevision] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [configuration, setConfiguration] =
    useState<PlaybookConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // Set when the Word file replaces an existing playbook's content.
  const [importTargetId, setImportTargetId] = useState<string | null>(null);
  const [importSource, setImportSource] = useState<ReviewDocument | null>(null);
  // The import dialog steps aside while its document picker is open.
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [importName, setImportName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  // Imports compiling on the server. They run apart from the page, so closing
  // the dialog or leaving and coming back does not stop them.
  const [imports, setImports] = useState<PlaybookImport[]>([]);
  // The import the dialog's compiling screen is following, if any.
  const [followedImportId, setFollowedImportId] = useState<string | null>(null);
  const [model, setModel] = useState("");
  // The Runs tab shows the new-run form in place of a run's results.
  const [newRunOpen, setNewRunOpen] = useState(false);
  // "Run" from the table opens the form once that playbook is selected.
  const newRunFor = useRef<string | null>(null);
  // A link to a run (from History) opens it on the Runs tab.
  const searchParams = useSearchParams();
  const linkedRunId = routeId ? searchParams.get("run") : null;
  const [seenLinkedRunId, setSeenLinkedRunId] = useState<string | null>(null);
  if (linkedRunId !== seenLinkedRunId) {
    setSeenLinkedRunId(linkedRunId);
    if (linkedRunId) {
      setFocusRunId(linkedRunId);
      setNewRunOpen(false);
    }
  }
  const [reviewDocuments, setReviewDocuments] = useState<ReviewDocument[]>([]);
  // Optional: the review's own prompt already sets how it reviews.
  const [reviewInstructions, setReviewInstructions] = useState("");
  const [reviewScope, setReviewScope] = useState<PlaybookReviewScope>("full");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("strict");
  const [run, setRun] = useState<PlaybookRun | null>(null);

  const autosave = usePlaybookAutosave(
    useCallback((saved: Playbook) => {
      setPlaybooks((items) =>
        items.map((item) => (item.id === saved.id ? saved : item)),
      );
    }, []),
  );
  const selected = playbooks.find((item) => item.id === selectedId) ?? null;
  const accessPlaybook =
    playbooks.find((item) => item.id === accessTargetId) ?? null;
  const detailsPlaybook =
    playbooks.find((item) => item.id === detailsTargetId) ?? null;
  // A playbook being opened (by a link, a refresh, or from the table) shows a
  // playbook page while it loads, not the table. It follows the selection
  // rather than the URL, which still names the playbook just after Back.
  const linkedPlaybookLoading =
    !!selectedId &&
    !(selected && content) &&
    !error &&
    (loading || playbooks.some((item) => item.id === selectedId));
  const selectedLoaded = !!selected;

  function openPlaybook(
    id: string | null,
    options: { replace?: boolean; tab?: PlaybookView } = {},
  ) {
    setSelectedId(id);
    if (id === routeId) return;
    const path = id
      ? `${playbookPath(id)}${options.tab ? `?tab=${options.tab}` : ""}`
      : lastListTab.current === "all"
        ? "/playbooks"
        : `/playbooks?tab=${lastListTab.current}`;
    if (options.replace) router.replace(path);
    else router.push(path);
  }
  const visiblePlaybooks = playbooks.filter((item) => {
    const matchesTab =
      tab === "all" ||
      (isOrganization
        ? tab === "shared"
          ? item.visibility === "organization"
          : item.visibility !== "organization"
        : tab === "shared"
          ? !item.isCreator
          : item.isCreator);
    return (
      matchesTab &&
      `${item.name} ${item.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });
  // A replacement import rewrites the whole playbook when it finishes, and
  // so does every autosave: whichever lands last wins. Hold the playbook
  // read-only while one compiles. This follows the imports list, not the
  // dialog, so it holds after the dialog closes and after a reload.
  const replacingIds = new Set(
    imports.flatMap((attempt) =>
      attempt.status === "running" && attempt.playbookId
        ? [attempt.playbookId]
        : [],
    ),
  );
  const canEdit =
    !!selected && selected.canEdit === true && !replacingIds.has(selected.id);
  // LiTT: a draft cannot be used in a review until an editor marks it ready.
  const isDraft = selected?.status === "draft";
  // LiTT training: an editor who supervises someone can turn their
  // corrections into proposed rules (the server checks both again).
  const correctionPupils = usePlaybookCorrectionPupils(
    selected?.orgId ?? null,
    canEdit,
  );
  const correctionsOffered = canEdit && correctionPupils.length > 0;
  const provenance = usePlaybookProvenance(
    selected && content ? { ...selected, content } : null,
  );
  const canManageAccess = !!selected && selected.canManageAccess === true;
  const checkedPlaybooks = visiblePlaybooks.filter((item) =>
    selectedIds.has(item.id),
  );
  const deleteTargets = deleteTargetId
    ? playbooks.filter((item) => item.id === deleteTargetId)
    : selected
      ? [selected]
      : checkedPlaybooks;

  function changeContent(
    next: PlaybookContent,
    access: Pick<Playbook, "visibility"> = {
      visibility: selected?.visibility ?? "private",
    },
  ) {
    if (!selected || !canEdit) return;
    setContent(next);
    autosave.schedule({ id: selected.id, content: next, access });
  }

  /**
   * Re-read the grants after a change the server accepted, and say so when
   * the read fails rather than show the roles as they were before.
   */
  const refreshShares = useCallback(async (playbookId: string) => {
    try {
      const next = await listPlaybookShares(playbookId);
      setShares(next);
      setSharesError(null);
      // The table's Access column counts the people it is shared with.
      setPlaybooks((items) =>
        items.map((item) =>
          item.id === playbookId
            ? {
                ...item,
                sharedWith: next
                  .filter((share) => share.role !== "deny")
                  .map((share) => share.shared_with_email),
              }
            : item,
        ),
      );
    } catch (error) {
      reportFault(error, { operation: "playbooks.save" });
      setSharesError(
        userFacingApiError(error, t("playbooks.theChangeWasSavedBut")),
      );
    }
  }, []);

  function openAccess(playbook: Playbook) {
    if (busy) return;
    setAccessTargetId(playbook.id);
    setShares([]);
    setSharesError(null);
    setAccessOpen(true);
    if (playbook.canManageAccess) void refreshShares(playbook.id);
  }

  function addRule() {
    if (!content || !canEdit || busy) return;
    const rules = content.rules ?? [];
    const count =
      rules.length +
      content.topics.reduce((total, topic) => total + topic.rules.length, 0);
    const rule = createPlaybookRule(count + 1);
    changeContent({ ...content, rules: [...rules, rule] });
    setSelectedRuleId(rule.id);
  }

  /** Shows the new-run form on the Runs tab. */
  function startNewRun() {
    if (busy || isDraft) return;
    setReviewError(null);
    setNewRunOpen(true);
    setPlaybookView("runs");
  }

  /**
   * Opens a new assistant chat with this playbook attached, after saving
   * pending edits: the assistant reads the playbook as stored.
   */
  async function openInAssistant() {
    if (!selected || busy || !(await autosave.flush())) return;
    router.push(assistantPathWithPlaybook(selected.id));
  }

  const showingRunList = !routeId && tab === "runs";
  useEffect(() => {
    if (!showingRunList) return;
    let current = true;
    listAllPlaybookRuns(workspaceId).then(
      (items) => {
        if (!current) return;
        setAllRuns(items);
        setAllRunsError(null);
      },
      (err) => {
        if (!current) return;
        setAllRunsError(
          reportFault(err, {
            action: t("playbooks.loadTheRuns"),
            operation: "playbooks.review",
          }).message,
        );
        setAllRuns([]);
      },
    );
    return () => {
      current = false;
    };
  }, [showingRunList, workspaceId, allRunsVersion]);
  useEffect(
    () =>
      subscribePlaybookRunChanges(() =>
        setAllRunsVersion((count) => count + 1),
      ),
    [],
  );
  const checkedRuns = (allRuns ?? []).filter((run) =>
    selectedRunIds.has(run.id),
  );

  const runActions: PlaybookRunActionHandlers = {
    onOpen: (run) => {
      setSelectedRunIds(new Set());
      setFocusRunId(run.id);
      openPlaybook(run.playbookId, { tab: "runs" });
    },
    onOpenPlaybook: (run) => {
      setSelectedRunIds(new Set());
      openPlaybook(run.playbookId);
    },
    onDelete: (runs) => {
      if (!busy && runs.length) setRunDeleteTargets(runs);
    },
  };

  async function removeRuns() {
    const targets = runDeleteTargets ?? [];
    if (!targets.length) return;
    setBusy("delete-runs");
    try {
      const { succeeded, failed, firstError } = await settleBulkRequests(
        targets,
        (target) => deletePlaybookRun(target.id),
        // As before: a failure ends the batch and is reported; whatever
        // was not deleted stays selected for a retry.
        { stopAfterFailure: true },
      );
      const deleted = new Set(succeeded.map((target) => target.id));
      if (deleted.size) {
        // A retry after a partial failure covers only the runs left.
        setRunDeleteTargets(
          (current) => current?.filter((item) => !deleted.has(item.id)) ?? null,
        );
        setAllRuns((items) =>
          (items ?? []).filter((item) => !deleted.has(item.id)),
        );
        setSelectedRunIds(
          (ids) => new Set([...ids].filter((id) => !deleted.has(id))),
        );
      }
      if (failed.length) throw firstError;
      setRunDeleteTargets(null);
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.deleteTheRun"),
        operation: "playbooks.review",
      });
    } finally {
      // History drops what was deleted, including on a partial failure.
      notifyPlaybookRunsChanged();
      setBusy(null);
    }
  }

  async function backToList() {
    if (busy || !(await autosave.flush())) return;
    setDeleteOpen(false);
    openPlaybook(null);
  }

  const models = useMemo(
    () =>
      buildPlaybookModelOptions(configuredModelOptions, configuration, apiKeys),
    [configuration, configuredModelOptions, apiKeys],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, configuration, running] = await Promise.all([
        listPlaybooks(workspaceId),
        getPlaybookConfiguration(workspaceId),
        // Following an import is a convenience; the list loads without it.
        listRunningPlaybookImports(workspaceId).catch(() => []),
      ]);
      setPlaybooks(items);
      setConfiguration(configuration);
      setImports(running);
      setSelectedId((current) =>
        current && items.some((item) => item.id === current) ? current : null,
      );
    } catch (err) {
      setError(
        reportFault(err, {
          action: t("playbooks.loadPlaybooks"),
          operation: "playbooks.save",
        }).message,
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setModel((current) => {
      if (models.some((entry) => entry.value === current)) return current;
      if (
        configuration?.defaultModel &&
        models.some((entry) => entry.value === configuration.defaultModel)
      ) {
        return configuration.defaultModel;
      }
      return models[0]?.value ?? "";
    });
  }, [configuration?.defaultModel, models]);
  useEffect(() => {
    // The run belongs to the playbook it was produced from. Clear it with the
    // rest of the selection, or the previous playbook's summary and findings
    // render under the next playbook's heading.
    setRun(null);
    autosave.resetStatus();
    setReviewDocuments([]);
    setNewRunOpen(!!selectedId && newRunFor.current === selectedId);
    newRunFor.current = null;
    if (!selected) {
      setContent(null);
      setSelectedRuleId(null);
      return;
    }
    setContent(structuredClone(selected.content));
    setSelectedRuleId(null);
    // A link opens before the list loads, so also run once the playbook arrives.
  }, [selectedId, selectedLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // A link to a deleted playbook, or one in another workspace, shows the list.
    if (
      routeId &&
      !loading &&
      !error &&
      !playbooks.some((item) => item.id === routeId)
    )
      router.replace("/playbooks");
  }, [routeId, loading, error, playbooks, router]);

  function openImport(targetId: string | null) {
    setImportTargetId(targetId);
    setImportSource(null);
    setImportName("");
    setImportError(null);
    setImportOpen(true);
  }

  async function createFromDetails(
    details: PlaybookDetails,
    visibility: ContentVisibility,
  ): Promise<boolean> {
    setBusy("create");
    setError(null);
    try {
      const created = await createPlaybook(
        { ...details, visibility },
        workspaceId,
      );
      setPlaybooks((current) => [created, ...current]);
      setNewOpen(false);
      openPlaybook(created.id);
      return true;
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.createThePlaybook"),
        operation: "playbooks.save",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Save the details dialog through the autosave queue, so it cannot race a
   * rule edit still waiting to be written.
   */
  function saveDetails(
    target: Playbook,
    details: PlaybookDetails,
    visibility: ContentVisibility,
  ): Promise<boolean> {
    if (!target.canEdit || replacingIds.has(target.id))
      return Promise.resolve(false);
    const open = target.id === selected?.id ? content : null;
    const next = { ...(open ?? target.content), ...details };
    if (open) setContent(next);
    autosave.schedule({
      id: target.id,
      content: next,
      // Only an owner changes who can open it.
      access: {
        visibility: target.canManageAccess ? visibility : target.visibility,
      },
    });
    return autosave.flush();
  }

  /** Puts the open playbook's new state in the list, keeping its open content. */
  function replacePlaybook(saved: Playbook) {
    setPlaybooks((items) =>
      items.map((item) => (item.id === saved.id ? saved : item)),
    );
  }

  async function startDraft(request: PlaybookIntakeRequest): Promise<boolean> {
    try {
      const started = await startPlaybookDraft({ ...request, model }, workspaceId);
      setImports((current) => [started, ...current]);
      setIntakeOpen(false);
      showToast({
        tone: "info",
        title: t("playbooks.intake.startedTitle"),
        message: t("playbooks.intake.startedMessage"),
      });
      return true;
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.intake.submitAction"),
        operation: "playbooks.import",
      });
      return false;
    }
  }

  /** Marks the open draft ready, after saving what is still pending. */
  async function markReady(): Promise<boolean> {
    if (!selected || busy) return false;
    setBusy("state");
    try {
      if (!(await autosave.flush())) return false;
      replacePlaybook(await setPlaybookState(selected.id, { status: "ready" }));
      return true;
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.draft.markReadyAction"),
        operation: "playbooks.save",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function toggleModel() {
    if (!selected || busy) return;
    setBusy("state");
    try {
      if (!(await autosave.flush())) return;
      replacePlaybook(
        await setPlaybookState(selected.id, { isModel: !selected.isModel }),
      );
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.model.markAction"),
        operation: "playbooks.save",
      });
    } finally {
      setBusy(null);
    }
  }

  /** A model from the New playbook menu: the caller's own draft copy, opened. */
  async function copyModel(source: Playbook) {
    if (busy) return;
    setBusy("copy");
    try {
      const copy = await copyPlaybook(source.id, workspaceId);
      setPlaybooks((current) => [copy, ...current]);
      openPlaybook(copy.id);
      showToast({
        tone: "success",
        title: t("playbooks.model.copiedTitle"),
        message: t("playbooks.model.copied", { name: source.name }),
      });
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.model.copyAction"),
        operation: "playbooks.save",
      });
    } finally {
      setBusy(null);
    }
  }

  async function doImport() {
    if (!importSource) return;
    setBusy("import");
    setError(null);
    setImportError(null);
    try {
      if (!(await autosave.flush())) return;
      const started = await startPlaybookImport(
        importSource.kind === "upload"
          ? importSource.file
          : { documentId: importSource.document.id },
        model,
        importName,
        importTargetId ?? undefined,
        workspaceId,
      );
      setImports((current) => [started, ...current]);
      setFollowedImportId(started.id);
    } catch (err) {
      setImportError(
        reportFault(err, {
          action: "import the playbook",
          operation: "playbooks.import",
        }).message,
      );
    } finally {
      setBusy(null);
    }
  }

  function closeImport() {
    setImportOpen(false);
    setImportError(null);
    setImportTargetId(null);
    setImportSource(null);
    setImportName("");
    // Closing while compiling detaches: the import carries on and a notice
    // says when it is ready.
    setFollowedImportId(null);
  }

  /** Shows a finished import's playbook in place of what was loaded. */
  function showImported(saved: Playbook) {
    // An edit still waiting to be saved holds the content from before the
    // import; saving it now would put the old rules back.
    autosave.cancel(saved.id);
    setPlaybooks((current) =>
      current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current],
    );
    // Replacing the open playbook does not change selectedId, so the
    // selection effect will not run. Load the rewritten content here.
    if (saved.id === selectedId) {
      setContent(structuredClone(saved.content));
      setEditorRevision((current) => current + 1);
      setSelectedRuleId(null);
    }
  }

  // The latest handlers for the poll below, which outlives renders.
  const importFinished = useRef<(attempt: PlaybookImport) => Promise<void>>(
    async () => undefined,
  );
  importFinished.current = async (attempt) => {
    if (attempt.kind === "draft") return draftFinished(attempt);
    const followed = attempt.id === followedImportId;
    if (attempt.status === "failed") {
      const message =
        attempt.error ??
        t("playbooks.thePlaybookCouldNotBe");
      if (followed) {
        // Back to the form, with the chosen file still there to retry.
        setFollowedImportId(null);
        setImportError(message);
      } else {
        showToast({
          tone: "error",
          title: t("playbooks.nameWasntImported", { name: attempt.name || attempt.filename }),
          message,
        });
      }
      return;
    }
    if (!attempt.playbookId) return;
    let saved: Playbook;
    try {
      saved = await getPlaybook(attempt.playbookId);
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.openTheImportedPlaybook"),
        operation: "playbooks.import",
      });
      if (followed) closeImport();
      return;
    }
    showImported(saved);
    if (followed) {
      closeImport();
      openPlaybook(saved.id);
      return;
    }
    showToast({
      tone: "success",
      title: t("playbooks.newPlaybookReady"),
      message: t("playbooks.nameHasBeenCompiledOpenTo", { name: saved.name }),
      durationMs: 10_000,
      actions: [
        { label: t("playbooks.open"), tone: "blue", onClick: () => openPlaybook(saved.id) },
      ],
    });
  };

  /** A draft from the questionnaire ended: say so, and open it on request. */
  async function draftFinished(attempt: PlaybookImport) {
    if (attempt.status === "failed") {
      showToast({
        tone: "error",
        title: t("playbooks.intake.failedTitle"),
        message: attempt.error ?? t("playbooks.intake.failedMessage"),
        durationMs: 10_000,
        actions: [
          {
            label: t("playbooks.intake.backToQuestions"),
            tone: "blue",
            onClick: () => setIntakeOpen(true),
          },
        ],
      });
      return;
    }
    if (!attempt.playbookId) return;
    let saved: Playbook;
    try {
      saved = await getPlaybook(attempt.playbookId);
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.intake.openAction"),
        operation: "playbooks.import",
      });
      return;
    }
    showImported(saved);
    setIntakeKey((key) => key + 1);
    showToast({
      tone: "success",
      title: t("playbooks.intake.readyTitle"),
      message: t("playbooks.intake.readyMessage", { name: saved.name }),
      durationMs: 10_000,
      actions: [
        { label: t("playbooks.intake.open"), tone: "blue", onClick: () => openPlaybook(saved.id) },
      ],
    });
  }

  const compiling = busy === "import" || followedImportId !== null;
  // Each import is reported once, however many polls see it finish.
  const finishedImports = useRef(new Set<string>());
  const importIds = imports.map((attempt) => attempt.id).join(",");
  useEffect(() => {
    if (!importIds) return;
    let stopped = false;
    const timer = window.setInterval(() => {
      for (const id of importIds.split(",")) {
        void getPlaybookImport(id)
          .then(async (attempt) => {
            if (stopped || attempt.status === "running") return;
            if (finishedImports.current.has(id)) return;
            finishedImports.current.add(id);
            try {
              await importFinished.current(attempt);
            } finally {
              // Only now, with the rewritten content loaded, does a replaced
              // playbook become editable again.
              setImports((current) =>
                current.filter((item) => item.id !== id),
              );
            }
          })
          .catch(() => {
            // A missed poll is retried on the next tick.
          });
      }
    }, IMPORT_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [importIds]);

  function requestDelete(targetId?: string) {
    const targets = targetId
      ? playbooks.filter((item) => item.id === targetId)
      : selected
        ? [selected]
        : checkedPlaybooks;
    if (
      busy ||
      !targets.length ||
      targets.some((item) => !item.canManageAccess)
    )
      return;
    setDeleteTargetId(targetId ?? null);
    setDeleteOpen(true);
  }

  const tableActions: PlaybookActionHandlers = {
    onOpen: (id) => {
      setSelectedIds(new Set());
      setFocusRunId(null);
      openPlaybook(id);
    },
    onDetails: (id) => {
      if (!busy) setDetailsTargetId(id);
    },
    onRun: (id) => {
      setSelectedIds(new Set());
      setFocusRunId(null);
      setReviewError(null);
      newRunFor.current = id;
      openPlaybook(id, { tab: "runs" });
      if (id === selectedId) setNewRunOpen(true);
    },
    onPeople: openAccess,
    onDelete: requestDelete,
    onDeleteSelected: () => requestDelete(),
  };

  async function remove() {
    const targets = deleteTargets;
    if (!targets.length || targets.some((item) => !item.canManageAccess))
      return;
    setBusy("delete");
    try {
      if (!(await autosave.flush())) return;
      const { succeeded, failed, firstError } = await settleBulkRequests(
        targets,
        (target) => deletePlaybook(target.id),
        // As before: a failure ends the batch and is reported; whatever
        // was not deleted stays selected for a retry.
        { stopAfterFailure: true },
      );
      const deleted = new Set(succeeded.map((target) => target.id));
      if (deleted.size) {
        setPlaybooks((items) => items.filter((item) => !deleted.has(item.id)));
        setSelectedIds(
          (ids) => new Set([...ids].filter((id) => !deleted.has(id))),
        );
      }
      if (failed.length) throw firstError;
      if (selected) openPlaybook(null, { replace: true });
      setDeleteOpen(false);
      setDeleteTargetId(null);
    } catch (err) {
      notifyError(err, {
        action: t("playbooks.deleteThePlaybook"),
        operation: "playbooks.save",
      });
    } finally {
      setBusy(null);
    }
  }

  const pendingReviewDocuments = reviewDocuments.filter(
    (item) => item.status !== "completed",
  );

  function addReviewDocuments(candidates: ReviewDocument[]) {
    if (busy) return;
    const supported = candidates.filter((item) =>
      /\.(pdf|docx|txt)$/i.test(item.name),
    );
    setReviewError(
      supported.length < candidates.length
        ? t("playbooks.someFilesWerenTAdded")
        : null,
    );
    setReviewDocuments((current) => {
      const ids = new Set(current.map((item) => item.id));
      return [
        ...current,
        ...supported.filter((item) => {
          if (ids.has(item.id)) return false;
          ids.add(item.id);
          return true;
        }),
      ];
    });
  }

  function addReviewFiles(files: File[]) {
    addReviewDocuments(files.map(uploadDocument));
  }

  /** A playbook compiles from one Word or PDF file; a new pick replaces it. */
  function chooseImportSource(candidates: ReviewDocument[]) {
    const supported = candidates.find((item) =>
      PLAYBOOK_IMPORT_FILE.test(item.name),
    );
    if (supported) setImportSource(supported);
    setImportError(supported ? null : t("playbooks.chooseAWordDocxOr"));
  }

  async function review() {
    if (!selected || !pendingReviewDocuments.length || busy) return;
    setBusy("review");
    setError(null);
    setReviewError(null);
    try {
      if (!(await autosave.flush())) return;
      let failed = false;
      for (const item of pendingReviewDocuments) {
        setReviewDocuments((items) =>
          items.map((document) =>
            document.id === item.id
              ? { ...document, status: "reviewing", error: undefined }
              : document,
          ),
        );
        try {
          // Every reviewed document is stored, so a Word document can take
          // the review's tracked changes: an upload is saved to Library Files.
          let documentId: string;
          let documentText: string | undefined;
          let documentName: string;
          if (item.kind === "saved") {
            documentId = item.document.id;
            documentName = item.document.filename || item.name;
            if (!isWordDocument(documentName)) {
              const { blob, filename } = await getDocumentFile(
                item.document.id,
                item.document.current_version_id,
              );
              documentText = await extractReviewText(
                new File([blob], filename || documentName, { type: blob.type }),
              );
            }
          } else {
            const stored = await uploadLibraryDocument(
              { kind: "files", workspace: workspaceId ?? "personal" },
              item.file,
            );
            documentId = stored.id;
            documentName = item.file.name;
            if (!isWordDocument(documentName))
              documentText = await extractReviewText(item.file);
          }
          // A Word document is read by the server, from the stored file.
          const result = await reviewDocumentWithPlaybook(selected.id, {
            documentId,
            documentText,
            documentName,
            instructions: reviewInstructions,
            model,
            reviewMode,
            reviewScope,
          });
          setRun(result);
          // History shows it running while it runs on the server.
          notifyPlaybookRunsChanged();
          setReviewDocuments((items) =>
            items.map((document) =>
              document.id === item.id
                ? { ...document, status: "completed", error: undefined }
                : document,
            ),
          );
        } catch (err) {
          failed = true;
          const error = reportFault(err, {
            action: t("playbooks.reviewTheDocument"),
            operation: "playbooks.review",
          }).message;
          setReviewDocuments((items) =>
            items.map((document) =>
              document.id === item.id
                ? { ...document, status: "failed", error }
                : document,
            ),
          );
        }
      }
      if (!failed) {
        setReviewDocuments([]);
        setNewRunOpen(false);
        setPlaybookView("runs");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        shrink
        breadcrumbs={
          linkedPlaybookLoading
            ? [
                { label: t("playbooks.intake.breadcrumb"), onClick: () => openPlaybook(null) },
                { loading: true, skeletonClassName: "w-40" },
              ]
            : selected
              ? [
                  {
                    label: t("playbooks.intake.breadcrumb"),
                    onClick: () => void backToList(),
                  },
                  {
                    label: content?.name || selected.name,
                    title: content?.name || selected.name,
                  },
                ]
              : [{ label: t("playbooks.intake.breadcrumb") }]
        }
        actionGroups={
          linkedPlaybookLoading
            ? []
            : selected
              ? [
                  autosave.status !== "idle"
                    ? [
                        {
                          type: "custom" as const,
                          render: (
                            <span
                              role="status"
                              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm ${autosave.status === "error" ? "text-red-600" : "text-gray-500"}`}
                            >
                              {autosave.status === "saved" && (
                                <Check
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5 text-green-600"
                                />
                              )}
                              {autosave.status === "saving"
                                ? t("playbooks.savingStatus")
                                : autosave.status === "error"
                                  ? t("playbooks.couldnTSave")
                                  : t("playbooks.saved")}
                            </span>
                          ),
                        },
                      ]
                    : [],
                  [
                    {
                      onClick: () => openAccess(selected),
                      title: t("playbooks.playbookPeople"),
                      iconOnly: true,
                      icon: <Users aria-hidden="true" className="h-4 w-4" />,
                    },
                    {
                      type: "custom",
                      render: (
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <HeaderButtonUI
                              iconOnly
                              aria-label={t("playbooks.playbookActions")}
                              disabled={!!busy}
                            >
                              <MoreHorizontal
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                            </HeaderButtonUI>
                          </DropdownTrigger>
                          <DropdownContent align="end" className="w-52">
                            <DropdownItem
                              onSelect={() => setDetailsTargetId(selected.id)}
                            >
                              <Pencil aria-hidden="true" className="h-4 w-4" />
                              {canEdit ? t("playbooks.editDetails") : t("playbooks.viewDetails")}
                            </DropdownItem>
                            {canEdit && (
                              <DropdownItem
                                disabled={isDraft}
                                onSelect={() => void toggleModel()}
                              >
                                <Star aria-hidden="true" className="h-4 w-4" />
                                {selected.isModel ? t("playbooks.model.unmark") : t("playbooks.model.mark")}
                              </DropdownItem>
                            )}
                            {canEdit && (
                              <DropdownItem
                                onSelect={() => openImport(selected.id)}
                              >
                                <RefreshCw
                                  aria-hidden="true"
                                  className="h-4 w-4"
                                />
                                {t("playbooks.replaceFromFile")}
                              </DropdownItem>
                            )}
                            {canManageAccess && (
                              <DropdownItem
                                variant="destructive"
                                onSelect={() => requestDelete()}
                              >
                                <Trash2
                                  aria-hidden="true"
                                  className="h-4 w-4"
                                />
                                {t("playbooks.deletePlaybook")}
                              </DropdownItem>
                            )}
                          </DropdownContent>
                        </Dropdown>
                      ),
                    },
                  ],
                  [
                    {
                      type: "custom",
                      render: (
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <HeaderButtonUI disabled={!!busy}>
                              <Play
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
                              {t("playbooks.use")}
                            </HeaderButtonUI>
                          </DropdownTrigger>
                          <DropdownContent align="end" className="w-52">
                            <DropdownItem disabled={isDraft} onSelect={startNewRun}>
                              <ClipboardCheck
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                              {t("playbooks.runPlaybook")}
                            </DropdownItem>
                            <DropdownItem
                              disabled={isDraft}
                              onSelect={() => void openInAssistant()}
                            >
                              <MessageSquare
                                aria-hidden="true"
                                className="h-4 w-4"
                              />
                              {t("playbooks.useInAssistant")}
                            </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                      ),
                    },
                  ],
                ]
              : [
                  [
                    {
                      type: "search",
                      value: search,
                      onChange: setSearch,
                      placeholder:
                        tab === "runs" ? t("playbooks.searchRuns") : t("playbooks.searchPlaybooks2"),
                    },
                    {
                      type: "custom",
                      render: (
                        <NewPlaybookMenu
                          disabled={loading || !!busy}
                          models={playbookModels(playbooks)}
                          onModel={(source) => void copyModel(source)}
                          onQuestions={() => setIntakeOpen(true)}
                          onImport={() => openImport(null)}
                          onBlank={() => setNewOpen(true)}
                        />
                      ),
                    },
                  ],
                ]
        }
      />
      {linkedPlaybookLoading ? (
        <PlaybookPageSkeleton />
      ) : selected && content ? (
        <>
          <PlaybookToolbar
            disabled={!!busy}
            canEdit={canEdit}
            view={playbookView}
            onViewChange={setPlaybookView}
            onAddRule={addRule}
            onUpload={() => sourcesRef.current?.upload()}
            onNewRun={startNewRun}
            runDisabled={isDraft}
            correctionsLabel={
              correctionsOffered ? tCorrections("tab") : undefined
            }
          />
          {isDraft && (
            <PlaybookDraftBanner
              content={content}
              canEdit={canEdit}
              disabled={!!busy}
              onMarkReady={markReady}
            />
          )}
          {playbookView === "corrections" && correctionsOffered ? (
            <PlaybookCorrections
              key={selected.id}
              playbookId={selected.id}
              pupils={correctionPupils}
              models={models}
              model={model}
              onModelChange={setModel}
              disabled={!!busy}
              onPlaybookChanged={showImported}
            />
          ) : playbookView === "runs" ? (
            <PlaybookRuns
              key={selected.id}
              playbookId={selected.id}
              latestRun={run}
              initialRunId={focusRunId}
              canRun={!busy && !isDraft}
              composing={newRunOpen}
              onNewRun={startNewRun}
              onCloseNewRun={() => setNewRunOpen(false)}
              newRun={
                <PlaybookNewRun
                  documents={reviewDocuments}
                  onAddFiles={addReviewFiles}
                  onRemoveDocument={(id) =>
                    setReviewDocuments((items) =>
                      items.filter((item) => item.id !== id),
                    )
                  }
                  onAddDocuments={() => setSavedFilesOpen(true)}
                  instructions={reviewInstructions}
                  onInstructionsChange={setReviewInstructions}
                  model={model}
                  onModelChange={(value) => {
                    setModel(value);
                    setReviewError(null);
                  }}
                  mode={reviewMode}
                  onModeChange={setReviewMode}
                  scope={reviewScope}
                  onScopeChange={setReviewScope}
                  error={reviewError}
                  reviewing={busy === "review"}
                  disabled={!!busy}
                  onStart={() => void review()}
                  onCancel={() => {
                    setNewRunOpen(false);
                    setReviewError(null);
                  }}
                />
              }
            />
          ) : playbookView === "references" ? (
            <PlaybookSources
              ref={sourcesRef}
              key={selected.id}
              playbookId={selected.id}
              sourceFilename={selected.sourceFilename}
              revision={`${editorRevision}:${selected.sourceFilename ?? ""}`}
              canEdit={canEdit && !busy}
            />
          ) : (
            <PlaybookEditor
              key={`${selected.id}:${editorRevision}`}
              content={content}
              onChange={changeContent}
              selectedRuleId={selectedRuleId}
              onSelectRule={setSelectedRuleId}
              disabled={!!busy || !canEdit}
              provenance={provenance}
            ></PlaybookEditor>
          )}
        </>
      ) : (
        <>
          <TableToolbar
            items={
              isOrganization
                ? [
                    { id: "all", label: t("playbooks.all") },
                    { id: "mine", label: t("playbooks.private") },
                    { id: "shared", label: t("playbooks.public") },
                    { id: "runs", label: t("playbooks.runs") },
                  ]
                : [
                    { id: "all", label: t("playbooks.all") },
                    { id: "mine", label: t("playbooks.myPlaybooks") },
                    { id: "shared", label: t("playbooks.sharedWithMe") },
                    { id: "runs", label: t("playbooks.runs") },
                  ]
            }
            active={tab}
            onChange={(next) => {
              setTab(next as ListTab);
              setSelectedIds(new Set());
              setSelectedRunIds(new Set());
            }}
            actions={
              // One "Actions" menu for the selection, as on other tables.
              tab === "runs" ? (
                checkedRuns.length > 0 ? (
                  <SelectionActionsMenu
                    renderItems={(close) => (
                      <PlaybookRunActionItems
                        {...runActions}
                        runs={checkedRuns}
                        disabled={!!busy}
                        onActionChosen={close}
                        onDeselect={() => setSelectedRunIds(new Set())}
                      />
                    )}
                  />
                ) : undefined
              ) : checkedPlaybooks.length > 0 ? (
                <SelectionActionsMenu
                  renderItems={(close) => (
                    <PlaybookActionItems
                      {...tableActions}
                      playbooks={checkedPlaybooks}
                      disabled={!!busy}
                      onActionChosen={close}
                      onDeselect={() => setSelectedIds(new Set())}
                    />
                  )}
                />
              ) : undefined
            }
          />
          {tab === "runs" ? (
            <PlaybookRunsTable
              runs={allRuns}
              error={allRunsError}
              onRetry={() => {
                setAllRuns(null);
                setAllRunsError(null);
                setAllRunsVersion((count) => count + 1);
              }}
              search={search}
              disabled={!!busy}
              selectedIds={selectedRunIds}
              onSelect={setSelectedRunIds}
              {...runActions}
            />
          ) : (
            <PlaybookTable
              playbooks={visiblePlaybooks}
              loading={loading}
              error={error}
              filtered={!!search.trim()}
              emptyContext={
                tab === "all"
                  ? "all"
                  : isOrganization
                    ? tab === "shared"
                      ? "public"
                      : "private"
                    : tab === "shared"
                      ? "shared"
                      : "mine"
              }
              disabled={!!busy}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              {...tableActions}
              onRetry={() => void load()}
              onImport={() => openImport(null)}
              onCreate={() => setNewOpen(true)}
              // Imports compiling on the server show as loading rows.
              compiling={imports.filter((attempt) =>
                `${attempt.name ?? ""} ${attempt.filename}`
                  .toLowerCase()
                  .includes(search.trim().toLowerCase()),
              )}
              showNewImports={tab === "all" || tab === "mine"}
            />
          )}
        </>
      )}
      <PlaybookIntakeModal
        key={intakeKey}
        open={intakeOpen}
        organizationName={
          isOrganization ? (activeOrganization?.name ?? "") : null
        }
        models={models}
        model={model}
        onModelChange={setModel}
        onClose={() => setIntakeOpen(false)}
        onSubmit={startDraft}
      />
      <NewPlaybookModal
        open={newOpen}
        organizationName={
          isOrganization ? (activeOrganization?.name ?? "") : null
        }
        onClose={() => setNewOpen(false)}
        onCreate={createFromDetails}
      />
      {detailsPlaybook && (
        <PlaybookDetailsModal
          open
          playbook={
            replacingIds.has(detailsPlaybook.id)
              ? { ...detailsPlaybook, canEdit: false }
              : detailsPlaybook
          }
          content={
            detailsPlaybook.id === selected?.id && content
              ? content
              : detailsPlaybook.content
          }
          workspaceName={activeOrganization?.name ?? null}
          onClose={() => setDetailsTargetId(null)}
          onSave={(details, visibility) =>
            saveDetails(detailsPlaybook, details, visibility)
          }
          onPeople={() => {
            setDetailsTargetId(null);
            openAccess(detailsPlaybook);
          }}
        />
      )}
      {accessPlaybook && accessOpen && (
        <AccessModal
          open={accessOpen}
          onClose={() => setAccessOpen(false)}
          resource={{ id: accessPlaybook.id }}
          fetchAccess={getPlaybookPeople}
          currentUserEmail={user?.email ?? null}
          currentUserId={user?.id ?? null}
          breadcrumb={[
            t("playbooks.intake.breadcrumb"),
            accessPlaybook.name || t("playbooks.untitledPlaybook"),
            t("playbooks.access"),
          ]}
          access={{
            grants: shares.map((share) => ({
              email: share.shared_with_email,
              role: share.role,
            })),
            orgId: accessPlaybook.orgId,
            ownerLabel: t("playbooks.playbookOwners"),
            resourceNoun: "playbook",
            canManage: accessPlaybook.canManageAccess,
            visibility: accessPlaybook.visibility,
            // Members can view and run a public playbook; editing is given
            // person by person.
            publicMemberRole: "viewer",
            error: sharesError,
            onGrant: async (email, role) => {
              await sharePlaybook(accessPlaybook.id, { emails: [email], role });
              await refreshShares(accessPlaybook.id);
            },
            onRevoke: async (email) => {
              const share = shares.find(
                (entry) =>
                  entry.shared_with_email.trim().toLowerCase() ===
                  email.trim().toLowerCase(),
              );
              if (share) await revokePlaybookShare(accessPlaybook.id, share.id);
              await refreshShares(accessPlaybook.id);
            },
          }}
        />
      )}
      <AddDocumentsModal
        open={savedFilesOpen}
        onClose={() => setSavedFilesOpen(false)}
        breadcrumb={[t("playbooks.intake.breadcrumb"), t("playbooks.addDocuments")]}
        uploadStateId="playbook-review"
        onSelect={(documents) => {
          setSavedFilesOpen(false);
          addReviewDocuments(documents.map(savedDocument));
        }}
      />
      <AddDocumentsModal
        open={importPickerOpen}
        onClose={() => setImportPickerOpen(false)}
        breadcrumb={[
          t("playbooks.intake.breadcrumb"),
          importTargetId ? "Replace from file" : t("playbooks.importPlaybook"),
          t("playbooks.addDocument"),
        ]}
        uploadStateId="playbook-import"
        onSelect={(documents) => {
          setImportPickerOpen(false);
          if (documents.length)
            chooseImportSource(documents.map(savedDocument));
        }}
      />
      <ConfirmPopup
        open={!!runDeleteTargets}
        title={runDeleteTargets?.length === 1 ? t("playbooks.deleteRun") : t("playbooks.deleteRuns")}
        message={
          runDeleteTargets?.length === 1
            ? t("playbooks.runOfNameWillBeDeleted", { name: runDeleteTargets[0].documentName || t("playbooks.untitledDocument") })
            : t("playbooks.selectedRunsWillBeDeleted", { count: runDeleteTargets?.length ?? 0 })
        }
        confirmLabel={t("playbooks.delete")}
        confirmVariant="danger"
        confirmStatus={busy === "delete-runs" ? "loading" : "idle"}
        onConfirm={() => void removeRuns()}
        onCancel={() => {
          if (!busy) setRunDeleteTargets(null);
        }}
      />
      <ConfirmPopup
        open={deleteOpen}
        title={
          deleteTargets.length === 1 ? t("playbooks.deletePlaybook2") : t("playbooks.deletePlaybooks")
        }
        message={
          deleteTargets.length === 1
            ? t("playbooks.playbookNameAndItsRulesWillBeDeleted", { name: deleteTargets[0].name })
            : t("playbooks.lengthSelectedPlaybooksAndTheirRules", { length: deleteTargets.length })
        }
        confirmLabel={t("playbooks.delete")}
        confirmVariant="danger"
        confirmStatus={busy === "delete" ? "loading" : "idle"}
        onConfirm={() => void remove()}
        onCancel={() => {
          if (!busy) {
            setDeleteOpen(false);
            setDeleteTargetId(null);
          }
        }}
      />
      <Modal
        open={importOpen && !importPickerOpen}
        onClose={() => {
          if (busy !== "import") closeImport();
        }}
        size="sm"
        className="h-auto max-h-[calc(100dvh-2rem)]"
        breadcrumbs={[
          t("playbooks.intake.breadcrumb"),
          importTargetId ? "Replace from file" : t("playbooks.importPlaybook"),
        ]}
        // While compiling, the dialog shows only the progress screen, and
        // closing it leaves the import compiling.
        primaryAction={
          compiling
            ? {
                label: t("playbooks.close"),
                variant: "primary",
                onClick: closeImport,
                // The upload must finish before there is an import to leave.
                disabled: busy === "import",
              }
            : {
                label: t("playbooks.compile"),
                icon: <WandSparkles className="h-4 w-4" />,
                variant: "blue",
                disabled: !importSource || !model || !!busy,
                onClick: () => void doImport(),
              }
        }
        cancelAction={
          compiling ? false : { label: t("playbooks.cancel"), onClick: closeImport }
        }
      >
        {compiling ? (
          <div
            role="status"
            className="flex flex-col items-center px-6 pb-12 pt-8 text-center"
          >
            <Loader2
              aria-hidden="true"
              className="h-6 w-6 animate-spin text-gray-400 motion-reduce:animate-none"
            />
            <p className="mt-4 text-sm font-medium text-gray-900">
              {t("playbooks.compilingYourPlaybook")}
            </p>
            <p className="mt-1 max-w-xs text-xs text-gray-500">
              {t("playbooks.thisCanTakeAFewMinutes")}
            </p>
          </div>
        ) : (
          <div
            data-modal-scroll="vertical"
            className="space-y-4 overflow-y-auto pb-4"
          >
            {importError && (
              <div
                role="alert"
                className="flex items-start gap-2 text-sm text-red-600"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{importError}</span>
              </div>
            )}
            {!importTargetId && (
              <div>
                <ModalFieldLabel htmlFor="playbook-import-name">
                  {t("playbooks.playbookNameOptional")}
                </ModalFieldLabel>
                <ModalTextInput
                  id="playbook-import-name"
                  value={importName}
                  onChange={(event) => setImportName(event.target.value)}
                />
              </div>
            )}
            <div>
              <p
                id="playbook-import-document-label"
                className="mb-2 block text-xs font-medium text-gray-700"
              >
                {t("playbooks.addDocument")}
              </p>
              <PlaybookReviewDocuments
                documents={importSource ? [importSource] : []}
                disabled={busy === "import"}
                onAdd={(files) => chooseImportSource(files.map(uploadDocument))}
                onAddDocuments={() => setImportPickerOpen(true)}
                onRemove={() => setImportSource(null)}
                labelledBy="playbook-import-document-label"
                emptyPrompt={t("playbooks.dragAndDropAWord")}
                addMorePrompt={t("playbooks.dropAnotherFileHereOr")}
              />
            </div>
            <div>
              <ModalFieldLabel htmlFor="playbook-import-model">
                {t("playbooks.compilationModel")}
              </ModalFieldLabel>
              {models.length > 0 ? (
                <ModalSelect
                  id="playbook-import-model"
                  value={model}
                  onChange={(value) => {
                    setModel(value);
                    setImportError(null);
                  }}
                  options={models}
                  menuClassName="max-h-64"
                />
              ) : (
                <p className="text-sm text-warning">
                  {t("playbooks.noCompilationModelIsAvailable")}{" "}
                  <a href="/account/api-keys" className="underline">
                    {t("playbooks.configureAnApiKey")}
                  </a>{" "}
                  {t("playbooks.orEnableALocalModel")}
                </p>
              )}
            </div>
            <p className="text-xs text-gray-500">
              {importTargetId
                ? t("playbooks.theCompiledRulesReplaceThe")
                : t("playbooks.youCanEditTheRules")}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
