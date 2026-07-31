# Messages history

The Messages tab combines direct conversations with session chats that have at
least one message. Session rows come from one bounded query over sessions where
the current user is a participant, ordered by `lastMessageAt` and limited to the
50 most recently active chats. Sessions without `lastMessageAt` are not shown.

Removing a row writes an owner-only marker at
`users/{uid}/hiddenChats/group__{sessionId}`. The marker hides the session-chat row only
for that user and does not change the shared conversation, session membership,
messages, notifications, or another participant's inbox. The marker is sticky:
new messages do not silently undo an explicit removal. Direct-message rows do
not use hidden markers and retain their existing behavior.

The rules allow an owner to delete their marker as the restore operation, but
the beta UI does not expose restore or a hidden-chat management screen. That UI
can be added later without changing shared chat data. Existing recursive account
deletion removes the user's hidden markers with the rest of the user tree.

There is no timer-based chat lifecycle, retention window, keep action, migration,
or scheduled cleanup in this beta scope.
