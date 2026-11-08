// Authored wire contracts. No server, browser, UI or storage dependencies.

export type TabularReviewHistoryStatus = {
  id: string;
  is_running: boolean;
  is_complete: boolean;
};

export type SourceDocumentType =
  | "docx"
  | "pdf"
  | "spreadsheet"
  | "case"
  | "legislation";

export type SourceDocumentMetadata = {
  label: string;
  value: string;
  format?: "date";
};

export type SourceDocumentAction = {
  type: "download" | "link";
  url: string;
  label: string;
  title?: string;
};

export type SourceDocumentQuote = {
  quote: string;
  verification?: {
    verified: boolean;
    source_excerpt?: string;
    start_char?: number;
    end_char?: number;
  };
  target: {
    page?: number | string;
    sheet?: string;
    cell?: string;
    subdocument_id?: string;
  };
};

export type SourceSubdocument = {
  document_id: string;
  title: string;
  type: "html";
  html?: string | null;
  text?: string | null;
};

export type SourceDocument = {
  document_id: string;
  title: string;
  type: SourceDocumentType;
  metadata: SourceDocumentMetadata[];
  actions?: SourceDocumentAction[];
  quotes: SourceDocumentQuote[];
  subdocuments?: SourceSubdocument[];
  version_id?: string | null;
  version_number?: number | null;
};

/**
 * Per-quote verification result. `start_char`/`end_char` index into the
 * EXTRACTED source text (not the raw file bytes) and are only present for
 * single-segment quotes that matched.
 */
export type QuoteVerification = {
  verified: boolean;
  start_char?: number;
  end_char?: number;
  source_excerpt?: string;
};

// ---------------------------------------------------------------------------
// Event / annotation types (shared between toolDispatcher and streaming)
// ---------------------------------------------------------------------------

export type AskInputOption = {
  value: string;
};

export type AskInputItem =
  | {
      id: string;
      kind: "choice";
      question: string;
      options: AskInputOption[];
      allow_other: boolean;
      other_label: string;
      response_prefix?: string;
    }
  | {
      id: string;
      kind: "multi_choice";
      question: string;
      options: AskInputOption[];
      allow_other: boolean;
      other_label: string;
      response_prefix?: string;
    }
  | {
      id: string;
      kind: "text";
      question: string;
      response_prefix?: string;
    }
  | {
      id: string;
      kind: "documents";
      document_types: string[];
      response_prefix?: string;
    }
  | ConnectorApprovalItem;

/**
 * A connector write the server paused for the user's approval. The server
 * creates these items, never the model's ask_inputs tool, and on approval it
 * runs the stored `action` from the persisted event — the client supplies
 * only the decision.
 */
export type ConnectorApprovalItem = {
  id: string;
  kind: "approval";
  connector_name: string;
  /** Tool name as the model called it. */
  tool_name: string;
  /** Human-readable action label, e.g. "Send email". */
  title: string;
  /** Arguments that run on approval, shown for review. */
  arguments: Record<string, unknown>;
  /** Current state the action changes, when the connector can read it. */
  before?: unknown;
  /** Account the action runs as, when known. */
  account?: string;
  /** Title of the delegated task that asked for this action, if a subagent did. */
  requested_by?: string;
  /** Server-side binding to the connection that was reviewed. */
  binding: ConnectorApprovalBinding;
};

export type ConnectorApprovalBinding =
  | {
      type: "mcp";
      connector_id: string;
      tool_id: string;
      /** Absent on legacy approvals, which must be reviewed again. */
      connection_fingerprint?: string;
    }
  | {
      type: "google";
      provider: GoogleWorkspaceProvider | "google-drive";
      grant_id: string;
      etag?: string;
    };

export type AskInputsEvent = {
  type: "ask_inputs";
  /** Stable identity for this particular prompt within its assistant message. */
  event_id: string;
  items: AskInputItem[];
};

export type AskInputResponseItem =
  | {
      id: string;
      kind: "choice";
      question: string;
      answer?: string;
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "multi_choice";
      question: string;
      answers?: string[];
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "text";
      question: string;
      answer?: string;
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "documents";
      filenames: string[];
      skipped?: boolean;
    }
  | {
      id: string;
      kind: "approval";
      decision: "approve" | "reject";
    };

export type AskInputsResponseRequest = {
  /** Durable assistant row that contains the unanswered ask_inputs event. */
  assistant_message_id: string;
  /** The exact ask_inputs event being answered. */
  ask_event_id: string;
  responses: AskInputResponseItem[];
};

export type EditAnnotation = {
  kind: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before: string;
  context_after: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
};

export type McpToolEvent = {
  type: "mcp_tool_call";
  connector_id: string;
  connector_name: string;
  tool_name: string;
  /** Human-readable tool label from the connector, when it provides one. */
  tool_title?: string;
  openai_tool_name: string;
  status: "ok" | "error";
  error?: string;
  /** The approval item this call ran for, when it needed the user's approval. */
  approval_id?: string;
  /** Bounded tool output replayed to the model after an approved call. */
  result?: string;
};

export type WebSource = { url: string; title?: string };

export type WebToolErrorCode =
  /** Mike's search has no key for the chosen search service. */
  | "not_configured"
  /** The search API refused the key: invalid, or its plan does not cover the request. */
  | "rejected"
  /** No search backend could run, or the model provider refused its own search. */
  | "unavailable"
  /** The page could not be read: a blocked address, an unsupported type, a failed fetch. */
  | "unreadable"
  | "failed";

/**
 * Web activity in a turn. A search done by the model provider and one done
 * by Mike's own search look the same.
 */
export type WebToolEvent =
  | {
      type: "web_search";
      search_id: string;
      query: string;
      results: WebSource[];
      error?: string;
      error_code?: WebToolErrorCode;
    }
  | {
      type: "web_read";
      read_id: string;
      url: string;
      title?: string;
      error?: string;
      error_code?: WebToolErrorCode;
    }
  /** Pages the answer cites, as reported by the model provider. */
  | { type: "web_sources"; sources: WebSource[] };

export type DelegationEffort = "quick" | "standard" | "deep";

/**
 * LiTT: a named model route a user lets chat subagents run on (Settings >
 * Subagents). The agent only sees `name` and `description`.
 */
export type SubagentRoute = {
  name: string;
  description: string;
  model: string;
  reasoning?: string;
  /**
   * Set on read when the model left the catalog: the route is kept, and a
   * subagent sent to it fails instead of running on another model. Never stored.
   */
  unavailable?: true;
};

