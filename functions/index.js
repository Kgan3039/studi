// functions/index.js — firebase-functions v7 (2nd gen), Node 22.
// Replaces the previous v1-style functions/index.js in full.

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const crypto = require("crypto");
const { Expo } = require("expo-server-sdk");
const { loadPushPreference } = require("./notification-preferences");
const {
  deriveDirectMessageMetadata,
  deriveDirectMessageUpdateMetadata,
} = require("./direct-message-metadata");
const {
  blockPairIdsFor,
  dmNotificationId,
  filterBlockedRecipients,
  friendAcceptedNotificationId,
  friendCleanupPathsForBlock,
  friendRequestNotificationId,
  formatSessionChangedFields,
  getSessionChangedFields,
  groupMessageNotificationId,
  isWithinGroupChatFanoutLimit,
  normalizeNotificationPayload,
  reminderNotificationId,
  sessionEventNotificationId,
} = require("./notification-validation");
const {
  classifyDeletionRequest,
  createAccountDeletionRunner,
} = require("./account-deletion");
const {
  buildFriendSuggestions,
  CANDIDATE_SCAN_LIMIT,
  isCandidateExcludedByExistence,
  relationshipDocRefsForCandidate,
} = require("./friend-suggestions");
const {
  PushTokenOwnershipConflictError,
  SAFE_OPERATION_ID_PATTERN,
  claimPushTokenOwnership,
  isValidOptionalClientGeneration,
  releasePushTokenOwnership,
} = require("./push-token-ownership");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const db = getFirestore();
const auth = getAuth();
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

function pushTokenOwnerRef(expoPushToken) {
  return db.collection("pushTokenOwners").doc(hashPushToken(expoPushToken));
}

function pushTokenInstallationRef(installationId) {
  return db.collection("pushTokenInstallations").doc(hashPushToken(installationId));
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
        updatedAt: FieldValue.serverTimestamp(),
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

// Missing settings doc/key means enabled. A real read failure is different:
// fail closed for push because the user may have opted out. The persistent
// in-app record is created before this check and remains available.
async function isPushEnabled(uid, notificationType) {
  return loadPushPreference({
    notificationType,
    readSettings: async () => {
      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("private")
        .doc("settings")
        .get();
      return snap.exists ? snap.data() : undefined;
    },
    onReadError: (error) => {
      console.warn("Notification pref read failed; suppressing push", {
        code: typeof error?.code === "string" ? error.code : "unknown",
      });
    },
  });
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
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      expiresAt: Timestamp.fromMillis(
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

  // Keep expoPushToken as a legacy input alias while the updated client rolls out.
  const expoPushToken = request.data?.token ?? request.data?.expoPushToken;
  const previousExpoPushToken = request.data?.previousToken;
  const providedInstallationId = request.data?.installationId;
  const providedRegistrationId = request.data?.registrationId;
  const providedGeneration = request.data?.generation;
  const platform = request.data?.platform;
  const projectId = request.data?.projectId;

  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new HttpsError("invalid-argument", "Invalid Expo push token.");
  }
  if (
    previousExpoPushToken !== undefined &&
    !Expo.isExpoPushToken(previousExpoPushToken)
  ) {
    throw new HttpsError("invalid-argument", "Invalid previous Expo push token.");
  }

  if (!["ios", "android"].includes(platform)) {
    throw new HttpsError("invalid-argument", "Invalid push token platform.");
  }

  if (typeof projectId !== "string" || projectId.length < 1 || projectId.length > 120) {
    throw new HttpsError("invalid-argument", "Invalid Expo project id.");
  }

  const tokenHash = hashPushToken(expoPushToken);
  const previousTokenHash = previousExpoPushToken
    ? hashPushToken(previousExpoPushToken)
    : null;
  const installationId = providedInstallationId ?? `legacy_${tokenHash}`;
  const registrationId = providedRegistrationId ?? `legacy_${tokenHash}`;
  if (
    !SAFE_OPERATION_ID_PATTERN.test(installationId) ||
    !SAFE_OPERATION_ID_PATTERN.test(registrationId) ||
    ((providedInstallationId === undefined) !== (providedRegistrationId === undefined))
    || !isValidOptionalClientGeneration(providedGeneration)
  ) {
    throw new HttpsError("invalid-argument", "Invalid push registration identity.");
  }
  const now = FieldValue.serverTimestamp();

  try {
    const result = await claimPushTokenOwnership({
      db,
      uid,
      expoPushToken,
      previousExpoPushToken,
      platform,
      projectId,
      installationId,
      registrationId,
      tokenHash,
      previousTokenHash,
      tokenRef: pushTokenRef(uid, expoPushToken),
      ownerRef: pushTokenOwnerRef(expoPushToken),
      installationRef: pushTokenInstallationRef(installationId),
      installationRefFor: pushTokenInstallationRef,
      previousTokenRef: previousExpoPushToken
        ? pushTokenRef(uid, previousExpoPushToken)
        : null,
      previousOwnerRef: previousExpoPushToken
        ? pushTokenOwnerRef(previousExpoPushToken)
        : null,
      deletionJobRef: db.collection("accountDeletionJobs").doc(uid),
      now,
    });
    return { status: "registered", generation: result.generation };
  } catch (error) {
    if (error instanceof PushTokenOwnershipConflictError) {
      console.error("Push token ownership conflict", {
        code: error.code,
        tokenHash,
        documentPaths: error.details?.documentPaths ?? [],
      });
      throw new HttpsError("failed-precondition", "Push token ownership could not be updated.");
    }
    throw error;
  }

});

