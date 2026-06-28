// functions/index.js — firebase-functions v6 (2nd gen), Node 20.
// Replaces the previous v1-style functions/index.js in full.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const db = admin.firestore();
const DELETE_ACCOUNT_MAX_AUTH_AGE_SECONDS = 5 * 60;
const DELETE_ACCOUNT_RATE_LIMIT_SECONDS = 10 * 60;

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
