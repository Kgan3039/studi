// Cloud Function to perform safe, admin-authorized account deletion and cleanup.
// This runs on the server with the Admin SDK and avoids opening client-side delete rules.
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Helper: delete all documents returned by a query in batches
// (keeps batch sizes under Firestore limits)
async function deleteQuery(query) {
  const snapshot = await query.get();
  if (snapshot.empty) return;
  const batchSize = 500;
  let docs = snapshot.docs;
  while (docs.length) {
    const batch = db.batch();
    const chunk = docs.splice(0, batchSize);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

exports.deleteUserAccount = functions.https.onCall(async (data, context) => {
  // Caller must be authenticated and usually should be the user deleting themself.
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const callerUid = context.auth.uid;
  const uidToDelete = data?.uid;
  if (!uidToDelete) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing uid to delete.');
  }

  // Only allow the user to delete their own account, or a caller with admin custom claim.
  if (callerUid !== uidToDelete) {
    const caller = await admin.auth().getUser(callerUid).catch(() => null);
    const isAdmin = caller?.customClaims?.admin === true;
    if (!isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Not authorized to delete this account.');
    }
  }

  try {
    // 1) Delete locationRatings where userId == uid
    await deleteQuery(db.collection('locationRatings').where('userId', '==', uidToDelete));

    // 2) Delete userBlocks where blockerUserId == uid OR blockedUserId == uid
    await deleteQuery(db.collection('userBlocks').where('blockerUserId', '==', uidToDelete));
    await deleteQuery(db.collection('userBlocks').where('blockedUserId', '==', uidToDelete));

    // 3) Delete reports where reporterUserId == uid OR reportedUserId == uid
    await deleteQuery(db.collection('reports').where('reporterUserId', '==', uidToDelete));
    await deleteQuery(db.collection('reports').where('reportedUserId', '==', uidToDelete));

    // 4) Conversations: find conversations containing the user, delete their messages and remove them from participantIds
    const convsSnap = await db.collection('conversations').where('participantIds', 'array-contains', uidToDelete).get();
    for (const convDoc of convsSnap.docs) {
      const convRef = convDoc.ref;
      const convData = convDoc.data() || {};
      // delete messages subcollection
      const messagesSnap = await convRef.collection('messages').get();
      if (!messagesSnap.empty) {
        const batch = db.batch();
        messagesSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      // remove user from participantIds or delete conversation if no participants remain
      const participants = Array.isArray(convData.participantIds) ? convData.participantIds : [];
      const newParticipants = participants.filter(id => id !== uidToDelete);
      if (newParticipants.length === 0) {
        await convRef.delete();
      } else {
        await convRef.update({ participantIds: newParticipants });
      }
    }

    // 5) Sessions: delete sessions where hostId == uid, else remove user from participantIds
    const hosted = await db.collection('sessions').where('hostId', '==', uidToDelete).get();
    for (const s of hosted.docs) {
      await s.ref.delete();
    }
    const joined = await db.collection('sessions').where('participantIds', 'array-contains', uidToDelete).get();
    for (const s of joined.docs) {
      const p = s.data().participantIds || [];
      const newp = p.filter(id => id !== uidToDelete);
      await s.ref.update({ participantIds: newp });
    }

    // 6) Delete any locationRatings/user-owned docs already handled; delete user document
    await db.collection('users').doc(uidToDelete).delete().catch(() => null);

    // 7) Finally delete the Auth user. If the Auth user record is already gone
    // (for example due to an earlier partial deletion), treat that as success.
    try {
      await admin.auth().deleteUser(uidToDelete);
    } catch (authErr) {
      // admin.auth().deleteUser throws an Error-like object with `code` when user is missing
      if (authErr && (authErr.code === 'auth/user-not-found' || authErr.code === 'USER_NOT_FOUND')) {
        console.warn(`Auth user ${uidToDelete} not found at delete time; continuing.`);
      } else {
        throw authErr;
      }
    }

    return { success: true };
  } catch (err) {
    console.error('deleteUserAccount error', err);
    throw new functions.https.HttpsError('internal', 'Failed to delete account: ' + (err.message || String(err)));
  }
});
