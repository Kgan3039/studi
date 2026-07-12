// functions/notification-validation.js — dependency-free helpers for the
// notification pipeline: payload validation/normalization, internal-route URL
// validation, and idempotent record-ID builders. Kept free of firebase-admin
// so tests/notification-validation.test.mjs can unit test every rule.
//
// The client mirrors the URL rules in lib/notifications.ts
// (isAllowedNotificationUrl) — change both together.

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
 *   /notifications
 *   /conversation/{id}   /session/{id}
 * where {id} must be a safe internal ID (see SAFE_ID_PATTERN). The segment is
 * also run through decodeURIComponent and must decode to itself, so
 * percent-encoded separators (%2F, %5C), traversal (`.`/`..`), external
 * schemes, and malformed escapes never pass.
 */
function isAllowedNotificationUrl(url) {
  if (typeof url !== "string") {
    return false;
  }

  if (url === "/notifications") {
    return true;
  }

  const match = /^\/(conversation|session)\/([^/]+)$/.exec(url);
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
  dmNotificationId,
  isAllowedNotificationUrl,
  isSafeId,
  normalizeNotificationPayload,
  reminderNotificationId,
  sanitizeIdPart,
  sessionEventNotificationId,
};
