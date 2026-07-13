// functions/index.js — firebase-functions v6 (2nd gen), Node 20.
// Replaces the previous v1-style functions/index.js in full.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { Expo } = require("expo-server-sdk");
const {
  blockPairIdsFor,
  dmNotificationId,
  filterBlockedRecipients,
  groupMessageNotificationId,
  normalizeNotificationPayload,
  reminderNotificationId,
  sessionEventNotificationId,
} = require("./notification-validation");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const db = admin.firestore();
const expo = new Expo();
const DELETE_ACCOUNT_MAX_AUTH_AGE_SECONDS = 5 * 60;
const DELETE_ACCOUNT_RATE_LIMIT_SECONDS = 10 * 60;

function isVerifiedUwCallable(request) {
  const token = request.auth?.token;
  return (
    !!request.auth?.uid &&
    token?.email_verified === true &&
    typeof token?.email === "string" &&
    token.email.toLowerCase().endsWith("@wisc.edu")
  );
}

function hashPushToken(expoPushToken) {
  return crypto.createHash("sha256").update(expoPushToken).digest("hex");
}

function pushTokenRef(uid, expoPushToken) {
  return db
    .collection("users")
    .doc(uid)
    .collection("private")
    .doc("pushTokens")
    .collection("tokens")
    .doc(hashPushToken(expoPushToken));
}

function normalizePreview(text, maxLength = 120) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function getDisplayName(uid) {
  if (!uid) return "";

  const snap = await db.collection("users").doc(uid).get();
  const displayName = snap.exists ? snap.data()?.displayName : "";
  return typeof displayName === "string" ? displayName.trim() : "";
}

async function getEnabledPushTokenDocs(uid) {
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("private")
    .doc("pushTokens")
    .collection("tokens")
    .where("enabled", "==", true)
    .get();

  return snap.docs
    .map((docSnap) => {
      const expoPushToken = docSnap.data()?.expoPushToken;
      return typeof expoPushToken === "string"
        ? { expoPushToken, ref: docSnap.ref }
        : null;
    })
    .filter(Boolean);
}

async function disablePushToken(ref) {
  try {
    await ref.set(
      {
        enabled: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.warn("Failed to disable push token", error);
  }
}

async function sendPushToUsers(userIds, payload) {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  const tokenDocs = (
    await Promise.all(uniqueUserIds.map((uid) => getEnabledPushTokenDocs(uid)))
  ).flat();

  const messages = [];
  const refs = [];

  for (const tokenDoc of tokenDocs) {
    if (!Expo.isExpoPushToken(tokenDoc.expoPushToken)) {
      await disablePushToken(tokenDoc.ref);
      continue;
    }

    messages.push({
      to: tokenDoc.expoPushToken,
      sound: "default",
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });
    refs.push(tokenDoc.ref);
  }

  const chunks = expo.chunkPushNotifications(messages);
  let offset = 0;

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, index) => {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          void disablePushToken(refs[offset + index]);
        }
      });
    } catch (error) {
      console.warn("Expo push send failed", error);
    } finally {
      offset += chunk.length;
    }
  }
}

// ---------------------------------------------------------------------------
// Notification pipeline (PR: notifications center). Every product event that
// reaches a user flows through notifyUser(): it writes the persistent in-app
// record first (the activity history — never suppressed by preferences), then
// sends a push only when the recipient's preference for that category is on.
// Record IDs come from the CloudEvent ID (see notification-validation.js), so
// a retried trigger delivery creates the record — and sends the push —
// exactly once, while every legitimate later event notifies again.
// ---------------------------------------------------------------------------

const NOTIFICATION_RETENTION_DAYS = 60;

// group_message / friend_request / friend_accepted are reserved for future
// PRs — mapped here so the pipeline needs no changes when they land.
const PREF_KEY_BY_NOTIFICATION_TYPE = {
  dm_message: "dmMessages",
  session_joined: "sessionActivity",
  session_updated: "sessionActivity",
  session_cancelled: "sessionActivity",
  session_reminder: "sessionReminders",
  group_message: "groupMessages",
  friend_request: "friendRequests",
  friend_accepted: "friendRequests",
};

