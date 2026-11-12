import { clientTranslator } from "@mike/client";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Library, X } from "lucide-react";
import {
  ExcerptModalUI,
  ExcerptPillUI,
  PlaybookPillUI,
  slashCommandQueryFromValue,
  withoutSlashCommand,
  workflowSlashCommandFromTitle,
} from "@mike/ui";
import {
  serializeExcerpts,
  type MessageExcerpt,
  NO_MODELS_MESSAGES,
  isOrganizationNoModelsReason,
  routerSelections as routerSelectionsFromProfile,
  type RouterSelections,
} from "@mike/client";
import { WorkflowModal } from "../workflows/WorkflowModal";
import { PlaybookModal, playbookTitle } from "../playbooks/PlaybookModal";
import { ChatInput as ChatInputShell } from "../../../shared/chat/ChatInput";
import type {
  TrainingConfidenceLevel,
  TrainingTurnMode,
} from "@mike/contracts";
import {
  focusTrainingAttempt,
  isTrainingAttemptReady,
  useTrainingStageStale,
  TrainingAttemptFieldUI,
  TrainingConfidenceUI,
  TrainingModesUI,
  type TrainingModesState,
  useTrainingReply,
  withTrainingReply,
} from "@mike/ui";
import { useTrainingText } from "../../i18n/useTrainingText";
import { getWordTrainingTurn } from "../../api/client";
import {
  getApiKeyStatus,
  failedUploadMessage,
  getUserProfile,
  listWorkflows,
  uploadStandaloneDocuments,
  UploadBatchError,
  type ApiKeyStatus,
  type UploadOutcome,
  type UploadProgress,
} from "../../api/mikeApi";
import { useSelectedModel } from "../../hooks/useSelectedModel";
import type { Document, Workflow } from "../../types";
import {
  partitionSupportedDocumentFiles,
  SUPPORTED_DOCUMENT_ACCEPT,
  unsupportedDocumentWarningMessage,
} from "../../lib/documentUpload";
import { EditApplyModeMenu } from "./EditApplyModeMenu";
import type { WordEditApplyMode } from "../../lib/wordChatSettings";
import { AddDocumentsModal } from "../documents/AddDocumentsModal";
import { FileTypeIcon } from "../documents/DirectoryIcons";
import { DocumentSourceMenu } from "../documents/DocumentSourceMenu";
import { ModelToggle } from "./ModelToggle";
import { openApiKeysPage } from "../shell/ApiKeyBanner";
import type {
  PlaybookAttachment,
  WorkflowAttachment,
  ReasoningLevel,
  WordChatSubmission,
  WordChatSubmitOptions,
} from "../../lib/wordChatTypes";
import {
  isModelAvailable,
  noModelsReason,
  unavailableModelMessage,
} from "../../lib/modelCatalog";
import { reportFault, notifyError } from "../../lib/notify";
import { loadWithRetry } from "../../lib/composerPreflight";
import {
  WORD_WORKFLOW_SLASH_MENU_ID,
  WorkflowSlashMenu,
} from "./WorkflowSlashMenu";
import { useTranslations } from "use-intl";

/** The approach field of the training composer; «Responder» focuses it. */
const TRAINING_ATTEMPT_ID = "word-training-attempt";

const selectModelMessage = (): string => clientTranslator()("word.selectModelBeforeSending");

/** Where a model warning leads: the picker, or the web app's API keys. */
type ModelErrorAction = "choose-model" | "api-keys";

interface ModelError {
  message: string;
  action?: ModelErrorAction;
}

/**
 * The picker has no model to offer. The user's own keys are fixed in Bring
 * Your Own Keys, so the warning links there; an organization's providers are
 * only an admin's to fix, so that warning says whom to ask and links nowhere,
 * as on the web.
 */
function noModelsError(
  status: ApiKeyStatus | null,
  selections: RouterSelections | null,
  personalMessage?: string,
): ModelError {
  const reason = noModelsReason(status, selections ?? {});
  if (isOrganizationNoModelsReason(reason)) {
    return { message: NO_MODELS_MESSAGES[reason] };
  }
  return {
    message: personalMessage ?? NO_MODELS_MESSAGES[reason],
    action: "api-keys",
  };
}

