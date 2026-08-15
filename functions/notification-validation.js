// functions/notification-validation.js — dependency-free helpers for the
// notification pipeline: payload validation/normalization, internal-route URL
// validation, and idempotent record-ID builders. Kept free of firebase-admin
// so tests/notification-validation.test.mjs can unit test every rule.
//
// The client mirrors the URL rules in lib/notifications.ts
// (isAllowedNotificationUrl) — change both together.

const { directedPairId, sortedPairId } = require("./pair-id");

const NOTIFICATION_TYPES = new Set([
  "dm_message",
  "session_joined",
  "session_updated",
  "session_cancelled",
  "session_reminder",
  "group_message",
  "friend_request",
  "friend_accepted",
]);

const TITLE_MAX_LENGTH = 120;
const BODY_MAX_LENGTH = 300;

// Firestore auto-IDs, Firebase uids, and `${uidA}__${uidB}` conversation keys
// all fit this. Anything else (dots, slashes, percent-escapes, backslashes,
// empty) is rejected outright rather than sanitized.
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

function isSafeId(value) {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

/**
 * Strict allowlist for notification navigation targets. Valid forms:
 *   /notifications   /friends
 *   /conversation/{id}   /session/{id}   /session-chat/{id}   /user/{id}
 * where {id} must be a safe internal ID (see SAFE_ID_PATTERN). The segment is
 * also run through decodeURIComponent and must decode to itself, so
 * percent-encoded separators (%2F, %5C), traversal (`.`/`..`), external
 * schemes, and malformed escapes never pass.
 */
function isAllowedNotificationUrl(url) {
  if (typeof url !== "string") {
    return false;
  }

  if (url === "/notifications" || url === "/friends") {
    return true;
  }

  const match = /^\/(conversation|session|session-chat|user)\/([^/]+)$/.exec(url);
  if (!match) {
    return false;
  }

  const segment = match[2];
  if (!isSafeId(segment)) {
    return false;
  }

  try {
    return decodeURIComponent(segment) === segment;
  } catch {
    return false; // malformed escape sequence
  }
}

/**
 * Validate and normalize a notification payload before it is written or
 * pushed. Returns the normalized payload, or null when anything is off —
 * callers must treat null as "no record, no push".
 */
function normalizeNotificationPayload(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const { type, title, body, url, actorId, sessionId, conversationId } = input;

  if (!NOTIFICATION_TYPES.has(type)) {
    return null;
  }

  const trimmedTitle = typeof title === "string" ? title.trim() : "";
  const trimmedBody = typeof body === "string" ? body.trim() : "";
  if (!trimmedTitle || !trimmedBody) {
    return null;
  }

  if (!isAllowedNotificationUrl(url)) {
    return null;
  }

  for (const optionalId of [actorId, sessionId, conversationId]) {
    if (optionalId !== undefined && !isSafeId(optionalId)) {
      return null;
    }
  }

  return {
    type,
    title: trimmedTitle.slice(0, TITLE_MAX_LENGTH),
    body: trimmedBody.slice(0, BODY_MAX_LENGTH),
    url,
    ...(actorId !== undefined ? { actorId } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(conversationId !== undefined ? { conversationId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Idempotent record IDs. Trigger-driven notifications key on the CloudEvent
// ID: Eventarc reuses it across retries of one delivery (dedupe) and mints a
// new one for every legitimate later event — so leave/rejoin, cancel/reopen/
// re-cancel, and reverting a session back to a prior time/location all
// notify again, while retries never double-write or double-push. No state
// hashing: identical-looking state from distinct events must still notify.
// ---------------------------------------------------------------------------

// Doc IDs must avoid `/` and the reserved `.`/`..` forms; event IDs are
// opaque, so normalize any unexpected character instead of trusting them.
function sanitizeIdPart(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Retries of one message event dedupe; conversation scoping prevents any cross-conversation collision. */
function dmNotificationId(conversationId, eventId) {
  return `dm_${sanitizeIdPart(conversationId)}_${sanitizeIdPart(eventId)}`;
}

/** kind: join | cancel | update — one record per trigger event. */
function sessionEventNotificationId(kind, eventId) {
  return `${kind}_${sanitizeIdPart(eventId)}`;
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value && typeof value.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1e6);
  }

  return value;
}

/** Returns the attendee-visible session fields changed by one host update. */
function getSessionChangedFields(before = {}, after = {}) {
  const scheduleChanged =
    timestampMillis(before.startTime) !== timestampMillis(after.startTime) ||
    timestampMillis(before.endTime) !== timestampMillis(after.endTime);
  const changed = [];

  if (before.classId !== after.classId) changed.push("class");
  if (scheduleChanged) changed.push("date/time");
  if (before.locationId !== after.locationId) changed.push("location");
  if (before.capacity !== after.capacity) changed.push("capacity");
  if (before.title !== after.title) changed.push("title");

  return changed;
}

function formatSessionChangedFields(changedFields) {
  if (changedFields.length === 1) {
    return changedFields[0];
  }

  return `${changedFields.slice(0, -1).join(", ")} and ${changedFields.at(-1)}`;
}

/** Retries of one group-chat message event dedupe; session scoping mirrors dmNotificationId. */
function groupMessageNotificationId(sessionId, eventId) {
  return `gm_${sanitizeIdPart(sessionId)}_${sanitizeIdPart(eventId)}`;
}

/** One record per friend-request create event; retries of that event dedupe. */
function friendRequestNotificationId(eventId) {
  return `fr_${sanitizeIdPart(eventId)}`;
}

/** One record per friendship create (accept) event; retries dedupe. */
function friendAcceptedNotificationId(eventId) {
  return `fa_${sanitizeIdPart(eventId)}`;
}

// ---------------------------------------------------------------------------
// Friend cleanup on block. Creating a block must sever the pair server-side:
// both pending request directions and the friendship, all at deterministic
// IDs — three targeted deletes, no queries. Pure so tests can pin the exact
// paths the onUserBlockCreated trigger deletes.
// ---------------------------------------------------------------------------

/**
 * Doc paths (collection/docId) removed when userA and userB become blocked:
 * friendRequests in both directions plus the sorted-pair friendship. IDs come
 * from the shared pair-id helpers so client, Functions, and rules agree.
 */
function friendCleanupPathsForBlock(blockerUserId, blockedUserId) {
  return [
    { collection: "friendRequests", id: directedPairId(blockerUserId, blockedUserId) },
    { collection: "friendRequests", id: directedPairId(blockedUserId, blockerUserId) },
    { collection: "friendships", id: sortedPairId(blockerUserId, blockedUserId) },
  ];
}

// Group-chat fanout ceiling. New sessions are capacity-capped at 20 already,
// but legacy sessions have no capacity field and unbounded participantIds —
// the ceiling is judged on the ACTUAL participant count, never on capacity.
// firestore.rules (messages create) and lib/firestore.ts
// (MAX_GROUP_CHAT_PARTICIPANTS) hardcode the same 20 — change all three
// together. Bounds the per-message block lookups at 38 doc reads (20
// participants, sender excluded → 19 recipients × 2 directions).
const MAX_GROUP_CHAT_PARTICIPANTS = 20;

function isWithinGroupChatFanoutLimit(participantCount) {
  return (
    Number.isInteger(participantCount) && participantCount <= MAX_GROUP_CHAT_PARTICIPANTS
  );
}

// ---------------------------------------------------------------------------
// Server-side block filtering for group-message notifications. Blocked
// recipients (either direction) are removed BEFORE notifyUser() is ever
// called, so neither the persistent record nor the push exists for them —
// and because the filter runs upstream of any preference check, no
// notificationPrefs setting can resurrect a blocked notification. The chat
// message itself stays stored for the remaining participants.
// ---------------------------------------------------------------------------

/** Both directions of the deterministic userBlocks/{blocker}__{blocked} doc ID. */
function blockPairIdsFor(senderId, recipientId) {
  return [
    directedPairId(senderId, recipientId),
    directedPairId(recipientId, senderId),
  ];
}

/**
 * Drops every recipient with a block in either direction against the sender.
 * `existingBlockIds` is the set of userBlocks doc IDs that actually exist
 * (the caller looks them up in one batched getAll — 2 lookups per recipient,
 * bounded by session capacity).
 */
function filterBlockedRecipients(senderId, recipients, existingBlockIds) {
  return recipients.filter(
    (uid) => !blockPairIdsFor(senderId, uid).some((id) => existingBlockIds.has(id))
  );
}

/**
 * One reminder per recipient per session *start occurrence* — rescheduling a
 * session changes startTimeMillis, so the new occurrence reminds again. The
 * uid is redundant with the subcollection path but kept in the key so the
 * dedupe guarantee is self-describing.
 */
function reminderNotificationId(sessionId, uid, startTimeMillis) {
  return `reminder_${sanitizeIdPart(sessionId)}_${sanitizeIdPart(uid)}_${startTimeMillis}`;
}

module.exports = {
  BODY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  MAX_GROUP_CHAT_PARTICIPANTS,
  blockPairIdsFor,
  dmNotificationId,
  filterBlockedRecipients,
  friendAcceptedNotificationId,
  friendCleanupPathsForBlock,
  friendRequestNotificationId,
  formatSessionChangedFields,
  getSessionChangedFields,
  groupMessageNotificationId,
  isAllowedNotificationUrl,
  isSafeId,
  isWithinGroupChatFanoutLimit,
  normalizeNotificationPayload,
  reminderNotificationId,
  sanitizeIdPart,
  sessionEventNotificationId,
};