// Missing settings doc, missing key, or an unreadable value all mean enabled —
// only an explicit `false` suppresses push (matches the client default).
async function isPushEnabled(uid, notificationType) {
  const prefKey = PREF_KEY_BY_NOTIFICATION_TYPE[notificationType];

  try {
    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("private")
      .doc("settings")
      .get();
    return snap.data()?.notificationPrefs?.[prefKey] !== false;
  } catch (error) {
    console.warn("Notification pref read failed; defaulting to enabled", error);
    return true;
  }
}

/**
 * Write the in-app notification record and (preference permitting) push it.
 *
 * `id` must be deterministic per logical event (built by the ID helpers in
 * notification-validation.js) — the record is written with create(), so a
 * retry that finds the record already present skips both the write and the
 * push. The payload passes through normalizeNotificationPayload(); anything
 * invalid is dropped entirely (no record, no push). Never throws: a failure
 * here must not roll back the app action that triggered it.
 */
async function notifyUser(uid, { id, ...rawPayload }) {
  if (!uid || uid === rawPayload.actorId || !id) {
    return;
  }

  const payload = normalizeNotificationPayload(rawPayload);
  if (!payload) {
    console.warn("Dropped invalid notification payload", { type: rawPayload?.type });
    return;
  }

  const ref = db.collection("users").doc(uid).collection("notifications").doc(id);

  try {
    await ref.create({
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      readAt: null,
      expiresAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
      ),
    });
  } catch (error) {
    if (error?.code === 6 /* ALREADY_EXISTS */) {
      return; // duplicate trigger delivery — record and push already handled
    }
    console.warn("Notification record write failed", error);
    return; // no record means no dedupe guard, so skip the push too
  }

  try {
    if (await isPushEnabled(uid, payload.type)) {
      await sendPushToUsers([uid], {
        title: payload.title,
        body: payload.body,
        data: { url: payload.url, type: payload.type },
      });
    }
  } catch (error) {
    console.warn("Notification push failed", error);
  }
}

// ---------------------------------------------------------------------------
// Location rating aggregates: locations/{id} gets ratingCount / ratingSum /
// tagCounts maintained transactionally on every rating create/update/delete.
// ---------------------------------------------------------------------------

exports.onRatingWritten = onDocumentWritten("locationRatings/{ratingId}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const locationId = (after ?? before)?.locationId;

  if (!locationId) return;

  const countDelta = (after ? 1 : 0) - (before ? 1 : 0);
  const sumDelta = (after?.stars ?? 0) - (before?.stars ?? 0);

  const tagDeltas = {};
  for (const tag of before?.tags ?? []) tagDeltas[tag] = (tagDeltas[tag] ?? 0) - 1;
  for (const tag of after?.tags ?? []) tagDeltas[tag] = (tagDeltas[tag] ?? 0) + 1;

  const locationRef = db.collection("locations").doc(locationId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(locationRef);
    if (!snap.exists) return;

    const data = snap.data();
    const tagCounts = { ...(data.tagCounts ?? {}) };

    for (const [tag, delta] of Object.entries(tagDeltas)) {
      const next = (tagCounts[tag] ?? 0) + delta;
      if (next > 0) tagCounts[tag] = next;
      else delete tagCounts[tag];
    }

    tx.update(locationRef, {
      ratingCount: Math.max(0, (data.ratingCount ?? 0) + countDelta),
      ratingSum: Math.max(0, (data.ratingSum ?? 0) + sumDelta),
      tagCounts,
    });
  });
});

// ---------------------------------------------------------------------------
// Push notification token registration. Tokens are private and are written
// only by Admin SDK callables, never directly by clients.
// ---------------------------------------------------------------------------

exports.registerPushToken = onCall(async (request) => {
  const uid = request.auth?.uid;

  if (!isVerifiedUwCallable(request)) {
    throw new HttpsError("unauthenticated", "Sign in with a verified UW account.");
  }

  const expoPushToken = request.data?.expoPushToken;
  const platform = request.data?.platform;
  const projectId = request.data?.projectId;

  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new HttpsError("invalid-argument", "Invalid Expo push token.");
  }

  if (!["ios", "android"].includes(platform)) {
    throw new HttpsError("invalid-argument", "Invalid push token platform.");
  }

  if (typeof projectId !== "string" || projectId.length < 1 || projectId.length > 120) {
    throw new HttpsError("invalid-argument", "Invalid Expo project id.");
  }

  const ref = pushTokenRef(uid, expoPushToken);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    tx.set(
      ref,
      {
        expoPushToken,
        platform,
        projectId,
        enabled: true,
        createdAt: snap.exists ? snap.data()?.createdAt ?? now : now,
        updatedAt: now,
        lastSeenAt: now,
      },
      { merge: true }
    );
  });

  return { status: "registered" };
});

