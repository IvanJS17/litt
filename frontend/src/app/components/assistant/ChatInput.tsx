"use client";

import { useSoftKeyboard } from "@/app/hooks/useSoftKeyboard";
import {
    useState,
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useId,
    forwardRef,
    useImperativeHandle,
    useMemo,
    type ForwardedRef,
} from "react";
import {
    Waypoints,
    X,
} from "lucide-react";
import { AddDocButton } from "./AddDocButton";
import { PlaybookPickerModal } from "../playbooks/PlaybookPickerModal";
import {
    PlaybookPillUI,
    COMPOSER_SEND_BUTTON_CLASS,
    SendArrowUI,
    ExcerptModalUI,
    ExcerptPillUI,
} from "@mike/ui";
import { UploadOverlay } from "./UploadOverlay";
import { DocumentPill } from "../shared/DocumentPill";
import { AddDocumentsModal } from "../modals/AddDocumentsModal";
import { AssistantWorkflowModal } from "./AssistantWorkflowModal";
import { WORKFLOW_SLASH_MENU_ID, WorkflowSlashMenu } from "./WorkflowSlashMenu";
import {
    exactSlashWorkflow,
    matchingSlashWorkflows,
    slashCommandQuery,
    withoutSlashCommand,
    workflowSlashCommand,
} from "./workflowSlashCommands";
import { ApiKeyMissingPopup } from "../popups/ApiKeyMissingPopup";
import { ModelToggle, type ReasoningLevel } from "./ModelToggle";
import { NoModelsWarningPopup } from "../popups/NoModelsWarningPopup";
import { WarningPopup } from "../popups/WarningPopup";
import {
    useSelectedModel,
    useSelectedReasoning,
} from "@/app/hooks/useSelectedModel";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import type {
    TrainingConfidenceLevel,
    TrainingTurnMode,
} from "@mike/contracts";
import { useTrainingStage } from "@/app/hooks/useTrainingStage";
import { useTrainingText } from "@/app/hooks/useTrainingText";
import {
    isTrainingAttemptReady,
    TrainingAttemptFieldUI,
    TrainingConfidenceUI,
    TrainingModesUI,
    focusTrainingAttempt,
    useTrainingReply,
    withTrainingReply,
    TrainingUrgencyPassLineUI,
} from "@mike/ui";
import { useModelApiKeys } from "@/app/hooks/useModelApiKeys";
import { useModelRouterSelections } from "@/app/hooks/useModelRouterSelections";
import {
    getModelProvider,
    isModelAvailable,
    type ModelProvider,
} from "@/app/lib/modelAvailability";
import type { Document, Message, Workflow } from "../shared/types";
import type { DirectoryTab } from "../shared/useDirectoryData";
import { cn } from "@/app/lib/utils";
import { TOUCH_TARGET_CLASS } from "@mike/ui";
import { LIQUID_GLASS_TRANSLUCENT_CLASS } from "@/app/components/ui/liquid-surface";
import {
    UploadBatchError,
    failedUploadMessage,
    listWorkflows,
    uploadProjectDocuments,
    uploadStandaloneDocuments,
    type UploadProgress,
} from "@/app/lib/mikeApi";
import { useWorkspaceIdentity } from "@/app/hooks/useWorkspaceIdentity";
import { useDocumentWorkspace } from "@/app/contexts/WorkspaceContext";
import {
    SUPPORTED_DOCUMENT_ACCEPT,
    formatUnsupportedDocumentWarning,
    partitionSupportedDocumentFiles,
} from "@/app/lib/documentUploadValidation";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { serializeExcerpts, type MessageExcerpt, type NoModelsReason } from "@mike/client";
import { useConfiguredModels } from "@/app/hooks/useConfiguredModels";
import { useWorkspaceOrgId } from "@/app/contexts/WorkspaceContext";
import {
    ChatCredentialPicker,
    useChatCredentialChoice,
} from "./ChatCredentialPicker";
import { useTranslations } from "next-intl";
import type { AppTranslate } from "@/i18n/Translate";

/** What a composer holds before it is sent. */
export interface ComposerDraft {
    value: string;
    attachedDocs: Document[];
}

/** Drafts by chat, owned by a parent that outlives the composer. */
export type ComposerDraftStore = Map<string, ComposerDraft>;

export interface ChatInputHandle {
    addDoc: (doc: Document) => void;
    addFiles: (files: File[]) => void;
    /** Quotes a passage of an assistant response above the next message. */
    addExcerpt: (excerpt: MessageExcerpt) => void;
    startWorkflow: (
        workflow: { id: string; title: string },
        prompt?: string,
    ) => void;
    startWorkflowDocumentSelection: (
        workflow: { id: string; title: string },
        prompt?: string,
        options?: { initialDocumentTab?: DirectoryTab },
    ) => void;
    /** Attaches a playbook to run on the documents, as the picker does. */
    attachPlaybook: (playbook: { id: string; title: string }) => void;
}

