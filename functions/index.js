// functions/index.js — firebase-functions v6 (2nd gen), Node 20.
// Replaces the previous v1-style functions/index.js in full.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { Expo } = require("expo-server-sdk");

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
    await sendPushToUsers(recipients, {
      title: senderName || "New message",
      body: text,
      data: { url: `/conversation/${conversationId}` },
    });
  }
);

exports.onSessionParticipantsUpdated = onDocumentUpdated(
  "sessions/{sessionId}",
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const hostId = after?.hostId;

    if (!hostId) {
      return;
    }

    const beforeParticipants = Array.isArray(before?.participantIds)
      ? before.participantIds.filter((id) => typeof id === "string")
      : [];
    const afterParticipants = Array.isArray(after?.participantIds)
      ? after.participantIds.filter((id) => typeof id === "string")
      : [];
    const newlyAdded = afterParticipants.filter((uid) => !beforeParticipants.includes(uid));
    const joiners = newlyAdded.filter((uid) => uid !== hostId);

    if (joiners.length === 0) {
      return;
    }

    const displayName = (await getDisplayName(joiners[0])) || "Someone";
    const classId = typeof after?.classId === "string" ? after.classId : "your session";

    await sendPushToUsers([hostId], {
      title: "New study partner",
      body: `${displayName} joined ${classId}`,
      data: { url: `/session/${event.params.sessionId}` },
    });
  }
);

// ---------------------------------------------------------------------------
// Account deletion (D8): single authoritative path. Admin SDK bypasses rules,
// so client-side cleanup write-paths no longer exist in the rules at all.
// Reports are intentionally retained (moderation evidence).
// ---------------------------------------------------------------------------

async function deleteQueryBatch(q) {
  // Deletes in pages to stay under batch limits.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await q.limit(200).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
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

exports.deleteUserAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  const authTime = request.auth?.token?.auth_time;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in to delete your account.");
  }

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

  // 1. Sessions hosted by the user: delete outright.
  await deleteQueryBatch(db.collection("sessions").where("hostId", "==", uid));

  // 2. Sessions joined: remove from participant arrays.
  const joined = await db
    .collection("sessions")
    .where("participantIds", "array-contains", uid)
    .get();
  for (const docSnap of joined.docs) {
    await docSnap.ref.update({
      participantIds: admin.firestore.FieldValue.arrayRemove(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // 3. Conversations: delete the thread and its messages (the counterpart
  //    loses the thread too — acceptable for a 1:1 DM model and required to
  //    avoid orphaned PII; messages contain the deleted user's words).
  const conversations = await db
    .collection("conversations")
    .where("participantIds", "array-contains", uid)
    .get();
  for (const convo of conversations.docs) {
    await db.recursiveDelete(convo.ref);
  }

  // 4. Blocks in either direction.
  await deleteQueryBatch(db.collection("userBlocks").where("blockerUserId", "==", uid));
  await deleteQueryBatch(db.collection("userBlocks").where("blockedUserId", "==", uid));

  // 5. Location ratings (the aggregate trigger above decrements counts).
  await deleteQueryBatch(db.collection("locationRatings").where("userId", "==", uid));

  // 6. Profile (public doc + private subcollection), then the Auth user.
  await db.recursiveDelete(db.collection("users").doc(uid));
  await admin.auth().deleteUser(uid);

  return { status: "deleted" };
});