exports.unregisterPushToken = onCall(async (request) => {
  const uid = request.auth?.uid;

  if (!isVerifiedUwCallable(request)) {
    throw new HttpsError("unauthenticated", "Sign in with a verified UW account.");
  }

  const expoPushToken = request.data?.expoPushToken;
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new HttpsError("invalid-argument", "Invalid Expo push token.");
  }

  await pushTokenRef(uid, expoPushToken).set(
    {
      expoPushToken,
      enabled: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { status: "unregistered" };
});

exports.onDirectMessageCreated = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const senderId = message?.senderId;
    const text = normalizePreview(message?.text);
    const conversationId = event.params.conversationId;

    if (!senderId || !conversationId || !text) {
      return;
    }

    const conversationSnap = await db.collection("conversations").doc(conversationId).get();
    if (!conversationSnap.exists) {
      return;
    }

    const participantIds = Array.isArray(conversationSnap.data()?.participantIds)
      ? conversationSnap.data().participantIds.filter((id) => typeof id === "string")
      : [];
    const recipients = participantIds.filter((uid) => uid !== senderId);

    if (recipients.length === 0) {
      return;
    }

    const senderName = await getDisplayName(senderId);
    await Promise.all(
      recipients.map((uid) =>
        notifyUser(uid, {
          // CloudEvent ID: stable across retries, unique per message event,
          // conversation-scoped against any cross-conversation collision.
          id: dmNotificationId(conversationId, event.id),
          type: "dm_message",
          title: senderName || "New message",
          body: text,
          url: `/conversation/${conversationId}`,
          actorId: senderId,
          conversationId,
        })
      )
    );
  }
);

exports.onSessionMessageCreated = onDocumentCreated(
  "sessions/{sessionId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const senderId = message?.senderId;
    const text = normalizePreview(message?.text);
    const sessionId = event.params.sessionId;

    if (!senderId || !sessionId || !text) {
      return;
    }

    const sessionSnap = await db.collection("sessions").doc(sessionId).get();
    if (!sessionSnap.exists) {
      return;
    }
    const session = sessionSnap.data();

    // Unread metadata for the session-details indicator: arrival time and
    // sender only, never content — the session doc is readable by every
    // verified user, so a text preview here would leak participant-only
    // messages. The write re-fires onSessionParticipantsUpdated, which
    // no-ops (no participant/status/time/location delta).
    try {
      await sessionSnap.ref.update({
        lastMessageAt:
          message.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
        lastMessageSenderId: senderId,
      });
    } catch (error) {
      console.warn("Session chat metadata update failed", error);
    }

    const participantIds = Array.isArray(session?.participantIds)
      ? session.participantIds.filter((id) => typeof id === "string")
      : [];
    const candidates = participantIds.filter((uid) => uid !== senderId);

    if (candidates.length === 0) {
      return;
    }

    // Server-side block filtering: a blocked pair (either direction) gets
    // neither the record nor the push — client bubble-hiding is a courtesy,
    // not the enforcement. One batched getAll over both block-doc directions
    // per recipient: 2 document reads per recipient per message, bounded by
    // session capacity (≤20 participants → ≤38 lookups in a single RPC).
    // A lookup failure throws so Eventarc retries the whole event; the
    // idempotent record IDs make that retry safe.
    const blockRefs = candidates.flatMap((uid) =>
      blockPairIdsFor(senderId, uid).map((id) => db.collection("userBlocks").doc(id))
    );
    const blockSnaps = await db.getAll(...blockRefs);
    const existingBlockIds = new Set(
      blockSnaps.filter((snap) => snap.exists).map((snap) => snap.id)
    );
    const recipients = filterBlockedRecipients(senderId, candidates, existingBlockIds);

    if (recipients.length === 0) {
      return;
    }

    // Display name comes from the sender's profile doc (server truth), never
    // from anything client-supplied on the message.
    const senderName = (await getDisplayName(senderId)) || "Someone";
    const title =
      typeof session?.title === "string" && session.title.trim()
        ? session.title.trim()
        : "Session chat";

    await Promise.all(
      recipients.map((uid) =>
        notifyUser(uid, {
          // CloudEvent ID: retries of one message event dedupe, every new
          // message notifies again. Session-scoped like the DM equivalent.
          id: groupMessageNotificationId(sessionId, event.id),
          type: "group_message",
          title,
          body: `${senderName}: ${text}`,
          url: `/session-chat/${sessionId}`,
          actorId: senderId,
          sessionId,
        })
      )
    );
  }
);