export interface ChatInputHandle {
  setDraft: (prompt: string) => void;
  requestDocuments: () => void;
  /** Quotes a passage of an assistant response above the next message. */
  addExcerpt: (excerpt: MessageExcerpt) => void;
}

interface ChatInputProps {
  sessionKey: number;
  chatModel?: string | null;
  lastSelectedModel?: string | null;
  chatReasoningLevel?: ReasoningLevel | null;
  lastSelectedReasoningLevel: ReasoningLevel;
  onModelSelected: (model: string) => Promise<void>;
  onReasoningSelected: (level: ReasoningLevel) => Promise<void>;
  isResponseLoading: boolean;
  requestError: string | null;
  selectedWorkflow: WorkflowAttachment | null;
  onSelectedWorkflowChange: (workflow: WorkflowAttachment | null) => void;
  onSubmit: (
    submission: WordChatSubmission,
    options?: WordChatSubmitOptions,
  ) => Promise<void>;
  onCancel: () => void;
  onDismissRequestError: () => void;
  onTurnReady: () => void;
  containerRef: React.Ref<HTMLDivElement>;
  editApplyMode: WordEditApplyMode;
  onEditApplyModeChange: (mode: WordEditApplyMode) => void;
  /**
   * LiTT training: the chat the next turn continues, whose notes the hint
   * ladder is counted from. Null for a new chat and for a chat kept on this
   * device only: the server keeps no notes of it and offers no hint there.
   */
  trainingChatId?: string | null;
  /** LiTT training: false where the server cannot count rungs (device-only chats). */
  trainingModesAllowed?: boolean;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      sessionKey,
      chatModel,
      lastSelectedModel,
      chatReasoningLevel,
      lastSelectedReasoningLevel,
      onModelSelected,
      onReasoningSelected,
      isResponseLoading,
      requestError,
      selectedWorkflow,
      onSelectedWorkflowChange,
      onSubmit,
      onCancel,
      onDismissRequestError,
      onTurnReady,
      containerRef,
      editApplyMode,
      onEditApplyModeChange,
      trainingChatId = null,
      trainingModesAllowed = false,
    },
    ref,
  ): React.ReactElement {
    const t = useTranslations();
    const [input, setInput] = useState("");
    const [attachedDocuments, setAttachedDocuments] = useState<Document[]>([]);
    const [excerpts, setExcerpts] = useState<MessageExcerpt[]>([]);
    const [openExcerpt, setOpenExcerpt] = useState<MessageExcerpt | null>(null);
    // An annotated excerpt already says what is being asked about it.
    const hasAnnotatedExcerpt = excerpts.some((excerpt) => excerpt.note);
    const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
    const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
    // A playbook picked to run on the next message, as the web composer
    // keeps it: local to the composer, cleared once the message is accepted.
    const [selectedPlaybook, setSelectedPlaybook] =
      useState<PlaybookAttachment | null>(null);
    const [playbookModalOpen, setPlaybookModalOpen] = useState(false);
    const [playbookModalInitialId, setPlaybookModalInitialId] = useState<
      string | undefined
    >(undefined);
    const [uploadingLocalFiles, setUploadingLocalFiles] = useState(false);
    const [documentUploadError, setDocumentUploadError] = useState<
      string | null
    >(null);
    const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null);
    const [keyStatusLoading, setKeyStatusLoading] = useState(true);
    // Null until the profile loads: stored router selections cannot be
    // checked against saved Model Selections before then.
    const [routerSelections, setRouterSelections] =
      useState<RouterSelections | null>(null);
    const [preflightAttempt, setPreflightAttempt] = useState(0);
    const [profileLastSelectedModel, setProfileLastSelectedModel] = useState<
      string | null
    >(null);
    const [profileLoaded, setProfileLoaded] = useState(false);
    const [model, setModel, modelSettingsResolved] = useSelectedModel({
      sessionKey,
      chatModel,
      lastSelectedModel: lastSelectedModel ?? profileLastSelectedModel,
      routerSelections: profileLoaded ? routerSelections : null,
      apiKeyStatus: keyStatus,
    });
    const [modelError, setModelError] = useState<ModelError | null>(null);
    // The "Select a model" warning opens the picker when it has models, or
    // points to Bring Your Own Keys in the web app when it has none.
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const [hasModels, setHasModels] = useState<boolean | null>(null);
    // LiTT training ("Tu turno primero"): a pasante writes their own
    // approach before each turn. The server decides; this only shows it.
    const [needsAttempt, setNeedsAttempt] = useState(false);
    const [needsConfidence, setNeedsConfidence] = useState(false);
    const [trainingModes, setTrainingModes] = useState<{
      chatId: string | null;
      state: TrainingModesState;
    } | null>(null);
    // A hint or a round asked for with no question written: the text the
    // composer held then. It is said until the person types.
    const [modeErrorAt, setModeErrorAt] = useState<string | null>(null);
    const trainingText = useTrainingText();
    const [attempt, setAttempt] = useState("");
    const [attemptError, setAttemptError] = useState(false);
    const sentDraftRef = useRef<{
      input: string;
      attempt: string;
      attachedDocuments: Document[];
      excerpts: MessageExcerpt[];
      workflow: WorkflowAttachment | null;
      playbook: PlaybookAttachment | null;
    } | null>(null);
    const [confidence, setConfidence] = useState<TrainingConfidenceLevel | null>(
      null,
    );
    const [confidenceError, setConfidenceError] = useState(false);
    // «Responder» on a basis question brings it, quoted, to the approach.
    useTrainingReply({
      enabled: needsAttempt,
      onReply: (question) => {
        setAttempt((current) => withTrainingReply(current, question));
        setAttemptError(false);
        focusTrainingAttempt(TRAINING_ATTEMPT_ID);
      },
    });
    // The stage is read when the pane opens and again whenever the server
    // refuses a turn for a missing approach or mark (an urgency pass ended,
    // the thermometer was switched on): what this composer showed is stale.
    const [stageGeneration, setStageGeneration] = useState(0);
    useTrainingStageStale(() => setStageGeneration((value) => value + 1));
    useEffect(() => {
      let cancelled = false;
      getWordTrainingTurn(
        trainingModesAllowed ? trainingChatId : null,
        trainingModesAllowed ? "cloud" : "local",
      ).then(
        (turn) => {
          if (cancelled) return;
          setNeedsAttempt(turn.attemptRequired);
          setNeedsConfidence(turn.confidenceRequired);
          setTrainingModes({
            chatId: trainingChatId,
            state: {
              // With storage on this device the server cannot count rungs
              // (and refuses with training_mode_not_allowed): none is offered.
              modes: trainingModesAllowed ? turn.modes : [],
              nextHintLevel: turn.nextHintLevel,
              counterpartNextStep: turn.counterpartNextStep,
            },
          });
        },
        () => {},
      );
      return () => {
        cancelled = true;
      };
    }, [sessionKey, stageGeneration, trainingChatId, trainingModesAllowed]);
    // A turn that just ended may have been a hint or a round turn: the server
    // counts again from the notes it wrote.
    const wasLoadingRef = useRef(isResponseLoading);
    useEffect(() => {
      if (wasLoadingRef.current && !isResponseLoading) {
        setStageGeneration((value) => value + 1);
      }
      wasLoadingRef.current = isResponseLoading;
    }, [isResponseLoading]);
    // The modes are counted per chat: those of another chat wait for their own reading.
    const modesState: TrainingModesState | null =
      needsAttempt &&
      trainingModes &&
      trainingModes.chatId === trainingChatId &&
      trainingModes.state.modes.length > 0
        ? trainingModes.state
        : null;
    const [profileLastSelectedReasoningLevel, setProfileLastSelectedReasoningLevel] =
      useState<ReasoningLevel>(lastSelectedReasoningLevel);
    const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(
      chatReasoningLevel ?? lastSelectedReasoningLevel ?? "high",
    );
    const [slashWorkflows, setSlashWorkflows] = useState<Workflow[] | null>(
      null,
    );
    const [activeSlashIndex, setActiveSlashIndex] = useState(0);
    const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
    const localFileInputRef = useRef<HTMLInputElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const [compactControls, setCompactControls] = useState(false);
    const mountedRef = useRef(true);
    const uploadGenerationRef = useRef(0);
    const modelSelectionSaveRef = useRef<Promise<void>>(Promise.resolve());
    const reasoningManuallySelectedRef = useRef(false);
    const resolvedReasoningLevel = reasoningManuallySelectedRef.current
      ? reasoningLevel
      : (chatReasoningLevel ??
        lastSelectedReasoningLevel ??
        profileLastSelectedReasoningLevel ??
        "high");
    const chatSettingsLoading =
      chatModel === undefined ||
      chatReasoningLevel === undefined ||
      !modelSettingsResolved;

    const slashQuery = slashCommandQueryFromValue(input);
    const matchingSlashWorkflows = (slashWorkflows ?? []).filter((workflow) =>
      workflowSlashCommandFromTitle(workflow.metadata.title)?.startsWith(
        slashQuery ?? "",
      ),
    );
    const slashCommandsLoading = slashQuery !== null && slashWorkflows === null;
    const slashMenuOpen =
      !slashMenuDismissed &&
      !selectedWorkflow &&
      slashQuery !== null &&
      matchingSlashWorkflows.length > 0;
    const resolvedSlashIndex = Math.min(
      activeSlashIndex,
      Math.max(0, matchingSlashWorkflows.length - 1),
    );

    useImperativeHandle(
      ref,
      () => ({
        setDraft: (prompt: string): void => setInput(prompt),
        requestDocuments: (): void => setDocumentsModalOpen(true),
        addExcerpt: (excerpt: MessageExcerpt): void =>
          setExcerpts((current) =>
            current.some(
              (item) => item.text === excerpt.text && item.note === excerpt.note,
            )
              ? current
              : [...current, excerpt],
          ),
      }),
      [],
    );

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        uploadGenerationRef.current += 1;
      };
    }, []);

    useEffect(() => {
      if (!slashCommandsLoading) return;
      let cancelled = false;
      void listWorkflows("assistant")
        .then((workflows) => {
          if (!cancelled) setSlashWorkflows(workflows);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          // The user typed "/" and expects a menu. An empty list here is
          // indistinguishable from "you have no workflows", so say so.
          setSlashWorkflows([]);
          notifyError(reason, {
            action: clientTranslator()("word.actionLoadWorkflows"),
            dedupeKey: "slash-workflows",
            page: "Assistant",
            operation: "word_chat.turn",
            onRetry: () => {
              setSlashWorkflows(null);
            },
          });
        });
      return () => {
        cancelled = true;
      };
    }, [slashCommandsLoading]);

    useEffect(() => {
      const composer = composerRef.current;
      if (!composer || typeof ResizeObserver === "undefined") return;
      const update = (): void => setCompactControls(composer.offsetWidth < 430);
      update();
      const observer = new ResizeObserver(update);
      observer.observe(composer);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      let cancelled = false;
      // Three-state preflight: while it runs the model toggle stays neutral
      // (no premature "No Models"); each request retries once with backoff; after a
      // final failure keyStatus stays null and availability FAILS OPEN (the
      // backend still authoritatively rejects models it cannot serve).
      void Promise.all([
        loadWithRetry(getApiKeyStatus, {
          onFinalFailure: (error) => {
            if (cancelled) return;
            // Availability fails open (the backend still rejects models it
            // cannot serve), but the toggle will look wrong until this
            // succeeds, so the user is told rather than left guessing.
            notifyError(error, {
              action: clientTranslator()("word.actionLoadModels"),
              dedupeKey: "model-preflight",
              page: "Assistant",
              operation: "word_chat.turn",
              onRetry: () => {
                setKeyStatusLoading(true);
                setPreflightAttempt((count) => count + 1);
              },
            });
          },
        }),
        loadWithRetry(getUserProfile, {
          onFinalFailure: (error) =>
            console.warn(
              "[word-addin] user profile unavailable after retry; router models hidden this session",
              error,
            ),
        }),
      ]).then(([status, profile]) => {
        if (cancelled) return;
        setKeyStatus(status);
        if (profile) {
          setRouterSelections(routerSelectionsFromProfile(profile));
          setProfileLastSelectedModel(profile.lastSelectedChatModel ?? null);
          setProfileLastSelectedReasoningLevel(
            profile.lastSelectedReasoningLevel ?? "high",
          );
          setProfileLoaded(true);
        }
        setKeyStatusLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [preflightAttempt]);

    useEffect(() => {
      uploadGenerationRef.current += 1;
      setInput("");
      setAttachedDocuments([]);
      setDocumentsModalOpen(false);
      setWorkflowModalOpen(false);
      setSelectedPlaybook(null);
      setPlaybookModalOpen(false);
      setUploadingLocalFiles(false);
      setDocumentUploadError(null);
      setModelError(null);
      reasoningManuallySelectedRef.current = false;
      setReasoningLevel(
        chatReasoningLevel ??
          lastSelectedReasoningLevel ??
          profileLastSelectedReasoningLevel ??
          "high",
      );
    }, [sessionKey]);

    useEffect(() => {
      if (reasoningManuallySelectedRef.current) return;
      setReasoningLevel(
        chatReasoningLevel ??
          lastSelectedReasoningLevel ??
          profileLastSelectedReasoningLevel ??
          "high",
      );
    }, [
      chatReasoningLevel,
      lastSelectedReasoningLevel,
      profileLastSelectedReasoningLevel,
    ]);

    const handleLocalFiles = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0) return;

      const generation = uploadGenerationRef.current;
      const { supported, unsupported } = partitionSupportedDocumentFiles(files);
      if (supported.length === 0) {
        setDocumentUploadError(
          unsupportedDocumentWarningMessage(),
        );
        return;
      }

      setUploadingLocalFiles(true);
      setDocumentUploadError(
        unsupported.length > 0 ? clientTranslator()("word.unsupportedFilesSkipped") : null,
      );
      // Documents that finished are kept even when the batch as a whole did
      // not: attach them as they land, and again from whatever accounting the
      // upload returns (or carries on an UploadBatchError).
      const attachDocuments = (documents: Document[]): void => {
        if (documents.length === 0) return;
        if (!mountedRef.current || generation !== uploadGenerationRef.current) {
          return;
        }
        setAttachedDocuments((current) => {
          const existing = new Set(current.map((document) => document.id));
          return [
            ...current,
            ...documents.filter((document) => !existing.has(document.id)),
          ];
        });
      };
      const completedDocuments = (
        outcomes: UploadOutcome<Document>[],
      ): Document[] =>
        outcomes.flatMap((outcome) =>
          outcome.status === "completed" && outcome.result
            ? [outcome.result]
            : [],
        );

      try {
        const outcomes = await uploadStandaloneDocuments(supported, {
          onProgress: (progress: UploadProgress<Document>) => {
            if (progress.status === "completed" && progress.result) {
              attachDocuments([progress.result]);
            }
          },
        });

        if (!mountedRef.current || generation !== uploadGenerationRef.current) {
          return;
        }
        attachDocuments(completedDocuments(outcomes));
        if (outcomes.some((outcome) => outcome.status === "error")) {
          setDocumentUploadError(failedUploadMessage(outcomes));
        }
      } catch (reason) {
        if (!mountedRef.current || generation !== uploadGenerationRef.current) {
          return;
        }
        if (reason instanceof UploadBatchError) {
          const outcomes = reason.outcomes as UploadOutcome<Document>[];
          attachDocuments(completedDocuments(outcomes));
          setDocumentUploadError(
            failedUploadMessage(outcomes, reason.message),
          );
        } else {
          setDocumentUploadError(
            reportFault(reason, {
              fallback: clientTranslator()("word.documentsUploadFailed"),
              operation: "documents.upload",
            }).message,
          );
        }
      } finally {
        if (
          mountedRef.current &&
          generation === uploadGenerationRef.current
        ) {
          setUploadingLocalFiles(false);
        }
      }
    };

    const selectSlashWorkflow = (workflow: Workflow): void => {
      if (!workflowSlashCommandFromTitle(workflow.metadata.title)) return;
      onSelectedWorkflowChange({
        id: workflow.id,
        title: workflow.metadata.title,
      });
      setInput((current) => withoutSlashCommand(current));
      setSlashMenuDismissed(true);
    };

    const submit = (): void => sendTurn();

    // «Pedir una pista» and the round with the counterparty's lawyer send the
    // turn in that mode; the server picks the rung and checks it again.
    const sendTurn = (mode?: TrainingTurnMode): void => {
      const typed = input.trim();
      // Closing a round needs no question of its own.
      const content =
        !typed && mode === "counterpart_close"
          ? trainingText.closeMessage
          : typed;
      if (slashCommandsLoading) return;
      const exactSlashWorkflow = !mode && slashQuery
        ? (slashWorkflows ?? []).find(
            (workflow) =>
              workflowSlashCommandFromTitle(workflow.metadata.title) ===
              slashQuery,
          )
        : undefined;
      if (exactSlashWorkflow) {
        selectSlashWorkflow(exactSlashWorkflow);
        return;
      }
      if (isResponseLoading) return;
      if (!content && !hasAnnotatedExcerpt) {
        if (mode) setModeErrorAt(typed);
        return;
      }
      if (!model) {
        setModelError(
          hasModels === false
            ? noModelsError(keyStatus, routerSelections, selectModelMessage())
            : { message: selectModelMessage(), action: "choose-model" },
        );
        return;
      }
      if (!isModelAvailable(model, keyStatus)) {
        setModelError({ message: unavailableModelMessage(model, keyStatus) });
        return;
      }
      if (needsAttempt && !isTrainingAttemptReady(attempt)) {
        setAttemptError(true);
        return;
      }
      // A hint is not rated: it has no answer for the mark to be compared with.
      const rated = needsConfidence && mode !== "hint";
      if (rated && confidence === null) {
        setConfidenceError(true);
        return;
      }
      setModelError(null);
      const files = attachedDocuments.map((document) => ({
        filename: document.filename,
        document_id: document.id,
      }));
      void onSubmit(
        {
          content: serializeExcerpts(excerpts, content),
          files: files.length > 0 ? files : undefined,
          workflow: selectedWorkflow ?? undefined,
          playbook: selectedPlaybook ?? undefined,
          model,
          reasoning: resolvedReasoningLevel,
          ...(needsAttempt ? { attempt: attempt.trim() } : {}),
          ...(rated && confidence !== null ? { confidence } : {}),
          ...(mode ? { training_mode: mode } : {}),
        },
        {
          onAccepted: () => {
            // Kept until the server accepts the turn: a refusal for a
            // missing approach or mark (onTrainingRefused) puts it back.
            sentDraftRef.current = {
              input,
              attempt,
              attachedDocuments,
              excerpts,
              workflow: selectedWorkflow,
              playbook: selectedPlaybook,
            };
            setInput("");
            setModeErrorAt(null);
            // A hint is asked from an approach that may be rewritten with it
            // in view, and asked unrated: both stay for the turn after it.
            if (mode !== "hint") {
              setAttempt("");
              setConfidence(null);
            }
            setAttemptError(false);
            setConfidenceError(false);
            setAttachedDocuments([]);
            setExcerpts([]);
            onSelectedWorkflowChange(null);
            setSelectedPlaybook(null);
          },
          onTrainingRefused: () => {
            const draft = sentDraftRef.current;
            sentDraftRef.current = null;
            if (!draft) return;
            // Only what the person typed: the mark is theirs to give again
            // once the thermometer is on screen.
            setInput((current) => current || draft.input);
            setAttempt((current) => current || draft.attempt);
            setAttachedDocuments((current) =>
              current.length > 0 ? current : draft.attachedDocuments,
            );
            setExcerpts((current) =>
              current.length > 0 ? current : draft.excerpts,
            );
            if (draft.workflow) onSelectedWorkflowChange(draft.workflow);
            setSelectedPlaybook((current) => current ?? draft.playbook);
          },
          onTurnReady,
        },
      );
    };

    const composerError =
      requestError ?? documentUploadError ?? modelError?.message ?? null;
    const composerErrorAction =
      requestError || documentUploadError ? undefined : modelError?.action;

    return (
      <>
        <div
          ref={containerRef}
          data-testid="chat-composer-overlay"
          className="absolute inset-x-0 bottom-0 z-30 p-3 @sm:py-4"
        >
          <input
            ref={localFileInputRef}
            type="file"
            accept={SUPPORTED_DOCUMENT_ACCEPT}
            multiple
            className="hidden"
            aria-label={t("word.uploadDesktopFiles")}
            onChange={(event) => void handleLocalFiles(event)}
          />
          {composerError && (
            <div
              role="alert"
              className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50/95 px-3 py-2 text-xs text-gray-700 shadow-sm backdrop-blur-xl"
            >
              <span className="min-w-0">
                {composerError}
                {composerErrorAction && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() =>
                        composerErrorAction === "choose-model"
                          ? setModelPickerOpen(true)
                          : openApiKeysPage()
                      }
                      className="rounded font-medium text-gray-900 underline underline-offset-2 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {composerErrorAction === "choose-model"
                        ? t("word.chooseModel")
                        : t("word.openBringYourOwnKeys")}
                    </button>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  onDismissRequestError();
                  setDocumentUploadError(null);
                  setModelError(null);
                }}
                aria-label={t("word.dismissError")}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-900/5 hover:text-gray-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {needsAttempt && (
            <TrainingAttemptFieldUI
              id={TRAINING_ATTEMPT_ID}
              className="mb-2"
              value={attempt}
              onChange={setAttempt}
              text={trainingText.attempt}
              showError={attemptError}
            />
          )}
          {needsAttempt && needsConfidence && (
            <TrainingConfidenceUI
              id="word-training-confidence"
              className="mb-2"
              value={confidence}
              onChange={(level) => {
                setConfidence(level);
                setConfidenceError(false);
              }}
              text={trainingText.confidence}
              showError={confidenceError}
            />
          )}
          {modesState && (
            <TrainingModesUI
              id="word-training-modes"
              className="mb-2"
              state={modesState}
              text={trainingText.modes}
              onPick={(mode) => sendTurn(mode)}
              disabled={isResponseLoading}
              error={
                modeErrorAt !== null && modeErrorAt === input
                  ? trainingText.needsQuestion
                  : null
              }
            />
          )}
          <div ref={composerRef} className="relative">
            {slashMenuOpen && (
              <WorkflowSlashMenu
                workflows={matchingSlashWorkflows}
                activeIndex={resolvedSlashIndex}
                onSelect={selectSlashWorkflow}
              />
            )}
            <ChatInputShell
              value={input}
              onValueChange={(value) => {
                setInput(value);
                setActiveSlashIndex(0);
                setSlashMenuDismissed(false);
              }}
              onSubmit={submit}
              onKeyDown={(event) => {
                if (slashMenuOpen && matchingSlashWorkflows.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSlashIndex(
                      (resolvedSlashIndex + 1) %
                        matchingSlashWorkflows.length,
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSlashIndex(
                      (resolvedSlashIndex -
                        1 +
                        matchingSlashWorkflows.length) %
                        matchingSlashWorkflows.length,
                    );
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const workflow =
                      matchingSlashWorkflows[resolvedSlashIndex];
                    if (workflow) selectSlashWorkflow(workflow);
                    return;
                  }
                }
                if (slashMenuOpen && event.key === "Escape") {
                  event.preventDefault();
                  setSlashMenuDismissed(true);
                }
              }}
              combobox={{
                controls: slashMenuOpen
                  ? WORD_WORKFLOW_SLASH_MENU_ID
                  : undefined,
                expanded: slashMenuOpen,
                activeDescendant:
                  slashMenuOpen && matchingSlashWorkflows.length > 0
                    ? `${WORD_WORKFLOW_SLASH_MENU_ID}-${resolvedSlashIndex}`
                    : undefined,
              }}
              isLoading={isResponseLoading}
              onCancel={onCancel}
              disabled={false}
              placeholder={t("word.howCanIHelp")}
              canSubmitEmpty={hasAnnotatedExcerpt}
              attachments={
                selectedWorkflow ||
                selectedPlaybook ||
                attachedDocuments.length > 0 ||
                excerpts.length > 0 ? (
                  <>
                    {selectedWorkflow && (
                      <div className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-interactive py-0.5 pl-2.5 pr-1 text-xs text-interactive-foreground shadow">
                        <Library className="h-2.5 w-2.5 shrink-0" />
                        <span className="max-w-[140px] truncate">
                          {selectedWorkflow.title}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectedWorkflowChange(null)}
                          aria-label={t("word.removeWorkflowTitle", { title: selectedWorkflow.title })}
                          className="ml-0.5 rounded-full p-0.5 text-white/60 transition-colors hover:bg-white/20 hover:text-white"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    )}
                    {selectedPlaybook && (
                      <PlaybookPillUI
                        title={selectedPlaybook.title}
                        onOpen={() => {
                          setPlaybookModalInitialId(selectedPlaybook.id);
                          setPlaybookModalOpen(true);
                        }}
                        onRemove={() => setSelectedPlaybook(null)}
                      />
                    )}
                    {attachedDocuments.map((document) => (
                      <div
                        key={document.id}
                        className="inline-flex items-center gap-1 rounded-[10px] border border-white/70 bg-white py-0.5 pl-2 pr-1 text-xs text-gray-800 shadow-sm"
                      >
                        <FileTypeIcon
                          fileType={document.file_type ?? document.filename}
                          className="h-2.5 w-2.5"
                        />
                        <span className="max-w-[140px] truncate">
                          {document.filename}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachedDocuments((current) =>
                              current.filter((item) => item.id !== document.id),
                            )
                          }
                          aria-label={t("word.removeDocumentFilename", { filename: document.filename })}
                          className="ml-0.5 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-900/5 hover:text-gray-700"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    {excerpts.map((excerpt, index) => (
                      <ExcerptPillUI
                        key={`${index}-${excerpt.text}`}
                        excerpt={excerpt}
                        onOpen={() => setOpenExcerpt(excerpt)}
                        onRemove={() =>
                          setExcerpts((current) =>
                            current.filter((_, i) => i !== index),
                          )
                        }
                      />
                    ))}
                  </>
                ) : undefined
              }
              leftSlot={
                <div className="flex min-w-0 items-center gap-1">
                  <DocumentSourceMenu
                    disabled={isResponseLoading}
                    uploading={uploadingLocalFiles}
                    attachedCount={attachedDocuments.length}
                    onLocalFiles={() => localFileInputRef.current?.click()}
                    onWebFiles={() => setDocumentsModalOpen(true)}
                    onWorkflows={() => setWorkflowModalOpen(true)}
                    onPlaybooks={() => {
                      setPlaybookModalInitialId(undefined);
                      setPlaybookModalOpen(true);
                    }}
                  />
                  <EditApplyModeMenu
                    mode={editApplyMode}
                    onModeChange={onEditApplyModeChange}
                  />
                </div>
              }
              rightSlot={
                chatSettingsLoading ? undefined : (
                  <ModelToggle
                    value={model}
                    onChange={(next) => {
                      setModelError(null);
                      setModel(next);
                      modelSelectionSaveRef.current =
                        modelSelectionSaveRef.current
                          // Remembering the last model is a convenience the
                          // user never asked for; the choice already applies
                          // to this chat, so a failed save stays quiet.
                          .catch(() => undefined)
                          .then(() => onModelSelected(next));
                    }}
                    keyStatus={keyStatus}
                    keyStatusLoading={keyStatusLoading}
                    routerSelections={routerSelections}
                    compact={compactControls}
                    reasoningLevel={resolvedReasoningLevel}
                    onReasoningChange={(next) => {
                      reasoningManuallySelectedRef.current = true;
                      setReasoningLevel(next);
                      modelSelectionSaveRef.current =
                        modelSelectionSaveRef.current
                          // Same as the model above: a preference, not the
                          // action the user is waiting on.
                          .catch(() => undefined)
                          .then(() => onReasoningSelected(next));
                    }}
                    onNoModelsClick={() => {
                      setModelError(noModelsError(keyStatus, routerSelections));
                    }}
                    open={modelPickerOpen}
                    onOpenChange={setModelPickerOpen}
                    onHasModelsChange={setHasModels}
                  />
                )
              }
            />
          </div>
        </div>
        <ExcerptModalUI
          excerpt={openExcerpt}
          onClose={() => setOpenExcerpt(null)}
        />
        <AddDocumentsModal
          open={documentsModalOpen}
          onClose={() => setDocumentsModalOpen(false)}
          initialSelectedDocuments={attachedDocuments}
          onSelect={setAttachedDocuments}
        />
        <WorkflowModal
          open={workflowModalOpen}
          onClose={() => setWorkflowModalOpen(false)}
          initialWorkflowId={selectedWorkflow?.id}
          onSelect={(workflow) =>
            onSelectedWorkflowChange({
              id: workflow.id,
              title: workflow.metadata.title,
            })
          }
        />
        <PlaybookModal
          open={playbookModalOpen}
          onClose={() => setPlaybookModalOpen(false)}
          initialPlaybookId={playbookModalInitialId}
          onSelect={(playbook) =>
            setSelectedPlaybook({
              id: playbook.id,
              title: playbookTitle(playbook),
            })
          }
        />
      </>
    );
  },
);