/** A user's routes, in their order, and the one a task without a route uses. */
export type SubagentRoutes = { routes: SubagentRoute[]; default: string | null };

/**
 * One delegated task: a subagent's own steps and the brief it returned to the
 * assistant. The brief keeps the subagent's citation markers; the assistant
 * re-cites anything it relies on.
 */
export type DelegationEvent = {
  type: "delegation";
  delegation_id: string;
  continued_from?: string;
  title: string;
  task: string;
  /**
   * `incomplete`: stopped by its time or token budget; the brief is partial.
   * `needs_input`: paused to ask `question` or for `approval_ids`.
   */
  status: "completed" | "incomplete" | "needs_input" | "failed" | "cancelled";
  brief?: string;
  question?: string;
  /** Approval items, held by the answer, that this paused subagent waits on. */
  approval_ids?: string[];
  events: AssistantEvent[];
  /** The user's route the subagent ran on; absent when it used the chat's model. */
  route?: string;
  /** The provider of `model`. Older runs did not record it. */
  provider?: string;
  model: string;
  effort: DelegationEffort;
  /** The reasoning level the subagent ran at. Older runs did not record it. */
  reasoning?: string;
  /** The tokens its effort allowed. Older runs did not record it. */
  token_budget?: number;
  usage?: { input_tokens: number; output_tokens: number };
  /**
   * Why its route could not run (a missing or revoked key, a model the
   * organization does not allow), from the server's own checks. Nothing ran.
   */
  route_unavailable?: string;
};

/**
 * What an answer ran on, sent once at its end: the model, the reasoning level
 * it was asked for, and the tokens the assistant itself used (each subagent
 * reports its own on its delegation event). Shown only when the user turns on
 * Settings > Features > Response details.
 */