// Historical export name (originally join-only); renaming a deployed function
// forces a delete/create cycle, so the name stays while the trigger now covers
// joins, cancellation, and material time/location edits.
exports.onSessionParticipantsUpdated = onDocumentUpdated(
  "sessions/{sessionId}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const sessionId = event.params.sessionId;
    const hostId = after?.hostId;

    if (!hostId) {
      return;
    }

    const classId = typeof after?.classId === "string" ? after.classId : "your session";
    const sessionUrl = `/session/${sessionId}`;
    const title = typeof after?.title === "string" ? after.title : "Study session";

    const beforeParticipants = Array.isArray(before?.participantIds)
      ? before.participantIds.filter((id) => typeof id === "string")
      : [];
    const afterParticipants = Array.isArray(after?.participantIds)
      ? after.participantIds.filter((id) => typeof id === "string")
      : [];

    // 1. Joins → host only. Keyed on the event ID: a retried delivery
    //    dedupes, while a genuine leave-then-rejoin is a new event and
    //    notifies the host again.
    const joiners = afterParticipants.filter(
      (uid) => !beforeParticipants.includes(uid) && uid !== hostId
    );

    if (joiners.length > 0) {
      const displayName = (await getDisplayName(joiners[0])) || "Someone";
      await notifyUser(hostId, {
        id: sessionEventNotificationId("join", event.id),
        type: "session_joined",
        title: "New study partner",
        body: `${displayName} joined ${classId}`,
        url: sessionUrl,
        actorId: joiners[0],
        sessionId,
      });
    }

    // Cancellation and edits fan out to everyone seated except the host —
    // only the host can make these changes (rules isHostEdit), so the host
    // is always the actor.
    const audience = afterParticipants.filter((uid) => uid !== hostId);

    // 2. Cancellation → participants. Event-ID keyed: each real
    //    open→cancelled transition (including a cancel after a reopen) is its
    //    own event and notifies; retries of one transition dedupe.
    if (before?.status !== "cancelled" && after?.status === "cancelled") {
      await Promise.all(
        audience.map((uid) =>
          notifyUser(uid, {
            id: sessionEventNotificationId("cancel", event.id),
            type: "session_cancelled",
            title: "Session cancelled",
            body: `${title} (${classId}) was cancelled by the host.`,
            url: sessionUrl,
            actorId: hostId,
            sessionId,
          })
        )
      );
      return; // a cancel edit shouldn't also read as a reschedule
    }

    // 3. Material edits → participants. Only time and place count — joins,
    //    leaves, capacity, title, and status flips don't wake anyone up.
    //    Event-ID keyed: retries of one edit dedupe, and every distinct edit
    //    notifies — including reverting to a previously-used time/location.
    if (after?.status === "cancelled") {
      return;
    }

    const timeChanged =
      before?.startTime?.toMillis?.() !== after?.startTime?.toMillis?.() ||
      before?.endTime?.toMillis?.() !== after?.endTime?.toMillis?.();
    const locationChanged = before?.locationId !== after?.locationId;

    if (!timeChanged && !locationChanged) {
      return;
    }

    const changed =
      timeChanged && locationChanged ? "time and location" : timeChanged ? "time" : "location";

    await Promise.all(
      audience.map((uid) =>
        notifyUser(uid, {
          id: sessionEventNotificationId("update", event.id),
          type: "session_updated",
          title: "Session updated",
          body: `The ${changed} changed for ${title} (${classId}).`,
          url: sessionUrl,
          actorId: hostId,
          sessionId,
        })
      )
    );
  }
);