exports.unregisterPushToken = onCall(async (request) => {
  const uid = request.auth?.uid;

  if (!isVerifiedUwCallable(request)) {
    throw new HttpsError("unauthenticated", "Sign in with a verified UW account.");
  }

  const expoPushToken = request.data?.token ?? request.data?.expoPushToken;
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new HttpsError("invalid-argument", "Invalid Expo push token.");
  }

  const tokenHash = hashPushToken(expoPushToken);
  const providedInstallationId = request.data?.installationId;
  const providedRegistrationId = request.data?.registrationId;
  const providedGeneration = request.data?.generation;
  const installationId = providedInstallationId ?? `legacy_${tokenHash}`;
  const registrationId = providedRegistrationId ?? `legacy_${tokenHash}`;
  const generation = providedGeneration ?? 1;
  if (
    !SAFE_OPERATION_ID_PATTERN.test(installationId) ||
    !SAFE_OPERATION_ID_PATTERN.test(registrationId) ||
    ((providedInstallationId === undefined) !== (providedRegistrationId === undefined))
    || !Number.isSafeInteger(generation) || generation < 1
  ) {
    throw new HttpsError("invalid-argument", "Invalid push registration identity.");
  }
  const now = FieldValue.serverTimestamp();

  const removed = await releasePushTokenOwnership({
    db,
    uid,
    expoPushToken,
    installationId,
    registrationId,
    generation,
    tokenHash,
    tokenRef: pushTokenRef(uid, expoPushToken),
    ownerRef: pushTokenOwnerRef(expoPushToken),
    installationRef: pushTokenInstallationRef(installationId),
    now,
  });

  return { status: removed ? "unregistered" : "stale", removed };
});