interface Props {
    onSubmit: (message: Message) => void;
    onCancel: () => void;
    isLoading: boolean;
    /**
     * Whether the caller may write into this chat. False renders a read-only
     * composer — sending, attaching, and drop-uploads stay off, matching
     * what the server would refuse for a project viewer.
     *
     * `null` means the answer has not arrived. The composer is closed exactly
     * as for `false`, but the placeholder stays neutral: telling an owner
     * "Viewing only — sending needs edit access" for the length of a fetch,
     * on every cold load, is a wrong statement about their access, not a
     * loading state.
     */
    canSend?: boolean | null;
    /**
     * Whether this chat's history is still on its way. Kept apart from
     * `canSend` on purpose: both close the composer, but only one of them is
     * about permissions, and saying the wrong one is a lie to the reader.
     * While an answer is still streaming into the thread `isLoading` is set
     * too, and the composer says so.
     */
    chatLoading?: boolean;
    hideAddDocButton?: boolean;
    hideWorkflowButton?: boolean;
    projectName?: string;
    projectCmNumber?: string | null;
    projectId?: string;
    /** Whether window-level file drops should be captured by this composer. */
    enableGlobalFileDrop?: boolean;
    /** Whether dropped files should be added to the project or only attached. */
    dropUploadsToProject?: boolean;
    onDocumentsUploaded?: (documents: Document[]) => void;
    onDocumentClick?: (document: Document) => void;
    chatModel?: string | null;
    chatReasoningLevel?: ReasoningLevel | null;
    chatKey?: string | null;
    /**
     * The chat's own id, as «Responder» names it. Apart from chatKey, which
     * keys drafts and selections and may be namespaced (tabular reviews).
     */
    chatId?: string | null;
    /**
     * Keeps the unsent text and attachments when the composer unmounts and
     * restores them when the same chat's composer mounts again (a side chat
     * closed because it no longer fits).
     */
    draftStore?: ComposerDraftStore;
    /**
     * LiTT: whether a new conversation offers the key picker. Review chats
     * run on the server's default key for their review and do not.
     */
    offerCredentialChoice?: boolean;
    /**
     * LiTT training: whether this composer starts assistant chat turns
     * ("Tu turno primero"). A pasante's turn there needs their approach.
     */
    trainingTurns?: boolean;
}

/**
 * What the closed composer tells the reader.
 *
 * Order matters. A reader without edit access is told about the grant even
 * while the thread loads, because that is the reason that will still be true
 * afterwards. Otherwise a load in progress explains itself — and when a
 * response is running (a turn started before the reader left keeps
 * `isLoading` set when they come back) it says which one, instead of
 * inventing a permission problem.
 */
function placeholderFor({
    canSend,
    chatLoading,
    isLoading,
    t,
}: {
    canSend: boolean | null;
    chatLoading: boolean;
    isLoading: boolean;
    t: AppTranslate;
}): string {
    if (canSend === null) return t("assistant.chatInput.loading");
    if (!canSend) return t("assistant.chatInput.viewingOnlySendingNeedsEditAccess");
    if (!chatLoading) return t("assistant.chatInput.howCanIHelp");
    return isLoading
        ? t("assistant.chatInput.aResponseIsStillArriving")
        : t("assistant.chatInput.loadingThisChat");
}

/**
 * The approach field of the training composer; «Responder» focuses it. Two
 * composers can be mounted at once (main and side chat), so each gets its own
 * ids: {@link TRAINING_ATTEMPT_ID}-{useId()}.
 */
const TRAINING_ATTEMPT_ID = "chat-training-attempt";