// ---------------------------------------------------------------------------
// Session reminders: one fixed reminder ~30 minutes before start, for the
// host and every participant. Runs every 10 minutes over the 20–30-minute
// band ahead, so consecutive runs tile the timeline without overlap and each
// start time is examined by exactly one run. Record IDs are keyed on
// sessionId + uid + the exact startTime occurrence — a scheduler retry of the
// same run dedupes, while a rescheduled session (new startTime) legitimately
// reminds again. Cancelled sessions are filtered by status; started/ended
// ones by the window itself.
//
// Beta trade-off (documented in docs/push-notifications.md): a session
// created less than ~20 minutes before its own start never enters the band
// and gets no reminder.
//
// Requires (deploy-time, documented in docs/push-notifications.md):
//  - Blaze plan + Cloud Scheduler API (auto-provisioned by v2 onSchedule).
//  - Composite index sessions(status ASC, startTime ASC) — in firestore.indexes.json.
// ---------------------------------------------------------------------------

const REMINDER_WINDOW_START_MINUTES = 20;
const REMINDER_WINDOW_END_MINUTES = 30;

exports.sendSessionReminders = onSchedule("every 10 minutes", async () => {
  const now = admin.firestore.Timestamp.now();
  const windowStart = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + REMINDER_WINDOW_START_MINUTES * 60 * 1000
  );
  const windowEnd = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + REMINDER_WINDOW_END_MINUTES * 60 * 1000
  );

  const snap = await db
    .collection("sessions")
    .where("status", "in", ["open", "full"])
    .where("startTime", ">", windowStart)
    .where("startTime", "<=", windowEnd)
    .get();

  for (const docSnap of snap.docs) {
    const session = docSnap.data();
    const participantIds = Array.isArray(session.participantIds)
      ? session.participantIds.filter((id) => typeof id === "string")
      : [];

    if (participantIds.length === 0) {
      continue;
    }

    const minutesLeft = Math.max(
      1,
      Math.round((session.startTime.toMillis() - now.toMillis()) / 60000)
    );
    const title = typeof session.title === "string" ? session.title : "Study session";
    const classId = typeof session.classId === "string" ? ` (${session.classId})` : "";

    await Promise.all(
      participantIds.map((uid) =>
        notifyUser(uid, {
          id: reminderNotificationId(docSnap.id, uid, session.startTime.toMillis()),
          type: "session_reminder",
          title: "Starting soon",
          body: `${title}${classId} starts in about ${minutesLeft} min.`,
          url: `/session/${docSnap.id}`,
          sessionId: docSnap.id,
        })
      )
    );
  }
});

// ---------------------------------------------------------------------------
// Account deletion (D8): single authoritative path. Admin SDK bypasses rules,
// so client-side cleanup write-paths no longer exist in the rules at all.
// Reports are intentionally retained (moderation evidence).
//
// Bounded + resumable: the account is disabled (and refresh tokens revoked)
// BEFORE any data is touched, every cleanup step drains a query in fixed-size
// pages whose handler removes the docs from the query's own result set, and
// re-invoking the callable on an already-disabled account skips the
// freshness/rate-limit gates and resumes the idempotent cleanup where it
// stopped. Worst case a run is cut off repeatedly: the user is locked out
// (existing sessions die at ID-token expiry, ≤1 h) and residual data is
// orphaned-but-inaccessible until a retry or ops re-run finishes the job.
// ---------------------------------------------------------------------------

const DELETE_CLEANUP_PAGE_SIZE = 100;

// Runs `handler` over fixed-size pages of `q` until the query is empty. Every
// handler MUST remove its docs from the query's result set (delete the doc or
// mutate the queried field) so each pass strictly shrinks the remainder — that
// is what makes an interrupted run resume instead of loop.
async function drainQuery(q, handler) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await q.limit(DELETE_CLEANUP_PAGE_SIZE).get();
    if (snap.empty) return;
    await handler(snap.docs);
  }
}

async function deleteQueryBatch(q) {
  await drainQuery(q, async (docs) => {
    const batch = db.batch();
    docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  });
}