exports.onDirectMessageCreated = onDocumentCreated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    const senderId = message?.senderId;
    const rawText = typeof message?.text === "string" ? message.text.trim() : "";
    const text = normalizePreview(rawText);
    const conversationId = event.params.conversationId;
    const messageId = event.params.messageId;

    if (
      !senderId
      || !conversationId
      || !messageId
      || !text
      || typeof message?.createdAt?.toMillis !== "function"
    ) {
      return;
    }

    const conversationRef = db.collection("conversations").doc(conversationId);
    const currentState = await db.runTransaction(async (transaction) => {
      const conversationSnap = await transaction.get(conversationRef);
      if (!conversationSnap.exists) {
        return { notificationText: "", participantIds: [] };
      }
      // Re-read current state so a fast edit/unsend that races this create
      // trigger wins, regardless of Eventarc delivery order.
      const currentMessageSnap = await transaction.get(event.data.ref);
      if (!currentMessageSnap.exists) {
        return { notificationText: "", participantIds: [] };
      }
      const currentMessage = currentMessageSnap.data();
      const data = conversationSnap.data();
      const participants = Array.isArray(data?.participantIds)
        ? data.participantIds.filter((id) => typeof id === "string")
        : [];
      if (!participants.includes(senderId) || currentMessage?.senderId !== senderId) {
        return { notificationText: "", participantIds: [] };
      }
      const metadata = deriveDirectMessageMetadata(
        currentMessage,
        messageId,
        data?.lastMessageAt,
        data?.lastMessageId
      );
      if (!metadata) {
        return {
          notificationText: currentMessage?.unsentAt
            ? ""
            : normalizePreview(currentMessage?.text),
          participantIds: participants,
        };
      }
      transaction.update(conversationRef, metadata);
      return {
        notificationText: currentMessage?.unsentAt
          ? ""
          : normalizePreview(currentMessage?.text),
        participantIds: participants,
      };
    });
    const recipients = currentState.participantIds.filter((uid) => uid !== senderId);

    if (recipients.length === 0 || !currentState.notificationText) {
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
          body: currentState.notificationText,
          url: `/conversation/${conversationId}`,
          actorId: senderId,
          conversationId,
        })
      )
    );
  }
);

