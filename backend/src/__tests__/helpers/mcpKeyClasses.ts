// Which kind of key each tool of the MCP server can spend. One entry per
// registered tool: a tool added to the server must be placed here, so that
// someone decides which class it belongs to (see mcp.defaultKey.test.ts).
//
//   default-key         LiTT's own model runs the work on a credential reference the
//                       service pins; a new conversation or run gets it from
//                       `defaultKeyFor` (mcp.defaultKey.ts).
//   key-bag             LiTT's own model runs the work through the web's key bag
//                       (`prepareTabularGenerate`), which already prefers the firm's key.
//   pinned-key          the tool continues a conversation whose key is already fixed
//                       and never asks for a default.
//   third-party-key     a saved key of a service that is not a model (LandingAI).
//   no-litt-key         no key is spent: the connected app's own model does the thinking,
//                       or LiTT only reads and writes data.

export type KeyClass = "default-key" | "key-bag" | "pinned-key" | "third-party-key" | "no-litt-key";

const classes = {
    // run_workflow: its tabular branch uses the workspace's key bag, its assistant branch takes the default key.
    "default-key": ["start_chat", "start_project_chat", "send_tabular_chat_message", "run_workflow", "run_quick_action", "run_playbook_review"],
    "key-bag": ["run_tabular_review"],
    "pinned-key": ["send_chat_message", "send_project_chat_message"],
    "third-party-key": ["read_scanned_document", "propose_case_file_split"],
    "no-litt-key": [
        "whoami", "list_workspaces", "find_matters", "get_matter", "create_matter", "list_matter_documents", "search_documents",
        "read_document", "list_document_versions", "create_note_document", "request_document_upload", "complete_document_upload",
        "get_upload_status", "find_playbooks", "get_playbook", "get_playbook_run", "list_playbook_runs", "prepare_playbook_review",
        "submit_playbook_review", "list_tabular_reviews", "create_tabular_review", "get_tabular_review", "read_tabular_cells",
        "get_tabular_run_status", "stop_tabular_run", "get_chat_turn", "stop_chat_turn", "list_chats", "get_chat", "list_tabular_chats",
        "get_tabular_chat_turn", "stop_tabular_chat_turn", "get_firm_profile", "list_retainer_requests", "get_client_profile",
        "get_deadline_radar", "get_retainer_report", "list_workflows", "get_workflow", "list_quick_actions", "compare_documents",
        "preview_document_conversion", "convert_document", "get_scan_reading_state", "get_case_file_split_state", "create_split_documents",
    ],
} as const satisfies Record<KeyClass, readonly string[]>;

/** Every entry of the table with its class; a name listed under two classes shows twice. */
export const KEY_CLASS_ENTRIES: readonly (readonly [string, KeyClass])[] = (Object.entries(classes) as [KeyClass, readonly string[]][]).flatMap(
    ([keyClass, names]) => names.map((name) => [name, keyClass] as const),
);

export const KEY_CLASS_TABLE: ReadonlyMap<string, KeyClass> = new Map(KEY_CLASS_ENTRIES);

export const toolsOfClass = (keyClass: KeyClass): string[] => [...classes[keyClass]];
