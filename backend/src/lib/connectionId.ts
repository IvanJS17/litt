// The id of the connection (MCP grant) a conversation or a message came from
// is never returned to a client. A row of `chats`, `chat_messages` or
// `tabular_review_chat_messages` leaves a read without it and keeps `origin`
// and `origin_label`, the app's name.

/** The row without `origin_grant_id`; the row passed in is not changed. */
export function withoutConnectionId<T extends object>(row: T): T {
    const { origin_grant_id: _connection, ...rest } = row as T & { origin_grant_id?: unknown };
    return rest as T;
}