// Editing or unsending the newest DM updates only its inbox preview. It never
// changes ordering and never fans out another notification.
exports.onDirectMessageUpdated = onDocumentUpdated(
  "conversations/{conversationId}/messages/{messageId}",
  async (event) => {
    const conversationId = event.params.conversationId;
    const messageId = event.params.messageId;

    if (!event.data || !conversationId || !messageId) {
      return;
    }

    const conversationRef = db.collection("conversations").doc(conversationId);
    await db.runTransaction(async (transaction) => {
      const conversationSnap = await transaction.get(conversationRef);
      if (!conversationSnap.exists) {
        return;
      }
      // Every update event re-derives from the current document, not its event
      // snapshot. Retries and out-of-order edit/unsend events therefore cannot
      // restore stale or already-unsent content to the inbox preview.
      const currentMessageSnap = await transaction.get(event.data.after.ref);
      if (!currentMessageSnap.exists) {
        return;
      }

      const metadata = deriveDirectMessageUpdateMetadata(
        currentMessageSnap.data(),
        messageId,
        conversationSnap.data()?.lastMessageId
      );
      if (metadata) {
        transaction.update(conversationRef, metadata);
      }
    });
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
    // A quick edit/unsend may land before this create trigger runs. Use the
    // current document for metadata and notification content so an already-
    // completed unsend does not cause a delayed push containing removed text.
    const currentMessageSnap = await event.data.ref.get();
    if (!currentMessageSnap.exists) {
      return;
    }
    const currentMessage = currentMessageSnap.data();
    const currentText = normalizePreview(currentMessage?.text);
    if (currentMessage?.senderId !== senderId) {
      return;
    }

    const participantIds = Array.isArray(session?.participantIds)
      ? session.participantIds.filter((id) => typeof id === "string")
      : [];

    // Fanout ceiling (shared with firestore.rules and the client): oversized
    // legacy sessions get no metadata bump and no notifications. The rules
    // deny new sends there, so this only fires on a race or an Admin write —
    // and silently notifying a subset would be worse than notifying nobody.
    // This also structurally bounds the block lookups below at ≤38 reads.
    if (!isWithinGroupChatFanoutLimit(participantIds.length)) {
      return;
    }

    // Unread metadata for the session-details indicator: arrival time and
    // sender only, never content — the session doc is readable by every
    // verified user, so a text preview here would leak participant-only
    // messages. The write re-fires onSessionParticipantsUpdated, which
    // no-ops (no participant/status/time/location delta).
    try {
      await sessionSnap.ref.update({
        lastMessageAt:
          currentMessage.createdAt ?? FieldValue.serverTimestamp(),
        lastMessageSenderId: senderId,
      });
    } catch (error) {
      console.warn("Session chat metadata update failed", error);
    }

    if (currentMessage.unsentAt || !currentText) {
      return;
    }

    const candidates = participantIds.filter((uid) => uid !== senderId);

    if (candidates.length === 0) {
      return;
    }

    // Server-side block filtering: a blocked pair (either direction) gets
    // neither the record nor the push — client bubble-hiding is a courtesy,
    // not the enforcement. One batched getAll over both block-doc directions
    // per recipient: 2 document reads per recipient per message, bounded by
    // the fanout ceiling above (20 participants incl. sender → 19 recipients
    // → at most 38 lookups in a single RPC). A lookup failure throws so
    // Eventarc retries the whole event; the idempotent record IDs make that
    // retry safe.
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
          body: `${senderName}: ${currentText}`,
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

    // 3. Material edits → participants. Class, schedule, place, capacity, and
    //    title changes are attendee-visible; joins, leaves, and status flips
    //    don't wake everyone up.
    //    Event-ID keyed: retries of one edit dedupe, and every distinct edit
    //    notifies — including reverting to a previously-used time/location.
    if (after?.status === "cancelled") {
      return;
    }

    const changedFields = getSessionChangedFields(before, after);

    if (changedFields.length === 0) {
      return;
    }

    const changed = formatSessionChangedFields(changedFields);

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
// Friends / Study Buddies (PR 6). Two notification triggers and one cleanup
// trigger. Both notification triggers re-check the block relationship at fire
// time (Admin SDK read of both userBlocks directions) so a block that lands
// between the client write and the trigger still suppresses the record and
// the push — the notification pipeline's block guarantee, matching group chat.
// ---------------------------------------------------------------------------

/** True if either direction of the block exists — one batched getAll. */
async function isPairBlocked(userA, userB) {
  const refs = blockPairIdsFor(userA, userB).map((id) =>
    db.collection("userBlocks").doc(id)
  );
  const snaps = await db.getAll(...refs);
  return snaps.some((snap) => snap.exists);
}

exports.onFriendRequestCreated = onDocumentCreated(
  "friendRequests/{requestId}",
  async (event) => {
    const request = event.data?.data();
    const fromUid = request?.fromUid;
    const toUid = request?.toUid;

    if (typeof fromUid !== "string" || typeof toUid !== "string" || fromUid === toUid) {
      return;
    }

    // A block landing between the client write and this trigger still stops
    // the notification — no record, no push for a blocked pair.
    if (await isPairBlocked(fromUid, toUid)) {
      return;
    }

    const senderName = (await getDisplayName(fromUid)) || "Someone";
    await notifyUser(toUid, {
      id: friendRequestNotificationId(event.id),
      type: "friend_request",
      title: "New study buddy request",
      body: `${senderName} wants to be study buddies`,
      url: "/friends",
      actorId: fromUid,
    });
  }
);

exports.onFriendshipCreated = onDocumentCreated(
  "friendships/{pairId}",
  async (event) => {
    const friendship = event.data?.data();
    const acceptedBy = friendship?.acceptedBy;
    const userIds = Array.isArray(friendship?.userIds)
      ? friendship.userIds.filter((id) => typeof id === "string")
      : [];

    if (typeof acceptedBy !== "string" || userIds.length !== 2) {
      return;
    }

    // Notify the ORIGINAL SENDER — the member who didn't click accept — that
    // their request went through.
    const originalSender = userIds.find((uid) => uid !== acceptedBy);
    if (!originalSender) {
      return;
    }

    if (await isPairBlocked(originalSender, acceptedBy)) {
      return;
    }

    const accepterName = (await getDisplayName(acceptedBy)) || "Someone";
    await notifyUser(originalSender, {
      id: friendAcceptedNotificationId(event.id),
      type: "friend_accepted",
      title: "Study buddy request accepted",
      body: `${accepterName} accepted your study buddy request`,
      url: `/user/${acceptedBy}`,
      actorId: acceptedBy,
    });
  }
);

// Block cleanup: creating a block severs any friendship and pending requests
// between the pair, at deterministic IDs (no queries). Idempotent — deleting
// an absent doc is a no-op — so an Eventarc retry is safe.
exports.onUserBlockCreated = onDocumentCreated(
  "userBlocks/{blockId}",
  async (event) => {
    const block = event.data?.data();
    const blockerUserId = block?.blockerUserId;
    const blockedUserId = block?.blockedUserId;

    if (typeof blockerUserId !== "string" || typeof blockedUserId !== "string") {
      return;
    }

    const paths = friendCleanupPathsForBlock(blockerUserId, blockedUserId);
    await Promise.all(
      paths.map(({ collection, id }) =>
        db.collection(collection).doc(id).delete()
      )
    );
  }
);

// Per-invocation rate limit for read-heavy friend-suggestion calls. Reuses the
// rateLimits/{uid}/actions/{action} pattern (Admin write bypasses client
// rules), mirroring enforceDeleteAccountRateLimit. Throttled, not blocked:
// clients refresh suggestions occasionally, not in a loop.
const FRIEND_SUGGESTIONS_RATE_LIMIT_SECONDS = 3;

async function enforceCallableRateLimit(uid, action, minIntervalSeconds) {
  const ref = db.collection("rateLimits").doc(uid).collection("actions").doc(action);
  const now = Timestamp.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? snap.data()?.updatedAt : null;

    if (
      previous?.toMillis &&
      now.toMillis() - previous.toMillis() < minIntervalSeconds * 1000
    ) {
      throw new HttpsError("resource-exhausted", "You're doing that too fast. Try again shortly.");
    }

    tx.set(ref, { updatedAt: now }, { merge: true });
  });
}