function ChatInputForChatImpl(
    {
        onSubmit,
        onCancel,
        isLoading,
        canSend = true,
        chatLoading = false,
        hideAddDocButton,
        hideWorkflowButton,
        projectName,
        projectCmNumber,
        projectId,
        enableGlobalFileDrop = true,
        dropUploadsToProject = true,
        onDocumentsUploaded,
        onDocumentClick,
        chatModel,
        chatReasoningLevel,
        chatKey,
        chatId,
        draftStore,
        offerCredentialChoice = true,
        trainingTurns = false,
    }: Props,
    ref: ForwardedRef<ChatInputHandle>,
) {
    const t = useTranslations();
    // A document attached to a chat outside a project belongs to the
    // workspace it is uploaded in.
    const workspace = useDocumentWorkspace();
    // Sending needs both a grant and a loaded thread; the placeholder below
    // names whichever one is missing.
    const composerOpen = canSend === true && !chatLoading;
    const draftKey = chatKey ?? "new-chat";
    const [restoredDraft] = useState(() => draftStore?.get(draftKey));
    const [value, setValue] = useState(restoredDraft?.value ?? "");
    const [attachedDocs, setAttachedDocs] = useState<Document[]>(
        restoredDraft?.attachedDocs ?? [],
    );
    // The store mirrors the composer on every change (not only on unmount),
    // so a remount with the same key never sees an older or already-sent text.
    useEffect(() => {
        if (!draftStore) return;
        if (value.trim() === "" && attachedDocs.length === 0)
            draftStore.delete(draftKey);
        else draftStore.set(draftKey, { value, attachedDocs });
    }, [draftStore, draftKey, value, attachedDocs]);
    // An upload that finishes after the composer closed has no state left to
    // update, so it lands in the draft the next mount restores.
    const addDocumentToStoredDraft = useCallback(
        (document: Document) => {
            if (!draftStore) return;
            const stored = draftStore.get(draftKey) ?? {
                value: "",
                attachedDocs: [],
            };
            if (stored.attachedDocs.some((d) => d.id === document.id)) return;
            draftStore.set(draftKey, {
                ...stored,
                attachedDocs: [...stored.attachedDocs, document],
            });
        },
        [draftStore, draftKey],
    );
    const [excerpts, setExcerpts] = useState<MessageExcerpt[]>([]);
    const [openExcerpt, setOpenExcerpt] = useState<MessageExcerpt | null>(
        null,
    );
    const [selectedWorkflow, setSelectedWorkflow] = useState<{
        id: string;
        title: string;
    } | null>(null);
    const {
        profile,
        loading: profileLoading,
        apiKeysDegraded,
        persistChatModelSelection,
        persistChatReasoningSelection,
    } = useUserProfile();
    // Unknown key state → availability is UNKNOWN; undefined makes every key
    // gate (submit check + model toggle) fail open instead of treating "we
    // couldn't ask" as "no keys configured". In an organization workspace
    // these are the organization's keys, not the profile's.
    const apiKeys = useModelApiKeys();
    const configuredModels = useConfiguredModels();
    const configuredModelIds = useMemo(
        () => configuredModels.map((model) => model.id),
        [configuredModels],
    );
    // A degraded profile is the local fallback, whose router lists are empty
    // because the truth is UNKNOWN. Passing them on would let one dropped
    // /user/profile request rewrite the saved composer selection to the
    // default — permanently. null means "not loaded", which the hook leaves
    // the stored selection alone for.
    // In an organization workspace these are the lists that govern its keys.
    const savedRouterSelections = useModelRouterSelections();
    const [model, setModel] = useSelectedModel({
        selectionKey: chatKey,
        chatModel,
        lastSelectedModel: profile?.lastSelectedChatModel,
        routerSelections:
            savedRouterSelections && !apiKeysDegraded
                ? savedRouterSelections
                : null,
        apiKeys,
        configuredModelIds,
    });
    // LiTT governed BYOK: a conversation that already has a model is fixed
    // to its provider, model and key (the server pinned them with its first
    // answer). Before that, the composer also offers which key to use.
    const routeFixed = !!chatKey && typeof chatModel === "string" && chatModel !== "";
    const workspaceOrgId = useWorkspaceOrgId();
    const credential = useChatCredentialChoice({
        model,
        enabled: offerCredentialChoice && !routeFixed && canSend === true,
        projectId,
        orgId: workspaceOrgId,
    });
    // LiTT training: a pasante writes their own approach before each turn.
    // A mentor's urgency pass on the matter lifts it (the server decides).
    const trainingTurn = useTrainingStage({
        orgId: workspaceOrgId,
        projectId,
        // The hint ladder is counted from this chat's notes, and again each
        // time one of its turns ends.
        chatId,
        turnActive: isLoading,
        enabled: trainingTurns && canSend === true,
    });
    const needsAttempt = trainingTurn.attemptRequired;
    // The thermometer goes with the approach: one mark per approach.
    const needsConfidence = needsAttempt && trainingTurn.confidenceRequired;
    const trainingText = useTrainingText();
    const trainingInstanceId = useId();
    const trainingAttemptId = `${TRAINING_ATTEMPT_ID}-${trainingInstanceId}`;
    const trainingConfidenceId = `chat-training-confidence-${trainingInstanceId}`;
    const trainingModesId = `chat-training-modes-${trainingInstanceId}`;
    const [attempt, setAttempt] = useState("");
    const [attemptError, setAttemptError] = useState(false);
    const [confidence, setConfidence] = useState<TrainingConfidenceLevel | null>(
        null,
    );
    const [confidenceError, setConfidenceError] = useState(false);
    // A hint or a round was asked for with no question written: the text the
    // composer held then. It is said until the person types.
    const [modeErrorAt, setModeErrorAt] = useState<string | null>(null);
    const modeError = modeErrorAt !== null && modeErrorAt === value;
    // «Responder» on a basis question brings it, quoted, to the approach.
    useTrainingReply({
        enabled: needsAttempt && trainingTurns,
        // A note asks for its own chat's composer, not the one beside it.
        chatId,
        chatScoped: true,
        onReply: (question) => {
            setAttempt((current) => withTrainingReply(current, question));
            setAttemptError(false);
            focusTrainingAttempt(trainingAttemptId);
        },
    });
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const softKeyboard = useSoftKeyboard();
    const controlsRef = useRef<HTMLDivElement>(null);
    const [compactControls, setCompactControls] = useState(false);
    const [docSelectorOpen, setDocSelectorOpen] = useState(false);
    const [docSelectorInitialTab, setDocSelectorInitialTab] =
        useState<DirectoryTab>("files");
    const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
    // A playbook picked to run on the attached documents, like a workflow.
    const [selectedPlaybook, setSelectedPlaybook] = useState<{
        id: string;
        title: string;
    } | null>(null);
    const [playbookModalOpen, setPlaybookModalOpen] = useState(false);
    const [playbookModalInitialId, setPlaybookModalInitialId] = useState<
        string | undefined
    >(undefined);
    // Set when the modal is opened from a pill, so it lands on that workflow
    // instead of the picker's default listing.
    const [workflowModalInitialId, setWorkflowModalInitialId] = useState<
        string | undefined
    >(undefined);
    const [apiKeyModalProvider, setApiKeyModalProvider] =
        useState<ModelProvider | null>(null);
    const [noModelsWarning, setNoModelsWarning] =
        useState<NoModelsReason | null>(null);
    const [modelRequiredWarning, setModelRequiredWarning] = useState(false);
    const [reasoningLevel, setReasoningLevel] = useSelectedReasoning({
        selectionKey: chatKey,
        chatReasoningLevel,
        lastSelectedReasoningLevel: profile?.lastSelectedReasoningLevel,
    });
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [uploadingFiles, setUploadingFiles] = useState<
        Array<{ clientId: string; filename: string }>
    >([]);
    const [uploadWarning, setUploadWarning] = useState<string | null>(null);
    const [droppedDocuments, setDroppedDocuments] = useState<Document[]>([]);
    const [slashWorkflows, setSlashWorkflows] = useState<Workflow[] | null>(
        null,
    );
    const [activeSlashIndex, setActiveSlashIndex] = useState(0);
    const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
    const dragDepthRef = useRef(0);
    const localFileInputRef = useRef<HTMLInputElement>(null);
    const settingsSaveRef = useRef<Promise<boolean>>(Promise.resolve(true));
    // `ChatInput` keys this component by chat. Mark this generation inactive
    // during the keyed unmount so upload callbacks from the previous thread
    // cannot mutate its replacement or call outward with stale documents.
    const uploadGenerationActiveRef = useRef(true);
    useLayoutEffect(() => {
        uploadGenerationActiveRef.current = true;
        return () => {
            uploadGenerationActiveRef.current = false;
        };
    }, []);

    const handleModelChange = useCallback(
        (nextModel: string) => {
            if (routeFixed) return;
            setModel(nextModel);
            // Keep rapid picker changes ordered so the final database value
            // always matches the final visible selection.
            settingsSaveRef.current = settingsSaveRef.current
                .catch(() => false)
                .then(() => persistChatModelSelection(nextModel, chatKey));
        },
        [chatKey, persistChatModelSelection, routeFixed, setModel],
    );

    const handleReasoningChange = useCallback(
        (nextLevel: ReasoningLevel) => {
            setReasoningLevel(nextLevel);
            settingsSaveRef.current = settingsSaveRef.current
                .catch(() => false)
                .then(() =>
                    persistChatReasoningSelection(nextLevel, chatKey),
                );
        }, [
            chatKey,
            persistChatReasoningSelection,
            setReasoningLevel,
        ],
    );

    const chatSettingsLoading =
        !!chatKey &&
        (chatModel === undefined || chatReasoningLevel === undefined);

    const slashQuery = slashCommandQuery(value);
    const matchingWorkflows = matchingSlashWorkflows(
        slashWorkflows ?? [],
        slashQuery,
    );
    const slashCommandsLoading = slashQuery !== null && slashWorkflows === null;
    const slashMenuOpen =
        !slashMenuDismissed &&
        !selectedWorkflow &&
        slashQuery !== null &&
        matchingWorkflows.length > 0;
    const resolvedSlashIndex = Math.min(
        activeSlashIndex,
        Math.max(0, matchingWorkflows.length - 1),
    );

    useEffect(() => {
        const el = controlsRef.current;
        if (!el) return;
        const update = () => setCompactControls(el.offsetWidth < 430);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!slashCommandsLoading) return;

        let cancelled = false;
        listWorkflows("assistant", workspace ?? "personal")
            .then((workflows) => {
                if (!cancelled) setSlashWorkflows(workflows);
            })
            .catch(() => {
                if (!cancelled) setSlashWorkflows([]);
            });

        return () => {
            cancelled = true;
        };
    }, [slashCommandsLoading, workspace]);

    const handleAddDocsFromSelector = useCallback(
        (selectedDocs: Document[]) => {
            setAttachedDocs((prev) => {
                const existing = new Set(prev.map((d) => d.id));
                return [
                    ...prev,
                    ...selectedDocs.filter((d) => !existing.has(d.id)),
                ];
            });
        },
        [],
    );

    const addAttachedDocuments = useCallback((documents: Document[]) => {
        setAttachedDocs((prev) => {
            const existing = new Set(prev.map((document) => document.id));
            return [
                ...prev,
                ...documents.filter((document) => !existing.has(document.id)),
            ];
        });
    }, []);

    const handleDroppedFiles = useCallback(
        async (files: File[]) => {
            if (!composerOpen) {
                if (canSend === false) {
                    setUploadWarning(
                        t("assistant.chatInput.onlySomeoneWithEditAccess"),
                    );
                }
                return;
            }
            const { supported, unsupported } =
                partitionSupportedDocumentFiles(files);
            setUploadWarning(formatUnsupportedDocumentWarning(unsupported));
            if (supported.length === 0) return;

            const uploadInputs = supported.map((file) => ({
                file,
                clientId: crypto.randomUUID(),
            }));
            // Batches can overlap (a second drop or pick while one is still
            // uploading), so each adds its own pills and clears only those.
            const batchIds = new Set(
                uploadInputs.map(({ clientId }) => clientId),
            );
            setUploadingFiles((current) => [
                ...current,
                ...uploadInputs.map(({ clientId, file }) => ({
                    clientId,
                    filename: file.name,
                })),
            ]);
            const addCompletedDocument = (document: Document) => {
                if (!uploadGenerationActiveRef.current) {
                    addDocumentToStoredDraft(document);
                    return;
                }
                addAttachedDocuments([document]);
                setDroppedDocuments((prev) => {
                    const existing = new Set(
                        prev.map((document) => document.id),
                    );
                    return [
                        ...prev,
                        ...(existing.has(document.id) ? [] : [document]),
                    ];
                });
            };
            const handleProgress = (progress: UploadProgress<Document>) => {
                if (!uploadGenerationActiveRef.current) {
                    if (progress.status === "completed" && progress.result)
                        addCompletedDocument(progress.result);
                    return;
                }
                if (
                    progress.status === "completed" ||
                    progress.status === "error"
                ) {
                    setUploadingFiles((current) =>
                        current.filter(
                            (upload) => upload.clientId !== progress.clientId,
                        ),
                    );
                }
                if (progress.status === "completed" && progress.result) {
                    addCompletedDocument(progress.result);
                }
            };
            try {
                const uploadsToProject = dropUploadsToProject && !!projectId;
                const outcomes = uploadsToProject
                    ? await uploadProjectDocuments(projectId, uploadInputs, {
                          onProgress: handleProgress,
                      })
                    : await uploadStandaloneDocuments(
                          uploadInputs,
                          { onProgress: handleProgress },
                          workspace,
                      );
                if (!uploadGenerationActiveRef.current) {
                    outcomes.forEach((outcome) => {
                        if (outcome.status === "completed" && outcome.result)
                            addCompletedDocument(outcome.result);
                    });
                    return;
                }
                const uploaded = outcomes.flatMap((outcome) =>
                    outcome.status === "completed" && outcome.result
                        ? [outcome.result]
                        : [],
                );
                uploaded.forEach(addCompletedDocument);
                if (uploadsToProject && uploaded.length > 0) {
                    onDocumentsUploaded?.(uploaded);
                }
                if (outcomes.some((outcome) => outcome.status === "error")) {
                    setUploadWarning(failedUploadMessage(outcomes));
                }
            } catch (error) {
                if (!uploadGenerationActiveRef.current) return;
                setUploadWarning(
                    error instanceof UploadBatchError
                        ? failedUploadMessage(error.outcomes)
                        : userFacingApiError(
                              error,
                              t("assistant.chatInput.documentsCouldNotBeUploaded"),
                          ),
                );
            } finally {
                if (uploadGenerationActiveRef.current) {
                    setUploadingFiles((current) =>
                        current.filter((upload) => !batchIds.has(upload.clientId)),
                    );
                }
            }
        },
        [
            workspace,
            addAttachedDocuments,
            addDocumentToStoredDraft,
            canSend,
            composerOpen,
            dropUploadsToProject,
            onDocumentsUploaded,
            projectId,
        ],
    );

    useImperativeHandle(ref, () => ({
        addDoc: (doc: Document) => {
            setAttachedDocs((prev) => {
                if (prev.some((d) => d.id === doc.id)) return prev;
                return [...prev, doc];
            });
        },
        addFiles: (files: File[]) => {
            void handleDroppedFiles(files);
        },
        addExcerpt: (excerpt: MessageExcerpt) => {
            if (!composerOpen) return;
            setExcerpts((prev) =>
                prev.some(
                    (e) => e.text === excerpt.text && e.note === excerpt.note,
                )
                    ? prev
                    : [...prev, excerpt],
            );
            requestAnimationFrame(() => textareaRef.current?.focus());
        },
        attachPlaybook: (playbook) => {
            setSelectedPlaybook(playbook);
            requestAnimationFrame(() => textareaRef.current?.focus());
        },
        startWorkflow: (workflow, prompt) => {
            setSelectedWorkflow(workflow);
            if (prompt !== undefined) setValue(prompt);
            requestAnimationFrame(() => textareaRef.current?.focus());
        },
        startWorkflowDocumentSelection: (workflow, prompt, options) => {
            setSelectedWorkflow(workflow);
            setDocSelectorInitialTab(options?.initialDocumentTab ?? "files");
            if (prompt !== undefined) {
                setValue(prompt);
                requestAnimationFrame(() => {
                    if (!textareaRef.current) return;
                    textareaRef.current.style.height = "auto";
                    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
                });
            }
            setDocSelectorOpen(true);
        },
    }));

    useEffect(() => {
        if (!enableGlobalFileDrop || !composerOpen) return;
        const hasFiles = (dataTransfer: DataTransfer | null) =>
            !!dataTransfer && Array.from(dataTransfer.types).includes("Files");

        const handleDragEnter = (event: DragEvent) => {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDraggingFiles(true);
        };
        const handleDragOver = (event: DragEvent) => {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        };
        const handleDragLeave = (event: DragEvent) => {
            if (!hasFiles(event.dataTransfer)) return;
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) setIsDraggingFiles(false);
        };
        const handleDrop = (event: DragEvent) => {
            if (!hasFiles(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            dragDepthRef.current = 0;
            setIsDraggingFiles(false);
            void handleDroppedFiles(
                Array.from(event.dataTransfer?.files ?? []),
            );
        };

        window.addEventListener("dragenter", handleDragEnter);
        window.addEventListener("dragover", handleDragOver);
        window.addEventListener("dragleave", handleDragLeave);
        window.addEventListener("drop", handleDrop);
        return () => {
            window.removeEventListener("dragenter", handleDragEnter);
            window.removeEventListener("dragover", handleDragOver);
            window.removeEventListener("dragleave", handleDragLeave);
            window.removeEventListener("drop", handleDrop);
        };
    }, [composerOpen, enableGlobalFileDrop, handleDroppedFiles]);

    const updateInput = (el: HTMLTextAreaElement) => {
        setValue(el.value);
        setActiveSlashIndex(0);
        setSlashMenuDismissed(false);
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    };

    const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const el = event.currentTarget;
        if (!composerOpen || event.clipboardData.files.length > 0) return;
        // Preserve spacing when inserting into an existing sentence or code.
        const replacesMessage = !el.value.trim()
            || (el.selectionStart === 0 && el.selectionEnd === el.value.length);
        if (!replacesMessage) return;
        const pasted = event.clipboardData.getData("text/plain");
        const trimmed = pasted.trim();
        if (!pasted || pasted === trimmed) return;
        event.preventDefault();
        el.setRangeText(trimmed, 0, el.value.length, "end");
        updateInput(el);
    };

    const hasAnnotatedExcerpt = excerpts.some((excerpt) => excerpt.note);

    const submitMessage = (
        typed: string,
        workflow: { id: string; title: string } | null,
        mode?: TrainingTurnMode,
    ) => {
        // Closing a round needs no question of its own.
        const query =
            !typed && mode === "counterpart_close"
                ? trainingText.closeMessage
                : typed;
        // An annotated excerpt already says what is being asked about it.
        if (isLoading) return;
        if (!query && !hasAnnotatedExcerpt) {
            if (mode) setModeErrorAt(typed);
            return;
        }
        if (!model) {
            setModelRequiredWarning(true);
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
        if (
            apiKeys &&
            !isModelAvailable(model, apiKeys, configuredModelIds)
        ) {
            setApiKeyModalProvider(getModelProvider(model));
            return;
        }
        setValue("");
        draftStore?.delete(draftKey);
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            // Close the on-screen keyboard, so the answer arriving under it
            // can be seen. A physical keyboard keeps the focus.
            if (softKeyboard) textareaRef.current.blur();
        }

        const files = attachedDocs.map((d) => ({
            filename: d.filename,
            document_id: d.id,
            ...(d.current_version_id
                ? { version_id: d.current_version_id }
                : {}),
            ...(d.active_version_number != null
                ? { version_number: d.active_version_number }
                : {}),
        }));
        setAttachedDocs([]);
        setSelectedWorkflow(null);
        setSelectedPlaybook(null);
        setExcerpts([]);
        setModeErrorAt(null);
        // A hint is asked from an approach that may be rewritten with it in
        // view, and asked unrated: both stay for the turn that follows.
        if (mode !== "hint") {
            setAttempt("");
            setConfidence(null);
        }
        setAttemptError(false);
        setConfidenceError(false);

        onSubmit?.({
            role: "user",
            content: serializeExcerpts(excerpts, query),
            files: files.length > 0 ? files : undefined,
            workflow: workflow ?? undefined,
            playbook: selectedPlaybook ?? undefined,
            model,
            ...(offerCredentialChoice && !routeFixed && credential.value
                ? { credential_ref: credential.value }
                : {}),
            reasoning: reasoningLevel,
            ...(needsAttempt ? { attempt: attempt.trim() } : {}),
            ...(rated && confidence !== null ? { confidence } : {}),
            ...(mode ? { training_mode: mode } : {}),
        });
    };

    const selectSlashWorkflow = (workflow: Workflow) => {
        if (!workflowSlashCommand(workflow)) return;
        setSelectedWorkflow({
            id: workflow.id,
            title: workflow.metadata.title,
        });
        setValue((current) => withoutSlashCommand(current));
        setSlashMenuDismissed(true);
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.focus();
        }
    };

    const handleSubmit = () => {
        const query = value.trim();
        if (!composerOpen || slashCommandsLoading) return;
        const slashWorkflow = slashQuery
            ? exactSlashWorkflow(slashWorkflows ?? [], slashQuery)
            : undefined;
        if (slashWorkflow) {
            selectSlashWorkflow(slashWorkflow);
            return;
        }
        submitMessage(query, selectedWorkflow);
    };

    // «Pedir una pista» and the round with the counterparty's lawyer send the
    // turn in that mode; the server picks the rung and checks it again.
    const handleMode = (mode: TrainingTurnMode) => {
        if (!composerOpen || slashCommandsLoading) return;
        submitMessage(value.trim(), selectedWorkflow, mode);
    };

    const handleActionClick = () => {
        if (isLoading) {
            onCancel();
        } else {
            handleSubmit();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (slashMenuOpen && matchingWorkflows.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveSlashIndex(
                    (resolvedSlashIndex + 1) % matchingWorkflows.length,
                );
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveSlashIndex(
                    (resolvedSlashIndex - 1 + matchingWorkflows.length) %
                        matchingWorkflows.length,
                );
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                selectSlashWorkflow(matchingWorkflows[resolvedSlashIndex]);
                return;
            }
        }
        if (slashMenuOpen && e.key === "Escape") {
            e.preventDefault();
            setSlashMenuDismissed(true);
            return;
        }
        // On a touch screen with only its on-screen keyboard, Enter is a line
        // break (the arrow sends): that keyboard has no Shift+Enter. With a
        // physical keyboard, or on a desktop, Enter sends and Shift+Enter breaks.
        if (e.key === "Enter" && !e.shiftKey && !softKeyboard) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <>
            <div className="relative w-full">
                {slashMenuOpen && (
                    <WorkflowSlashMenu
                        workflows={matchingWorkflows}
                        activeIndex={resolvedSlashIndex}
                        onSelect={selectSlashWorkflow}
                    />
                )}
                <div
                    className={cn(
                        "rounded-[21px]",
                        LIQUID_GLASS_TRANSLUCENT_CLASS,
                    )}
                >
                    {/* Attached chips */}
                    {(selectedWorkflow ||
                        selectedPlaybook ||
                        attachedDocs.length > 0 ||
                        uploadingFiles.length > 0 ||
                        excerpts.length > 0) && (
                        <div className="flex flex-wrap gap-1.5 px-2 pt-2">
                            {selectedWorkflow && (
                                <div className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full text-xs bg-interactive text-interactive-foreground border border-white/20 shadow">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setWorkflowModalInitialId(
                                                selectedWorkflow.id,
                                            );
                                            setWorkflowModalOpen(true);
                                        }}
                                        aria-label={t("assistant.chatInput.openWorkflowTitle", { title: selectedWorkflow.title })}
                                        className="inline-flex min-w-0 items-center gap-1 rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                                    >
                                        <Waypoints className="h-2.5 w-2.5 shrink-0" />
                                        <span className="max-w-[140px] truncate">
                                            {selectedWorkflow.title}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setSelectedWorkflow(null)
                                        }
                                        aria-label={t("assistant.chatInput.removeWorkflowTitle", { title: selectedWorkflow.title })}
                                        className={cn(
                                            TOUCH_TARGET_CLASS,
                                            "rounded-full p-0.5 ml-0.5 text-white/60 hover:text-white hover:bg-white/20 transition-colors",
                                        )}
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                </div>
                            )}
                            {selectedPlaybook && (
                                <PlaybookPillUI
                                    title={selectedPlaybook.title}
                                    onOpen={() => {
                                        setPlaybookModalInitialId(
                                            selectedPlaybook.id,
                                        );
                                        setPlaybookModalOpen(true);
                                    }}
                                    onRemove={() => setSelectedPlaybook(null)}
                                />
                            )}
                            {attachedDocs.map((doc) => (
                                <DocumentPill
                                    key={doc.id}
                                    filename={doc.filename}
                                    fileType={doc.file_type}
                                    onOpen={
                                        onDocumentClick
                                            ? () => onDocumentClick(doc)
                                            : undefined
                                    }
                                    onRemove={() =>
                                        setAttachedDocs((prev) =>
                                            prev.filter((d) => d.id !== doc.id),
                                        )
                                    }
                                />
                            ))}
                            {/* Still uploading: in the same row as the
                                attached documents, side by side. */}
                            {uploadingFiles.map((upload) => (
                                <DocumentPill
                                    key={upload.clientId}
                                    filename={upload.filename}
                                    status={t("assistant.chatInput.uploading")}
                                    loading
                                />
                            ))}
                            {excerpts.map((excerpt, index) => (
                                <ExcerptPillUI
                                    key={`${index}-${excerpt.text}`}
                                    excerpt={excerpt}
                                    onOpen={() => setOpenExcerpt(excerpt)}
                                    onRemove={() =>
                                        setExcerpts((prev) =>
                                            prev.filter((_, i) => i !== index),
                                        )
                                    }
                                />
                            ))}
                        </div>
                    )}

                    {needsAttempt ? (
                        <>
                            <TrainingAttemptFieldUI
                                id={trainingAttemptId}
                                className="px-4 pt-4"
                                value={attempt}
                                onChange={setAttempt}
                                text={trainingText.attempt}
                                disabled={!composerOpen}
                                showError={attemptError}
                            />
                            {needsConfidence ? (
                                <TrainingConfidenceUI
                                    id={trainingConfidenceId}
                                    className="px-4 pt-3"
                                    value={confidence}
                                    onChange={(level) => {
                                        setConfidence(level);
                                        setConfidenceError(false);
                                    }}
                                    text={trainingText.confidence}
                                    disabled={!composerOpen}
                                    showError={confidenceError}
                                />
                            ) : null}
                            {trainingTurn.modes.length > 0 ? (
                                <TrainingModesUI
                                    id={trainingModesId}
                                    className="px-4 pt-3"
                                    state={trainingTurn}
                                    text={trainingText.modes}
                                    onPick={handleMode}
                                    disabled={!composerOpen || isLoading}
                                    error={
                                        modeError
                                            ? trainingText.needsQuestion
                                            : null
                                    }
                                />
                            ) : null}
                        </>
                    ) : trainingTurn.urgencyPassExpiresAt ? (
                        <TrainingUrgencyPassLineUI
                            className="px-4 pt-4"
                            text={trainingText.urgencyPass(
                                trainingTurn.urgencyPassExpiresAt,
                            )}
                        />
                    ) : null}

                    {/* Input */}
                    <div className="px-4 pt-4">
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            disabled={!composerOpen}
                            placeholder={placeholderFor({
                                canSend,
                                chatLoading,
                                isLoading,
                                t,
                            })}
                            value={value}
                            onChange={(event) => updateInput(event.target)}
                            onPaste={handlePaste}
                            onKeyDown={handleKeyDown}
                            enterKeyHint={softKeyboard ? "enter" : "send"}
                            role="combobox"
                            aria-autocomplete="list"
                            aria-controls={
                                slashMenuOpen
                                    ? WORKFLOW_SLASH_MENU_ID
                                    : undefined
                            }
                            aria-expanded={slashMenuOpen}
                            aria-activedescendant={
                                slashMenuOpen && matchingWorkflows.length > 0
                                    ? `${WORKFLOW_SLASH_MENU_ID}-${resolvedSlashIndex}`
                                    : undefined
                            }
                            className="w-full resize-none overflow-x-hidden overflow-y-auto border-0 text-base p-0 bg-transparent outline-none placeholder:text-gray-400 leading-6 max-h-48"
                        />
                    </div>

                    {/* Controls */}
                    <div
                        ref={controlsRef}
                        className="flex items-center justify-between py-2 pr-2 pl-1.5"
                    >
                        <div className="flex items-center gap-1">
                            {!hideAddDocButton && composerOpen && (
                                <AddDocButton
                                    onLocalFiles={() => localFileInputRef.current?.click()}
                                    onBrowseAll={() => {
                                        setDocSelectorInitialTab("files");
                                        setDocSelectorOpen(true);
                                    }}
                                    onWorkflows={
                                        hideWorkflowButton
                                            ? undefined
                                            : () => {
                                                  setWorkflowModalInitialId(
                                                      undefined,
                                                  );
                                                  setWorkflowModalOpen(true);
                                              }
                                    }
                                    onPlaybooks={
                                        hideWorkflowButton
                                            ? undefined
                                            : () => {
                                                  setPlaybookModalInitialId(
                                                      undefined,
                                                  );
                                                  setPlaybookModalOpen(true);
                                              }
                                    }
                                />
                            )}
                        </div>

                        <div className="flex items-center gap-1">
                            {!chatSettingsLoading && (
                                <ModelToggle
                                    value={model}
                                    onChange={handleModelChange}
                                    apiKeys={apiKeys}
                                    apiKeysLoading={
                                        profileLoading && !profile
                                    }
                                    routerSelections={savedRouterSelections}
                                    compact={compactControls}
                                    compactShowsName
                                    triggerClassName={cn(
                                        TOUCH_TARGET_CLASS,
                                        "h-7.5 pointer-coarse:h-9",
                                    )}
                                    onNoModelsClick={setNoModelsWarning}
                                    reasoningLevel={reasoningLevel}
                                    onReasoningChange={handleReasoningChange}
                                    locked={routeFixed}
                                />
                            )}
                            {!chatSettingsLoading && offerCredentialChoice && !routeFixed && composerOpen && model !== "" && (
                                <ChatCredentialPicker
                                    options={credential.options}
                                    value={credential.value}
                                    onChange={credential.setValue}
                                    compact={compactControls}
                                />
                            )}
                            <button
                                type="button"
                                aria-label={
                                    isLoading ? t("assistant.chatInput.stopResponse") : t("assistant.chatInput.sendMessage")
                                }
                                className={cn(
                                    COMPOSER_SEND_BUTTON_CLASS,
    SendArrowUI,
                                    // 40 px with the finger, in a 44 px zone.
                                    TOUCH_TARGET_CLASS,
                                    "h-7.5 w-7.5 rounded-[9px] pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:rounded-xl",
                                )}
                                onClick={handleActionClick}
                                disabled={
                                    !isLoading &&
                                    (!composerOpen ||
                                        (!value.trim() &&
                                            !hasAnnotatedExcerpt) ||
                                        slashCommandsLoading)
                                }
                            >
                                <SendArrowUI stop={isLoading} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <input
                ref={localFileInputRef}
                type="file"
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                multiple
                hidden
                aria-label={t("assistant.chatInput.uploadDocuments")}
                disabled={!composerOpen}
                onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    if (files.length) void handleDroppedFiles(files);
                }}
            />
            <ExcerptModalUI
                excerpt={openExcerpt}
                onClose={() => setOpenExcerpt(null)}
            />
            <AddDocumentsModal
                open={docSelectorOpen}
                keepMounted
                onClose={() => setDocSelectorOpen(false)}
                onSelect={handleAddDocsFromSelector}
                initialSelectedDocuments={attachedDocs}
                externalUploadedDocuments={droppedDocuments}
                initialTab={docSelectorInitialTab}
                projectId={dropUploadsToProject ? projectId : undefined}
                uploadStateId={`assistant-chat:${projectId ?? "standalone"}`}
                breadcrumb={
                    selectedWorkflow
                        ? [t("assistant.chatInput.assistant"), selectedWorkflow.title, t("assistant.chatInput.addDocuments")]
                        : [t("assistant.chatInput.assistant"), t("assistant.chatInput.addDocuments")]
                }
            />
            <AssistantWorkflowModal
                open={workflowModalOpen}
                onClose={() => setWorkflowModalOpen(false)}
                onSelect={(wf) => {
                    setSelectedWorkflow({
                        id: wf.id,
                        title: wf.metadata.title,
                    });
                    setWorkflowModalOpen(false);
                }}
                projectName={projectName}
                projectCmNumber={projectCmNumber}
                initialWorkflowId={workflowModalInitialId}
            />
            <PlaybookPickerModal
                open={playbookModalOpen}
                onClose={() => setPlaybookModalOpen(false)}
                onSelect={(playbook) =>
                    setSelectedPlaybook({
                        id: playbook.id,
                        title: playbook.name || t("assistant.chatInput.untitledPlaybook"),
                    })
                }
                breadcrumbs={
                    projectName
                        ? [t("assistant.chatInput.projects"), projectName, t("assistant.chatInput.assistant"), t("assistant.chatInput.addPlaybook")]
                        : [t("assistant.chatInput.assistant"), t("assistant.chatInput.addPlaybook")]
                }
                initialPlaybookId={playbookModalInitialId}
            />
            <ApiKeyMissingPopup
                open={apiKeyModalProvider !== null}
                onClose={() => setApiKeyModalProvider(null)}
            />
            <NoModelsWarningPopup
                reason={noModelsWarning}
                onClose={() => setNoModelsWarning(null)}
            />
            <WarningPopup
                open={modelRequiredWarning}
                onClose={() => setModelRequiredWarning(false)}
                title={t("assistant.chatInput.selectAModel")}
                message={t("assistant.chatInput.chooseAModelBeforeSendingYour")}
            />
            <UploadOverlay
                open={isDraggingFiles}
                warning={uploadWarning}
                onWarningClose={() => setUploadWarning(null)}
            />
        </>
    );
}

const ChatInputForChat = forwardRef<ChatInputHandle, Props>(ChatInputForChatImpl);

/**
 * Chat composer whose draft and asynchronous uploads belong to one chat key.
 * Changing the key remounts the stateful implementation; its layout cleanup
 * invalidates callbacks before the replacement composer can be displayed.
 */
export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput(
    props,
    ref,
) {
    const identity = useWorkspaceIdentity();
    return (
        <ChatInputForChat
            key={`${identity}:${props.chatKey ?? "new-chat"}`}
            {...props}
            ref={ref}
        />
    );
});