export type ResponseDetailsEvent = {
  type: "response_details";
  model: string;
  reasoning?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

export type DocumentSearchErrorCode =
  | "schema_out_of_date"
  | "invalid_search"
  | "search_timeout"
  | "search_unavailable"
  | "internal_error";

/** One scoped text search; counts describe this page, not every matching document. */
export type DocumentSearchEvent = {
  type: "doc_search";
  search_id: string;
  scope: string;
  query: string;
  offset: number;
  match_count?: number;
  next_offset?: number | null;
  coverage?: {
    total_versions: number;
    indexed_versions: number;
    pending_versions: number;
    failed_versions: number;
    versions_needing_ocr: number;
  };
  /** Safe, user-facing failure message. No result count is supplied on failure. */
  error?: string;
  error_code?: DocumentSearchErrorCode;
};

export type TextCardEvent = {
  type: "text_card";
  card_id: string;
  title: string;
  /** Literal, copy-ready text. Whitespace and line breaks are significant. */
  text: string;
};

export type AssistantEvent =
  | TextCardEvent
  | DocumentSearchEvent
  | { type: "reasoning"; text: string }
  | AskInputsEvent
  | {
      type: "ask_inputs_response";
      assistant_message_id: string;
      ask_event_id: string;
      responses: AskInputResponseItem[];
      /** User who supplied this continuation, for scoped-memory attribution. */
      author_user_id?: string;
      /** Immutable evidence time used by memory wipe/enable cutoffs. */
      recorded_at?: string;
    }
  | {
      type: "doc_read";
      filename: string;
      document_id?: string;
      version_id?: string | null;
      version_number?: number | null;
    }
  | {
      type: "doc_find";
      filename: string;
      document_id?: string;
      version_id?: string | null;
      version_number?: number | null;
      query: string;
      total_matches: number;
    }
  | {
      type: "doc_created";
      filename: string;
      download_url: string;
      /** A pasante's unapproved version (docs/training.md): the card offers no download. */
      training_held?: boolean;
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
    }
  | { type: "doc_download"; filename: string; download_url: string }
  | {
      type: "doc_replicated";
      /** Source document being copied. */
      filename: string;
      count: number;
      copies: {
        new_filename: string;
        document_id: string;
        version_id: string;
      }[];
    }
  | { type: "workflow_applied"; workflow_id: string; title: string }
  | {
      type: "doc_edited";
      filename: string;
      document_id: string;
      version_id: string;
      /** Per-document monotonic Vn; null if backend couldn't determine it. */
      version_number: number | null;
      download_url: string;
      /** A pasante's unapproved version (docs/training.md): the card offers no download. */
      training_held?: boolean;
      annotations: EditAnnotation[];
    }
  | McpToolEvent
  | WebToolEvent
  | FirmCriteriaEvent
  | DelegationEvent
  | ResponseDetailsEvent
  | {
      type: "case_opinions";
      cluster_id: number;
      document: SourceDocument;
    }
  | { type: "content"; text: string }
  | {
      /**
       * Placement marker for one edit a client tool proposed, spliced into
       * the event stream exactly where the tool call landed between content
       * blocks. `persistWordDocumentEdits` upserts it into the canonical
       * `word_document_edits` row and swaps it for a `word_edit_ref` — the
       * same normalization the `<EDITS>` protocol's blocks go through, so
       * both channels produce identical persisted history.
       */
      type: "word_edit_block";
      block_index: number;
      original_text: string;
      replacement_text: string;
      formats: string[];
      occurrence: "all" | null;
      reason: string | null;
    }
  | {
      type: "error";
      message: string;
      safe_to_display?: boolean;
      /**
       * Machine-readable cause, when the client can offer a specific remedy.
       * "invalid_api_key": the provider rejected the caller's key.
       */
      code?: AssistantErrorCode;
      /**
       * The server's request id for the turn that failed (also the
       * X-Request-ID header), so a user can quote it to support. Only on the
       * terminal error frame a route writes; never on a persisted event.
       */
      request_id?: string;
      /** Reporting responsibility, not confirmation of telemetry delivery. Absent on older servers. */
      reporting_owner?: "backend";
    };

export type AssistantErrorCode = "invalid_api_key";

export type WordEditApplyMode = "direct" | "approval";

export interface WordDocumentEdit {
  id: string;
  messageId: string;
  blockIndex: number;
  originalText: string;
  replacementText: string;
  formats: string[];
  occurrence?: "all";
  reason?: string;
  applyMode: "direct" | "approval";
  applyStatus: "proposed" | "applied" | "unmanaged" | "failed";
  resolutionStatus?: WordEditResolutionStatus;
  matchedOccurrences?: number;
  appliedOccurrences?: number;
  errorCode?: string;
  errorMessage?: string;
}

export type WordEditResolutionStatus = "accepted" | "rejected";

/** Explicit Google service connections are independent of Mike sign-in. */
export type GoogleWorkspaceProvider = 'gmail' | 'google-calendar';
export interface GoogleDriveStatus {
    configured: boolean;
    /**
     * False when the operator switched Drive off for the deployment
     * (GOOGLE_WORKSPACE_DISABLED_PROVIDERS): Discover does not offer it, new
     * connections and Picker sessions are refused, and the assistant has none
     * of its tools.
     */
    available: boolean;
    schemaReady?: boolean;
    connected: boolean;
    scope: string | null;
    enabled: boolean;
    /** A Drive write scope (drive.file or legacy full drive) was granted and connection binding is available. */
    writeEnabled: boolean;
    requireWriteApproval: boolean;
    /** Disables write tools while preserving individual tool choices. */
    readOnly?: boolean;
    grantId?: string;
    /** Absent for connections made before the account was recorded. */
    accountEmail?: string;
    /**
     * Add files from Google Drive can be offered: the server has the Picker's
     * browser key and app id, and the connection (if any) holds the per-file
     * drive.file scope rather than a legacy whole-Drive one.
     */
    pickerAvailable: boolean;
    tools: NativeConnectorTool[];
    redirectUri?: string | null;
}
/** What the browser needs to open the Google Picker; never a refresh token. */
export interface GoogleDrivePickerSession {
    /** Short-lived drive.file access token. */
    accessToken: string;
    expiresAt: string;
    /** Google Cloud project number; picked files are granted to this app. */
    appId: string;
    /** Browser API key restricted to the Google Picker and Google Drive APIs. */
    developerKey: string;
}
export interface GoogleWorkspaceStatus {
    configured: boolean;
    /**
     * False when the operator switched this service off for the deployment
     * (GOOGLE_WORKSPACE_DISABLED_PROVIDERS): Discover does not offer it, new
     * connections are refused, and the assistant has none of its tools.
     */
    available: boolean;
    schemaReady: boolean;
    connected: boolean;
    /** Google granted write access; false when the user or an admin withheld it. */
    writeEnabled: boolean;
    /** Whether the assistant may use this connection at all. */
    enabled: boolean;
    /** Whether each write action waits for the user's approval in the conversation. */
    requireWriteApproval: boolean;
    /** Disables write tools while preserving individual tool choices. */
    readOnly?: boolean;
    tools: NativeConnectorTool[];
    grantId?: string;
    accountEmail?: string;
    redirectUri: string | null;
}
/** A built-in connector tool and whether the user has switched it on. */
export interface NativeConnectorTool {
    name: string;
    title: string;
    description: string;
    write: boolean;
    enabled: boolean;
}

/** Organization departure preview: only public transfer items expose titles. */
export interface OrgMemberHandover {
    sharedChats: number;
    sharedReviews: number;
    sharedDocuments: number;
    projects: { id: string; title: string }[];
    workflows: { id: string; title: string }[];
    privateProjects: number;
    privateWorkflows: number;
    chats: number;
    reviews: number;
    documents: number;
}

export type OrgPrivateContentKind = "project" | "workflow" | "chat" | "tabular_review" | "document";
export interface OrgPrivateContentItem {
    kind: OrgPrivateContentKind;
    item_id: string;
    title: string | null;
    user_id: string | null;
    display_name: string | null;
    email: string | null;
    has_access: boolean;
}
export interface OrgPrivateContentPage {
    items: OrgPrivateContentItem[];
    nextOffset: number | null;
}

/** Owner-only recovery list; these items are excluded from normal access. */
export interface OrgDepartureArchive {
    id: string;
    kind: "project" | "workflow" | "chat" | "tabular_review" | "document";
    item_id: string;
    title: string;
    archived_at: string;
    expires_at: string;
}
export interface OrgDepartureArchivePage {
    items: OrgDepartureArchive[];
    nextOffset: number | null;
}
/** An archived item as the Departed members view lists it. */
export interface OrgDepartureItem extends OrgDepartureArchive {
    /** What a project or workflow holds; absent for the other kinds. */
    contents?: { documents: number; chats: number; tabular_reviews: number };
}
/** The archived work one member left behind when they departed. */
export interface OrgDeparture {
    /** Identifies the departure for as long as any of its work is archived. */
    key: string;
    /** Null once the departed account has been deleted. */
    member: {
        user_id: string;
        display_name: string | null;
        email: string | null;
    } | null;
    departed_at: string;
    /** When the earliest of its items is permanently deleted. */
    expires_at: string;
    items: OrgDepartureItem[];
}
/** Soonest deletion first. `truncated` when there was more than is listed. */
export interface OrgDepartureList {
    departures: OrgDeparture[];
    truncated: boolean;
}
/** `unresolved` items could not be reassigned or deleted and are still archived. */
export interface OrgDepartureResolution {
    resolved: number;
    unresolved: number;
}

/** A team organization still inside its owner-only recovery period. */
export interface DeletedOrganization {
    id: string;
    name: string;
    deleted_at: string;
    purge_after: string;
}

/** An identity visible in an authorized organization's audit history. */
export interface AuditActor {
  user_id: string;
  email: string | null;
  display_name: string | null;
  profile_photo: string | null;
}

export interface AuditActorPage {
  users: AuditActor[];
  nextOffset: number | null;
}

/** What account erasure removed, and what it kept and why. */
export interface AccountDeletionReceiptContent {
  deleted: string[];
  retained: { item: string; reason: string }[];
}

/**
 * `POST /user/account/deletion-receipt`. The person reads it with the token
 * `DELETE /user/account` returned, after their session has been revoked.
 */
export type AccountDeletionReceipt =
  | { status: "pending"; requested_at: string }
  | { status: "running"; requested_at: string }
  | { status: "failed"; requested_at: string }
  | ({
      status: "completed";
      requested_at: string;
      completed_at: string;
      /** The date (UTC) by which the last backup copy has been deleted. */
      backups_expire_on: string;
    } & AccountDeletionReceiptContent);

/** `DELETE /user/account` (202). */
export interface AccountDeletionStarted {
  receipt_token: string;
}

// LiTT training (docs/training.md). A stage applies to one person in one
// organization, for one practice area (`practice`, normalized as
// lower(btrim(...))) or for all of them (`practice: null`).
export type TrainingStage = "pasante" | "junior";

// --- Training layer 3, card 2: verdict, thermometer and backing (begin) ---
export type TrainingConfidenceLevel = 1 | 2 | 3 | 4;
export type TrainingVerdictValue = "coincide" | "parcial" | "no_coincide";
/** PUT /orgs/:orgId/training/pupils/:userId/notes/:noteId/verdict (the pupil's current mentor). */
export interface TrainingNoteVerdictBody {
  verdict: TrainingVerdictValue;
}
/** The note after the mentor's correction. */
export interface TrainingNoteVerdictResult {
  id: string;
  verdict: TrainingVerdictValue;
  verdict_source: "mentor";
  effective_verdict: TrainingVerdictValue;
}
// --- Training layer 3, card 2 (end) ---

export interface TrainingStageEntry {
    practice: string | null;
    stage: TrainingStage;
}
/** GET /training/me: one entry per organization where the caller has training. */
export interface TrainingMembership {
    org_id: string;
    is_mentor: boolean;
    mentor_user_id: string | null;
    stages: TrainingStageEntry[];
}
/** GET /training/stage: the caller's effective stage where a turn would run. */
export interface TrainingEffectiveStage {
    stage: TrainingStage | null;
    /**
     * Whether a turn there must carry the caller's own attempt («Tu turno
     * primero»): a pasante's, unless an urgency pass on that project is in
     * force. The server decides again on every turn.
     */
    attempt_required: boolean;
    /** The urgency pass in force on that project (never in Word), or null. */
    urgency_pass: TrainingUrgencyPassInForce | null;
    /**
     * Whether a turn there must carry the thermometer mark (`confidence`,
     * 1 to 4) next to the attempt: exactly when `attempt_required`. Absent
     * from servers older than layer 3, which ask for no mark.
     */
    confidence_required?: boolean;
    /**
     * Layer 3, hints and the counterparty's lawyer: the modes open to the
     * caller now (`TrainingTurnMode`), counted by the server from the
     * caller's own notes of `chat_id`. Empty when the turn owes no approach
     * (another stage, an urgency pass). Absent from older servers.
     */
    modes?: TrainingTurnMode[];
    /** The rung the next hint would be, or null when the ladder is used up or no hint is open. */
    next_hint_level?: 1 | 2 | 3 | null;
    /** The step the next counterpart turn would take, or null when the round is full or none is open. */
    counterpart_next_step?: 1 | 2 | 3 | null;
}

// --- Training layer 3, card 4: own map, calibration and retake (begin) ---
// --- Training layer 3, card 4 (end) ---

/** The end of the urgency pass that lifts «Tu turno primero» on a project. */
export interface TrainingUrgencyPassInForce {
    project_id: string;
    expires_at: string;
}
/** GET /orgs/:orgId/training/mentors: who mentors whom, for owners and admins. */
export interface TrainingOrgOverview {
    mentors: string[];
    pupils: { trainee_user_id: string; mentor_user_id: string }[];
}
/** GET /orgs/:orgId/training/pupils: a mentor's pupils and who they could take on. */
export interface TrainingMyPupils {
    pupils: { user_id: string; stages: TrainingStageEntry[] }[];
    candidates: string[];
}

// training turn notes (docs/training.md): a pasante's private record of a
// chat turn, readable only by its author and their current mentor.
export type TrainingContrastStatus = "pending" | "ready" | "failed" | "skipped";
export interface TrainingTurnNote {
  id: string;
  org_id: string;
  trainee_user_id: string;
  /** The chat the note belongs to, whichever surface it is from. */
  chat_id: string;
  /** The user message the note is about. */
  message_id: string;
  /** What the pasante wrote before asking ("Tu planteamiento"). */
  attempt: string;
  /** Coincide / No coincide / Faltó; null until ready. */
  contrast: string | null;
  /** `failed` also covers a contrast still pending long after the turn. */
  contrast_status: TrainingContrastStatus;
  created_at: string;
  // --- Layer 3: absent on the notes of layers 1 and 2, which read as before ---
  /** How sure the pasante said they were of their approach: 1 «casi adivino» to 4 «seguro». */
  confidence?: TrainingConfidenceLevel | null;
  /** How the approach matches the answer, according to the AI contrast or the mentor. */
  verdict?: TrainingVerdictValue | null;
  verdict_source?: "contrast" | "mentor" | null;
  /** The verdict that counts: `coincide` with a wrong foundation counts as `parcial`. */
  effective_verdict?: TrainingVerdictValue | null;
  /** The conclusion matched but the reasoning did not («acertaste por la razón equivocada»). */
  right_for_wrong_reason?: boolean;
  foundation?: "solid" | "weak" | "wrong" | null;
  /** One question about the basis of an approach whose conclusion matched. */
  foundation_question?: string | null;
  topics?: string[] | null;
  /** The answer carried a citation that could not be verified: the turn does not count as evidence. */
  answer_unverified?: boolean;
  /** `hint` or `counterpart*` turns (card 6); `step` is the rung or the turn of the round. Absent on plain turns. */
  mode?: TrainingTurnMode | null;
  step?: 1 | 2 | 3 | null;
}

// --- Training layer 3, card 6: ladder hints and counterpart (begin) ---
/**
 * What a turn can be besides a plain question, sent as `training_mode`:
 * `hint` (a rung of the ladder, no answer), `counterpart` (a turn of a round
 * with the counterparty's lawyer, up to three) and `counterpart_close`
 * (ends the round with a contrast). The server picks the step.
 */
export type TrainingTurnMode =
  | "hint"
  | "counterpart"
  | "counterpart_close"
  | "criteria_contrast"
  | "criteria_explain";
// --- Training layer 3, card 6 (end) ---

/** GET /training-notes/chats/:chatId (404 when the caller may read none). */
export interface TrainingTurnNotes {
  notes: TrainingTurnNote[];
}
// Request bodies and queries of the training routes. `user_id` and
// `mentor_user_id` are user uuids of members of the organization.
/** POST /orgs/:orgId/training/mentors (owner or admin). */
export interface TrainingDesignateMentorBody {
    user_id: string;
}
/** POST /orgs/:orgId/training/pupils. Omitting `mentor_user_id` means the caller. */
export interface TrainingAssignPupilBody {
    user_id: string;
    mentor_user_id?: string | null;
}
/** PUT /orgs/:orgId/training/pupils/:userId/stages (the pupil's mentor). `practice: null` covers every practice area; a blank string is rejected. */
export interface TrainingSetStageBody {
    practice: string | null;
    stage: TrainingStage;
}
/** DELETE /orgs/:orgId/training/pupils/:userId/stages?practice= . Without `practice`, the stage that covers every practice area. */
export interface TrainingRemoveStageQuery {
    practice?: string;
}

// --- Training layer 3, card 8: accountability mode (begin) ---
/**
 * How well one conclusion of a junior's answer rests on a source LiTT can show.
 * Computed by the server from the citations it verified, never by the model:
 * `backed` has a verified passage of a document in LiTT; `citation_unverified`
 * names a citation whose quote the server could not find; `unbacked` has none.
 * A law named from memory is `unbacked` (LiTT has no corpus of laws).
 */
export type TrainingBackingStatus = "backed" | "citation_unverified" | "unbacked";

/** The exact passage a `backed` conclusion rests on, as the server found it in the document. */
export interface TrainingBackingPassage {
  ref: number;
  /** The cited document's name. */
  title: string | null;
  page: number | string | null;
  excerpt: string;
}

export interface TrainingBackingConclusion {
  id: string;
  text: string;
  /** The citation the AI proposed for it (a proposal; the person checks the passage). */
  citation_ref: number | null;
  status: TrainingBackingStatus;
  passage: TrainingBackingPassage | null;
  /** Legal references the conclusion names that the shown passage does not, e.g. `art. 27, fr. IV`. */
  unverified_references: string[];
  person_verified: boolean;
  /** Why the person keeps the conclusion; learning data. */
  person_note: string | null;
}

export interface TrainingBackingCheck {
  id: string;
  org_id: string;
  trainee_user_id: string;
  chat_id: string;
  message_id: string;
  status: "pending" | "ready" | "failed";
  conclusions: TrainingBackingConclusion[] | null;
  created_at: string;
  updated_at: string;
}

/** GET /training/me/chats/:chatId/backing[?message_id=]. Only the caller's own checks. */
export interface TrainingChatBacking {
  checks: TrainingBackingCheck[];
}

/** PUT /training/me/chats/:chatId/backing/:checkId/conclusions/:conclusionId. */
export interface TrainingBackingMark {
  person_verified?: boolean;
  /** At most 500 characters; null or empty clears it. */
  person_note?: string | null;
}

export interface TrainingPupilBackingWork {
  surface: "chat" | "word" | "tabular";
  chat_id: string;
  project_id: string | null;
  title: string | null;
  checks: TrainingBackingCheck[];
}

/** GET /orgs/:orgId/training/pupils/:userId/backing. The current mentor's only. */
export interface TrainingPupilBacking {
  org_id: string;
  trainee_user_id: string;
  works: TrainingPupilBackingWork[];
  /** Works in matters the mentor cannot open: counted, never listed. */
  works_without_access: number;
}
// --- Training layer 3, card 8 (end) ---

// --- Training layer 3, card 13: criteria contrast (begin) ---
export type TrainingCriteriaContrastStatus = "awaiting_person" | "explained" | "failed";

/** What one of the two subagents ran on: identifiers only, never a credential. */
export interface TrainingCriteriaContrastRoute {
  /** The person's named route; absent when a neutral approach ran on the conversation's model. */
  name?: string;
  approach?: "literal" | "systematic";
  provider?: string;
  model?: string;
  /** The subagent's status, or "not_run" when it was never started. A failed one is never replaced. */
  status: string;
}

/** One contrast of the person's own, as GET /training/me/criteria-contrasts lists it. */
export interface TrainingCriteriaContrast {
  id: string;
  org_id: string;
  chat_id: string;
  status: TrainingCriteriaContrastStatus;
  routes: TrainingCriteriaContrastRoute[];
  /** The two analyses, in the order of `routes`; "" for one that did not run. */
  briefs: string[] | null;
  person_explanation: string | null;
  /** The AI's explanation compared with the person's, in the three sections of every contrast. */
  comparison: string | null;
  created_at: string;
}

export interface TrainingMyCriteriaContrasts {
  contrasts: TrainingCriteriaContrast[];
}

/** What the pupil's current mentor sees of a contrast: not the analyses, which stay in the pupil's chat. */
export interface TrainingPupilCriteriaContrast {
  id: string;
  chat_id: string;
  project_id: string | null;
  title: string | null;
  status: TrainingCriteriaContrastStatus;
  routes: TrainingCriteriaContrastRoute[];
  person_explanation: string | null;
  comparison: string | null;
  created_at: string;
}

/** GET /orgs/:orgId/training/pupils/:userId/criteria-contrasts. The current mentor's only. */
export interface TrainingPupilCriteriaContrasts {
  org_id: string;
  trainee_user_id: string;
  contrasts: TrainingPupilCriteriaContrast[];
  /** Contrasts in matters the mentor cannot open: counted, never listed. */
  contrasts_without_access: number;
}
// --- Training layer 3, card 13 (end) ---


/** GET /training/stage?org_id=|project_id=|surface=word. `project_id` requires access to the project. */
export interface TrainingStageQuery {
    org_id?: string;
    project_id?: string;
    surface?: "word";
    /** The chat the turn would continue; the hint ladder is counted from its notes. */
    chat_id?: string;
}

// LiTT training, layer 2 «Supervisión» (docs/training.md). Learning data:
// only the pupil and their current mentor read it
// (training_can_read_learning); nothing here is a score or a ranking.
export type TrainingGenerationStatus = "pending" | "ready" | "failed";
/** One line of a work review, with where it comes from. */
export interface TrainingReviewItem {
    /** e.g. `attempt`, `contrast`, `citation`, `inferred`: inferred lines are marked as such. */
    source: string;
    text: string;
    /** Id of what the line points at (a note, a message, a version), when there is one. */
    ref?: string | null;
    /**
     * On a `version` line (a sealed draft still held): the document the
     * version belongs to, which with `ref` is what the existing approval
     * route takes. Absent on reviews generated before it existed.
     */
    document_id?: string | null;
}
/** Where a piece of work was done: the web or project chat, Word, a tabular review. */
export type TrainingWorkSurface = "chat" | "word" | "tabular";

// --- Training layer 3, card 9: bulk review designer (begin) ---

/** How a person (or, over theirs, the mentor) marked a sampled cell. */
export type TrainingAuditMark = "correct" | "incomplete" | "incorrect";
export type TrainingAuditOutcome = "adequate" | "needs_work";
export type TrainingAuditStatus = "open" | "complete" | "stale";
/** What the code-only review of a review's questions found. */
export type TrainingLintCode =
    | "empty_name"
    | "duplicate_name"
    | "empty_instruction"
    | "short_instruction"
    | "no_format";
export interface TrainingLintWarning {
    code: TrainingLintCode;
    /** The column the warning is about (its `index` in columns_config). */
    column_index: number;
    /** The other column of a duplicated name. */
    other_index?: number;
}
export interface TrainingAuditColumn {
    index: number;
    name: string;
    /** The instruction of the column. */
    prompt: string;
}
export interface TrainingAuditCell {
    row_id: string;
    column_index: number;
    column_name: string;
    row_label: string | null;
    /** The cell as it is now, only when the reader may read its sources. */
    summary: string | null;
    /** The reasoning with its inline citations, as the review stores it. */
    reasoning: string | null;
    /** The reader may not read the sources of this cell. */
    withheld: boolean;
    mark: TrainingAuditMark | null;
    note: string | null;
    /** The mentor's correction of the person's mark. */
    mentor_mark: TrainingAuditMark | null;
}
/** Counts of one person's own marks in one column: never a group figure. */
export interface TrainingAuditColumnTally {
    column_index: number;
    column_name: string;
    marked: number;
    incorrect: number;
    incomplete: number;
}
export interface TrainingReviewAudit {
    id: string;
    tabular_review_id: string;
    status: TrainingAuditStatus;
    columns: TrainingAuditColumn[];
    lint: TrainingLintWarning[];
    cells: TrainingAuditCell[];
    /** Sampled cells the reader may not read. */
    withheld: number;
    created_at: string;
    completed_at: string | null;
    /** Only once the audit is complete. */
    tally: TrainingAuditColumnTally[] | null;
    evaluation: {
        outcome: TrainingAuditOutcome;
        note: string | null;
        evaluated_at: string;
    } | null;
}
/** GET /tabular-review/:reviewId/training-audit */
export interface TrainingReviewAuditState {
    /** The review is one the caller audits as a junior. */
    applies: boolean;
    /** Done cells enough to draw a sample. */
    ready: boolean;
    /** The review's questions now (names and instructions). */
    columns: TrainingAuditColumn[];
    /** The review of the current questions, by code. */
    lint: TrainingLintWarning[];
    audit: TrainingReviewAudit | null;
}
export interface TrainingAuditMarkBody {
    mark: TrainingAuditMark;
    note?: string | null;
}
/** GET /orgs/:orgId/training/pupils/:userId/review-audits */
export interface TrainingPupilReviewAudits {
    audits: (TrainingReviewAudit & { review_title: string | null })[];
    /** Audits of reviews in matters the mentor cannot open: counted, not shown. */
    without_access: number;
}
export interface TrainingAuditEvaluationBody {
    outcome: TrainingAuditOutcome;
    note?: string | null;
    /**
     * The mentor's own mark on sampled cells, over the person's. The current
     * mentor may change it again, or take it back with `mark: null`.
     */
    corrections?: { row_id: string; column_index: number; mark: TrainingAuditMark | null }[];
}

// --- Training layer 3, card 9 (end) ---

/** Counted, never generated: what the review's lines rest on. */
export interface TrainingWorkSignals {
    notes: number;
    contrasts_ready: number;
    citations: number;
    citations_unverified: number;
    edits_accepted: number;
    edits_rejected: number;
    edits_pending: number;
    /** The pupil's sealed drafts from this work still without an approval. */
    held_versions: number;
    /** Layer 3: hints asked and the highest rung reached, counted from the notes. Absent on older reviews. */
    hints_used?: number;
    max_hint_level?: number;
    /** Layer 3: counterparty rounds started, and how many were closed. */
    counterpart_rounds?: number;
    counterpart_closed?: number;
}
/**
 * The two-minute review of one piece of work: one chat with turn notes.
 * Exactly one of `chat_id`, `word_chat_id`, `tabular_chat_id` is set, the
 * one of `surface`. The lists are null unless `status` is `ready`.
 */
export interface TrainingWorkReview {
    id: string;
    org_id: string;
    trainee_user_id: string;
    surface: TrainingWorkSurface;
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
    /** `failed` also covers a generation still pending long after it started. */
    status: TrainingGenerationStatus;
    /** The newest turn note it covers; a later note means new work. */
    covered_through: string | null;
    /** The pupil's own attempts, as written. */
    proposed: TrainingReviewItem[] | null;
    /** From the contrasts, put in order by the model. */
    ai_corrected: TrainingReviewItem[] | null;
    /**
     * Inferred by the model from the signals (source `inferred`), after the
     * lines the server computes from the notes (source `hint`, `confidence`,
     * `foundation`, `counterpart`; `ref` is the note).
     */
    doubts: TrainingReviewItem[] | null;
    /** Computed, never generated: unverified citations, held drafts, «Faltó». */
    unverified: TrainingReviewItem[] | null;
    signals: TrainingWorkSignals | null;
    /** The mentor's route that generated it (never the credential). */
    model_provider: string | null;
    model: string | null;
    generated_at: string | null;
    reviewed_at: string | null;
}
/** One piece of work of a pupil, with its review when there is one. */
export interface TrainingPupilWork {
    surface: TrainingWorkSurface;
    /** The chat's id in the table of its surface. */
    chat_id: string;
    /** The matter's project, when the work was done in one. */
    project_id: string | null;
    title: string | null;
    notes: number;
    last_note_at: string;
    review: TrainingWorkReview | null;
    /** A turn note newer than what the review covers. */
    has_new_work: boolean;
}
/** Whether the mentor can generate reviews, and on which of their keys. */
export type TrainingReviewGeneration =
    | {
          available: true;
          model: string;
          credential_options: { credential_ref: string; source: "personal" | "organization" | "deployment" | "operator" }[];
          /** What is used without an explicit choice; null: the mentor must choose. */
          default_credential_ref: string | null;
      }
    | { available: false; code: "training_review_key_required" };
/** GET /orgs/:orgId/training/pupils/:userId/works (the pupil's current mentor). */
export interface TrainingPupilWorks {
    org_id: string;
    trainee_user_id: string;
    works: TrainingPupilWork[];
    /** Works in matters the mentor cannot open: counted, never shown. */
    works_without_access: number;
    generation: TrainingReviewGeneration;
}

// --- Training layer 3, card 10: periodic full reading (begin) ---

/** Where a periodic full reading stands. `comparing` is the machine reading. */
export type TrainingReadingStatus = "assigned" | "submitted" | "comparing" | "compared" | "failed";

/** A finding of the machine and the passage of the document it rests on (located in its text). */
export interface TrainingReadingMachineFinding {
  text: string;
  excerpt: string;
}

/**
 * How the person's lines and the machine's findings compare. Every index
 * points into `person_items` or into the reading's `machine_findings`; the
 * pairing is proposed by the AI (inferred), the lists are not. `discarded`
 * counts machine findings dropped because their quote is not in the document.
 */
export interface TrainingReadingComparison {
  person_items: string[];
  both: { person: number; machine: number }[];
  only_person: number[];
  only_machine: number[];
  discarded: number;
}

export interface TrainingReading {
  id: string;
  org_id: string;
  trainee_user_id: string;
  /** The matter the document belongs to; null once it is gone. */
  project_id: string | null;
  status: TrainingReadingStatus;
  /** The proposed document was already changed once. */
  swapped: boolean;
  findings: string | null;
  submitted_at: string | null;
  machine_findings: TrainingReadingMachineFinding[] | null;
  comparison: TrainingReadingComparison | null;
  model_provider: string | null;
  model: string | null;
  created_at: string;
}

export interface TrainingReadingEligibility {
  /** Reading applies to people at the junior stage only. */
  is_junior: boolean;
  /** A reading can be started now (junior, none open, the interval passed). */
  due: boolean;
  open_reading_id: string | null;
  last_submitted_at: string | null;
  next_due_at: string | null;
}

/** GET /training/me/readings?org_id= */
export interface TrainingReadings {
  org_id: string;
  eligibility: TrainingReadingEligibility;
  /** The machine's reading runs on the caller's own key; null when it cannot. */
  generation: TrainingReviewGeneration;
  readings: TrainingReading[];
}

/** GET /orgs/:orgId/training/pupils/:userId/readings */
export interface TrainingPupilReadings {
  org_id: string;
  trainee_user_id: string;
  readings: TrainingReading[];
  /** Readings of documents in matters the mentor cannot open: counted, never shown. */
  readings_without_access: number;
}

/** GET /training/me/readings/:id/document: shown to read, never stored on the reading. */
export interface TrainingReadingDocument {
  reading_id: string;
  filename: string | null;
  text: string;
}

/** PUT /training/me/readings/:id/findings */
export interface TrainingReadingFindingsBody {
  findings: string;
}

/** POST /training/me/readings/:id/compare */
export interface TrainingReadingCompareBody {
  credential_ref?: string | null;
}
// --- Training layer 3, card 10 (end) ---

/** POST /orgs/:orgId/training/pupils/:userId/works/:surface/:chatId/review */
export interface TrainingWorkReviewBody {
    /** One of the mentor's credential options; omitted, the stored route or the default. */
    credential_ref?: string | null;
}
export type TrainingDefenseQuestionKind = "base" | "cambio_de_hechos";
export interface TrainingDefenseQuestion {
    kind: TrainingDefenseQuestionKind;
    text: string;
    /** What the mentor should listen for. */
    listen_for: string;
}
export type TrainingDefenseOutcome = "approved" | "not_approved";

// --- Training layer 3, card 12: correction to rule (begin) ---
// --- Training layer 3, card 12 (end) ---

/** Why a defense had its outcome: a closed list (learning data, never audited). */
export type TrainingDefenseReason =
    | "razonamiento_solido"
    | "razonamiento_incompleto"
    | "cambio_de_hechos_no_resuelto"
    | "sin_sustento"
    | "otro";
/** An oral defense: five questions (one a change of facts) and its outcome, recorded once. */
export interface TrainingDefense {
    id: string;
    org_id: string;
    trainee_user_id: string;
    practice: string | null;
    work_review_id: string | null;
    questions_status: "none" | TrainingGenerationStatus;
    /**
     * For the pupil, null until the outcome is recorded: before that they
     * see only that a defense is scheduled.
     */
    questions: TrainingDefenseQuestion[] | null;
    /** The mentor's route that generated the questions (never the credential). */
    model_provider: string | null;
    model: string | null;
    outcome: TrainingDefenseOutcome | null;
    outcome_reason: TrainingDefenseReason | null;
    /** For the pupil, null until the outcome is recorded, like `questions`. */
    outcome_note: string | null;
    held_at: string | null;
    created_at: string;
}
/** GET /orgs/:orgId/training/pupils/:userId/defenses (the pupil's current mentor). */
export interface TrainingDefenses {
    defenses: TrainingDefense[];
    /** Whether the mentor can generate questions, and on which of their keys. */
    generation: TrainingReviewGeneration;
}
/**
 * POST /orgs/:orgId/training/pupils/:userId/defenses. `practice` omitted:
 * the practice area of the work's matter when `work_review_id` names one,
 * otherwise every practice area (null).
 */
export interface TrainingCreateDefenseBody {
    practice?: string | null;
    work_review_id?: string | null;
}

// --- Training layer 3, card 13: criteria contrast (begin) ---
// --- Training layer 3, card 13 (end) ---

/** POST …/defenses/:id/questions */
export interface TrainingDefenseQuestionsBody {
    credential_ref?: string | null;
}
/** PUT …/defenses/:id/outcome: once (409 training_defense_already_recorded). */
export interface TrainingDefenseOutcomeBody {
    outcome: TrainingDefenseOutcome;
    reason: TrainingDefenseReason;
    /** Up to 500 characters. */
    note?: string | null;
}
/** A stage a promotion moves from and to; `abogado` means no stage. */
export type TrainingPromotionTarget = "junior" | "abogado";
/** One piece of evidence: what it is and when it happened, never a score. */
export interface TrainingPromotionEvidence {
    id: string;
    at: string;
}

// --- Training layer 3, card 14: firm criteria (begin) ---

/** `criterio`: a position of the firm. `voto_particular`: disagrees with a playbook rule. */
export type FirmCriterionKind = "criterio" | "voto_particular";

/**
 * A position a person of the firm wrote (docs/training.md, "One mold of
 * criterion"). It is the firm's content, not learning data, and LiTT gives it
 * no legal authority: it says who wrote what, and when.
 */
export type FirmCriterionSnapshot = {
  id: string;
  kind: FirmCriterionKind;
  /** Practice area, normalized; null for any. */
  practice: string | null;
  topic: string;
  position: string;
  /** Null when the author's account was erased. */
  author_user_id: string | null;
  /** The author's name as their profile gives it; null for a deleted user. */
  author_name: string | null;
  /** A dissenting opinion names the rule of a playbook it disagrees with. */
  playbook_id: string | null;
  rule_id: string | null;
  created_at: string;
  updated_at: string;
};

export type FirmCriterion = FirmCriterionSnapshot & {
  /** The caller wrote it. */
  mine: boolean;
};

export type FirmCriteriaList = {
  criteria: FirmCriterion[];
  /** The caller may write criteria (no training stage). */
  can_write: boolean;
  /** The caller may remove any criterion (owner or admin). */
  can_manage: boolean;
  max_per_organization: number;
};

export type FirmCriterionInput = {
  kind?: FirmCriterionKind;
  practice?: string | null;
  topic: string;
  position: string;
  /** Required with `voto_particular`: the playbook and the rule it disagrees with. */
  playbook_id?: string | null;
  rule_id?: string | null;
};

/**
 * Emitted by the server when the assistant consults the firm's criteria in a
 * trainee's turn: the criteria exactly as stored, with author and date, so the
 * attribution never depends on what the model says.
 */
export type FirmCriteriaEvent = {
  type: "firm_criteria";
  call_id: string;
  practice: string | null;
  topic: string | null;
  criteria: FirmCriterionSnapshot[];
  /** There were more matching criteria than the turn carries. */
  truncated: boolean;
  /** Set when the consultation failed; no criteria then. */
  error?: string;
};
// --- Training layer 3, card 14 (end) ---

/**
 * One of the pupil's stages and whether LiTT proposes the next one. The
 * evidence counts only since that stage last changed; for the stage that
 * covers every practice area, evidence of any practice area counts.
 */
export interface TrainingPromotionProposal {
    practice: string | null;
    from: TrainingStage;
    to: TrainingPromotionTarget;
    proposed: boolean;
    /**
     * What stops a proposal even once the counts are met, set whether or not
     * they are met yet; `proposed` also needs the counts (`required`).
     */
    blocked_by: "not_approved_after" | "general_stage_remains" | null;
    approved_defenses: TrainingPromotionEvidence[];
    reviewed_works: TrainingPromotionEvidence[];
    /** The pupil's drafts approved by a mentor or a lawyer: shown, not required. */
    approved_versions: TrainingPromotionEvidence[];
    required: { approved_defenses: number; reviewed_works: number };
}
/** GET /orgs/:orgId/training/pupils/:userId/promotion (the pupil's current mentor). */
export interface TrainingPromotion {
    proposals: TrainingPromotionProposal[];
}
/** POST …/promotion: accept a proposal still in force; the mentor always decides. */
export interface TrainingAcceptPromotionBody {
    practice: string | null;
    to: TrainingPromotionTarget;
}
export type TrainingUrgencyReason = "plazo" | "audiencia" | "cliente_urgente" | "otro";

// --- Training layer 3, card 15: authorship (begin) ---
/**
 * `GET /single-documents/:id/versions/:versionId/authorship`: an ESTIMATE of
 * how much of a version's text came from the assistant, from what LiTT
 * recorded (assistant edits, the generated or uploaded starting text). It is
 * computed on request and never stored. What cannot be attributed is
 * `undetermined`; it is not a detector of AI text.
 */
export type DocumentAuthorshipStatus =
  | "ok"
  /** The version's text is not extracted yet (or was never): nothing to attribute. */
  | "text_pending"
  | "text_failed"
  | "too_large"
  | "empty";
/** Where the version's starting text came from: the assistant, a file somebody uploaded, or no record. */
export type DocumentAuthorshipBaseline = "ai" | "file" | "unknown";
export interface DocumentAuthorshipWords {
  total: number;
  /** Text that entered through a person's own edits in LiTT. */
  person: number;
  /** Text equal to what the assistant inserted and a person accepted, or generated. */
  ai: number;
  undetermined: number;
}
export interface DocumentAuthorship {
  document_id: string;
  version_id: string;
  status: DocumentAuthorshipStatus;
  /** Always `true`: the figures are estimates by the rule the screen states. */
  estimate: true;
  baseline: DocumentAuthorshipBaseline;
  words: DocumentAuthorshipWords | null;
  /** Percent of `words.total`, rounded to multiples of 5 that add up to 100; `null` without text. */
  shares: { person: number; ai: number; undetermined: number } | null;
  /** Assistant edits recorded for this version and the ones it came from. */
  edits: { accepted: number; rejected: number; pending: number };
  /** Pages without a text layer: their text cannot be attributed. */
  textless_pages: number;
}
// --- Training layer 3, card 15 (end) ---

/** A mentor's time-limited pass, for one matter's project, that lifts «Tu turno primero». */
export interface TrainingUrgencyPass {
    id: string;
    org_id: string;
    trainee_user_id: string;
    project_id: string;
    starts_at: string;
    expires_at: string;
    reason_code: TrainingUrgencyReason;
    reason_note: string | null;
    revoked_at: string | null;
}
/**
 * POST /orgs/:orgId/training/pupils/:userId/passes (the pupil's current
 * mentor). `duration_minutes` from 30 to 4320 (72 h), 480 (8 h) when
 * omitted; at most 5 passes in force per pupil. `reason_note` (up to 500
 * characters) is learning data and never reaches the audit; the audit keeps
 * `reason_code`.
 */
export interface TrainingGrantUrgencyPassBody {
    project_id: string;
    duration_minutes?: number;
    reason_code: TrainingUrgencyReason;
    reason_note?: string | null;
}
/** GET /orgs/:orgId/training/pupils/:userId/passes (the pupil's current mentor). */
export interface TrainingUrgencyPasses {
    passes: TrainingUrgencyPass[];
    /**
     * Only when the request named `?project_ids=`: those of them that a pass
     * can be granted on (the organization's, openable by the mentor and by
     * the pupil). The grant still refuses the others.
     */
    grantable_project_ids?: string[];
}
/** GET /training/me/supervision?org_id= : what the caller's mentor sees of them there. */
export interface TrainingSupervision {
    org_id: string;
    work_reviews: TrainingWorkReview[];
    defenses: TrainingDefense[];
    urgency_passes: TrainingUrgencyPass[];
}

// --- Training layer 3, card 16: promotion by evidence v2 (begin) ---
// --- Training layer 3, card 16 (end) ---

export interface TrainingSupervisionQuery {
    org_id: string;
}

/**
 * POST /single-documents/:documentId/versions/:versionId/training-approval:
 * the approval of a pasante's version, bound to the bytes it had
 * (docs/training.md).
 */
export interface TrainingVersionApproval {
    document_version_id: string;
    content_sha256: string;
    approved_at: string;
}

/**
 * Interface language a user can choose (`uiLocale` in `GET`/`PATCH
 * /user/profile`, `locale` in `POST /auth/signup`). `null` in the profile
 * means automatic: the client negotiates from the browser or Word language
 * and falls back to `es-MX`.
 */
export type UiLocale = "en-US" | "es-MX";