// Friend suggestions (PR 6) — a callable, not a client query, because it must
// exclude candidates that BLOCKED the caller, and userBlocks list is
// blocker-only (a client can't discover who blocked it), so client filtering
// would leak blocked candidates as actionable Add rows. Exclusion is PER
// CANDIDATE and deterministic: for each of ≤40 class-overlap candidates the
// server checks exactly five docs (friendship + both request directions + both
// block directions) in ONE batched getAll — never a scan of the caller's whole
// friendships/requests, so a relationship beyond any page cap can't reappear.
// Worst-case reads per call = 1 + 40 + 40*5 = 241 (MAX_SUGGESTION_READS). Only
// public allowlisted fields (uid, displayName, classes, sharedClasses) are
// returned. Verified-only + rate-limited; no App Check (no existing callable in
// this project enforces it, so a half-configured requirement would be worse).
exports.getFriendSuggestions = onCall(async (request) => {
  if (!isVerifiedUwCallable(request)) {
    throw new HttpsError("unauthenticated", "Sign in with a verified UW account.");
  }

  const uid = request.auth.uid;

  try {
    await enforceCallableRateLimit(
      uid,
      "friendSuggestions",
      FRIEND_SUGGESTIONS_RATE_LIMIT_SECONDS
    );

    const meSnap = await db.collection("users").doc(uid).get();
    const myClasses = Array.isArray(meSnap.data()?.classes)
      ? meSnap.data().classes.filter((c) => typeof c === "string").slice(0, 10)
      : [];

    if (myClasses.length === 0) {
      return { suggestions: [] };
    }

    // Bounded class-overlap candidate scan.
    const candidateSnap = await db
      .collection("users")
      .where("classes", "array-contains-any", myClasses)
      .limit(CANDIDATE_SCAN_LIMIT)
      .get();

    const candidates = candidateSnap.docs
      .filter((docSnap) => docSnap.id !== uid)
      .map((docSnap) => ({
        uid: docSnap.id,
        displayName: docSnap.data()?.displayName,
        classes: docSnap.data()?.classes,
      }));

    // One getAll over each candidate's five deterministic relationship/block
    // docs — the only reads used for exclusion (no relationship scans).
    const refPlans = candidates.flatMap((candidate) =>
      relationshipDocRefsForCandidate(uid, candidate.uid)
    );
    const refs = refPlans.map((plan) => db.collection(plan.collection).doc(plan.id));
    const snaps = refs.length > 0 ? await db.getAll(...refs) : [];
    const existingDocKeys = new Set(
      snaps
        .filter((snap) => snap.exists)
        .map((snap) => `${snap.ref.parent.id}/${snap.id}`)
    );

    const excludedUids = new Set([uid]);
    for (const candidate of candidates) {
      if (isCandidateExcludedByExistence(uid, candidate.uid, existingDocKeys)) {
        excludedUids.add(candidate.uid);
      }
    }

    const suggestions = buildFriendSuggestions({
      senderUid: uid,
      myClasses,
      candidates,
      excludedUids,
      existingBlockIds: new Set(), // block exclusion already folded into excludedUids
    });

    return { suggestions };
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error; // already-normalized (unauthenticated, resource-exhausted)
    }
    console.warn("getFriendSuggestions failed", error);
    throw new HttpsError("internal", "Couldn't load suggestions. Try again.");
  }
});

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
  const now = Timestamp.now();
  const windowStart = Timestamp.fromMillis(
    now.toMillis() + REMINDER_WINDOW_START_MINUTES * 60 * 1000
  );
  const windowEnd = Timestamp.fromMillis(
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
// The state machine and cleanup runner live in ./account-deletion.js. Deletion
// intent is recorded as a durable accountDeletionJobs/{uid} marker BEFORE the
// account is disabled or any data is touched; cleanup drains queries in
// bounded pages and is idempotent, so it can resume — via this callable while
// the user's ID token lives (≤1 h after the request), and via the ops script
// scripts/resume-account-deletion.js after that. A disabled account WITHOUT a
// job marker is a moderation action and never enters cleanup.
// ---------------------------------------------------------------------------

const accountDeletion = createAccountDeletionRunner({
  db,
  auth,
  FieldValue,
});

async function enforceDeleteAccountRateLimit(uid) {
  const ref = db.collection("rateLimits").doc(uid).collection("actions").doc("deleteAccount");
  const now = Timestamp.now();

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
    userRecord = await auth.getUser(uid);
  } catch {
    throw new HttpsError("failed-precondition", "This account no longer exists.");
  }

  const job = await accountDeletion.getJob(uid);
  const decision = classifyDeletionRequest({
    callerUid: uid,
    job,
    authDisabled: userRecord.disabled === true,
  });

  if (decision === "reject-disabled-no-job") {
    // Disabled without a deletion job = moderation action, not a deletion in
    // progress. Cleanup must never start from here.
    throw new HttpsError("permission-denied", "This account is disabled. Contact support.");
  }
  if (decision === "reject-complete") {
    throw new HttpsError("failed-precondition", "This account has already been deleted.");
  }
  if (decision === "reject-not-owner") {
    throw new HttpsError("permission-denied", "You can only delete your own account.");
  }

  if (decision === "fresh") {
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

    // Durable job marker first (deletion intent on record), then disable +
    // revoke refresh tokens. From here the flow is resumable: by this
    // callable while the user's ID token lives, then by the ops script.
    await accountDeletion.beginDeletion(uid);
  }
  // decision === "resume": the caller's own active job exists — the
  // freshness/rate-limit gates are skipped (a disabled account cannot
  // re-authenticate; intent is proven by the marker) and the idempotent
  // cleanup simply continues.

  try {
    await accountDeletion.runCleanup(uid);
  } catch (error) {
    console.warn("Account deletion cleanup failed", error);
    throw new HttpsError(
      "internal",
      "Account deletion did not finish. Try again to resume."
    );
  }

  return { status: "deleted" };
});