async function enforceDeleteAccountRateLimit(uid) {
  const ref = db.collection("rateLimits").doc(uid).collection("actions").doc("deleteAccount");
  const now = admin.firestore.Timestamp.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.data()?.updatedAt : null;

    if (
      previous?.toMillis &&
      now.toMillis() - previous.toMillis() < DELETE_ACCOUNT_RATE_LIMIT_SECONDS * 1000
    ) {
      throw new HttpsError(
        "resource-exhausted",
        "Please wait a few minutes before trying to delete your account again."
      );
    }

    tx.set(ref, { updatedAt: now }, { merge: true });
  });
}

exports.deleteUserAccount = onCall({ timeoutSeconds: 540 }, async (request) => {
  const uid = request.auth?.uid;
  const authTime = request.auth?.token?.auth_time;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to delete your account.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().getUser(uid);
  } catch {
    // Auth user already gone means a previous run completed everything
    // (deleteUser is the final step below).
    throw new HttpsError("failed-precondition", "This account no longer exists.");
  }

  // Resume path: a previous run disabled the account but was cut off before
  // cleanup finished. The user cannot re-authenticate a disabled account, so
  // the freshness and rate-limit gates are skipped — the destructive intent
  // was already proven, and everything below is idempotent.
  const isResume = userRecord.disabled === true;

  if (!isResume) {
    if (
      typeof authTime !== "number" ||
      Date.now() / 1000 - authTime > DELETE_ACCOUNT_MAX_AUTH_AGE_SECONDS
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Please sign in again before deleting your account."
      );
    }

    await enforceDeleteAccountRateLimit(uid);

    // Lock the account BEFORE touching any data: even if this run is cut off
    // mid-cleanup, no new sign-in is possible and revoked refresh tokens cap
    // existing sessions at ID-token expiry (≤1 h). The still-valid ID token
    // lets the client retry this callable to resume.
    await admin.auth().updateUser(uid, { disabled: true });
    await admin.auth().revokeRefreshTokens(uid);
  }

  // 1. Sessions hosted by the user: delete outright, including the group-chat
  //    messages subcollection — a flat batch delete would orphan it.
  await drainQuery(db.collection("sessions").where("hostId", "==", uid), async (docs) => {
    for (const docSnap of docs) {
      await db.recursiveDelete(docSnap.ref);
    }
  });

  // 2. Sessions joined: remove from participant arrays (arrayRemove is
  //    idempotent and takes the doc out of this query's results).
  await drainQuery(
    db.collection("sessions").where("participantIds", "array-contains", uid),
    async (docs) => {
      const batch = db.batch();
      docs.forEach((docSnap) =>
        batch.update(docSnap.ref, {
          participantIds: admin.firestore.FieldValue.arrayRemove(uid),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      );
      await batch.commit();
    }
  );

  // 3. Conversations: delete the thread and its messages (the counterpart
  //    loses the thread too — acceptable for a 1:1 DM model and required to
  //    avoid orphaned PII; messages contain the deleted user's words).
  await drainQuery(
    db.collection("conversations").where("participantIds", "array-contains", uid),
    async (docs) => {
      for (const convo of docs) {
        await db.recursiveDelete(convo.ref);
      }
    }
  );

  // 3b. Group-chat messages the user sent in sessions they didn't host —
  //     collection-group lookup on senderId (COLLECTION_GROUP index in
  //     firestore.indexes.json fieldOverrides). Messages under the user's own
  //     hosted sessions and DM conversations are already gone (steps 1 and 3).
  await deleteQueryBatch(db.collectionGroup("messages").where("senderId", "==", uid));

  // 4. Blocks in either direction.
  await deleteQueryBatch(db.collection("userBlocks").where("blockerUserId", "==", uid));
  await deleteQueryBatch(db.collection("userBlocks").where("blockedUserId", "==", uid));

  // 5. Location ratings (the aggregate trigger above decrements counts).
  await deleteQueryBatch(db.collection("locationRatings").where("userId", "==", uid));

  // 6. Profile (public doc + private, notifications, and reads subcollections
  //    — the notification records double as reminder/dedupe state, so nothing
  //    else to clean), then the Auth user — last, so a lost run can always
  //    resume through the disabled-account path above.
  await db.recursiveDelete(db.collection("users").doc(uid));
  await admin.auth().deleteUser(uid);

  return { status: "deleted" };
});
