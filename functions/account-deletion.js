// functions/account-deletion.js — durable, resumable account-deletion state
// machine. Dependency-free: the runner receives its Firebase handles via
// injection, so the deleteUserAccount callable (functions/index.js), the ops
// resume script (scripts/resume-account-deletion.js), and the unit tests
// (tests/account-deletion.test.mjs) all drive the exact same code.
//
// Job docs live at accountDeletionJobs/{uid} — Admin SDK only, rules deny all
// client access:
//   userId, status: pending | running | complete | failed,
//   requestedAt, createdAt, updatedAt, lastStep, attemptCount, errorCode?
//
// The job marker records deletion INTENT. An account that is merely disabled
// (moderation/abuse) has no job and must never enter cleanup — deletion is
// resumed only from an explicit, Admin-written marker.

const DELETION_JOB_ACTIVE_STATUSES = ["pending", "running", "failed"];
const DELETE_CLEANUP_PAGE_SIZE = 100;

function isResumableJob(job) {
  return !!job && DELETION_JOB_ACTIVE_STATUSES.includes(job.status);
}

/**
 * How a deletion request must be treated:
 *   fresh                  — enabled account, no job: full auth gates, then begin
 *   resume                 — caller's own active job: continue the cleanup
 *   reject-complete        — job finished; nothing may rerun destructively
 *   reject-not-owner       — job belongs to a different user
 *   reject-disabled-no-job — disabled without deletion intent (moderation):
 *                            never enter cleanup
 */
function classifyDeletionRequest({ callerUid, job, authDisabled }) {
  if (job && job.userId !== callerUid) {
    return "reject-not-owner";
  }
  if (job && job.status === "complete") {
    return "reject-complete";
  }
  if (isResumableJob(job)) {
    return "resume";
  }
  if (authDisabled) {
    return "reject-disabled-no-job";
  }
  return "fresh";
}

/** Non-sensitive, bounded error tag for the job doc (ops visibility only). */
function boundedErrorCode(error) {
  return String(error?.code ?? error?.name ?? "unknown").slice(0, 64);
}

/**
 * deps: { db, auth, FieldValue } — Firestore Admin instance, admin.auth(),
 * and admin.firestore.FieldValue (or fakes, in tests).
 */
function createAccountDeletionRunner({ db, auth, FieldValue }) {
  const jobRef = (uid) => db.collection("accountDeletionJobs").doc(uid);

  async function markJob(uid, fields) {
    await jobRef(uid).set(
      { userId: uid, updatedAt: FieldValue.serverTimestamp(), ...fields },
      { merge: true }
    );
  }

  async function getJob(uid) {
    const snap = await jobRef(uid).get();
    return snap.exists ? snap.data() : null;
  }

  // Disable + revoke is idempotent and tolerates an auth user that a prior
  // attempt already deleted (the ops script can resume that state).
  async function lockAccount(uid) {
    try {
      await auth.updateUser(uid, { disabled: true });
      await auth.revokeRefreshTokens(uid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") {
        throw error;
      }
    }
  }

  // Runs `handler` over fixed-size pages of `q` until the query is empty.
  // Every handler MUST remove its docs from the query's own result set
  // (delete the doc or mutate the queried field), so each pass strictly
  // shrinks the remainder — that is what makes an interrupted run resume
  // instead of loop.
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

  // Ordered, idempotent cleanup steps. Reports are intentionally retained
  // (moderation evidence); rate-limit docs are inert leftovers.
  function cleanupSteps(uid) {
    return [
      {
        // Hosted sessions go recursively — a flat batch delete would orphan
        // the group-chat messages subcollection.
        name: "hosted-sessions",
        run: () =>
          drainQuery(db.collection("sessions").where("hostId", "==", uid), async (docs) => {
            for (const docSnap of docs) {
              await db.recursiveDelete(docSnap.ref);
            }
          }),
      },
      {
        // arrayRemove is idempotent and takes the doc out of this query.
        name: "joined-sessions",
        run: () =>
          drainQuery(
            db.collection("sessions").where("participantIds", "array-contains", uid),
            async (docs) => {
              const batch = db.batch();
              docs.forEach((docSnap) =>
                batch.update(docSnap.ref, {
                  participantIds: FieldValue.arrayRemove(uid),
                  updatedAt: FieldValue.serverTimestamp(),
                })
              );
              await batch.commit();
            }
          ),
      },
      {
        // The counterpart loses the thread too — acceptable for a 1:1 DM
        // model and required to avoid orphaned PII.
        name: "conversations",
        run: () =>
          drainQuery(
            db.collection("conversations").where("participantIds", "array-contains", uid),
            async (docs) => {
              for (const convo of docs) {
                await db.recursiveDelete(convo.ref);
              }
            }
          ),
      },
      {
        // Group-chat messages sent in sessions the user didn't host —
        // collection-group lookup on senderId (COLLECTION_GROUP index in
        // firestore.indexes.json fieldOverrides).
        name: "sent-messages",
        run: () => deleteQueryBatch(db.collectionGroup("messages").where("senderId", "==", uid)),
      },
      {
        name: "user-blocks",
        run: async () => {
          await deleteQueryBatch(db.collection("userBlocks").where("blockerUserId", "==", uid));
          await deleteQueryBatch(db.collection("userBlocks").where("blockedUserId", "==", uid));
        },
      },
      {
        // The aggregate trigger decrements location counts per delete.
        name: "location-ratings",
        run: () => deleteQueryBatch(db.collection("locationRatings").where("userId", "==", uid)),
      },
      {
        // Public doc + private, notifications, and reads subcollections.
        name: "user-tree",
        run: () => db.recursiveDelete(db.collection("users").doc(uid)),
      },
    ];
  }

  /**
   * First step of a fresh deletion: record intent, then lock the account.
   * The marker is written BEFORE anything is disabled or destroyed, so every
   * later state is attributable to an explicit user request.
   */
  async function beginDeletion(uid) {
    await markJob(uid, {
      status: "pending",
      requestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      attemptCount: 0,
    });
    await lockAccount(uid);
  }

  /**
   * Run (or re-run) the cleanup. Safe to call repeatedly: the account is
   * re-locked first, every step is idempotent, the Auth user is deleted only
   * after all data cleanup finished, and `complete` is written only after
   * that — so an interrupted run always leaves a resumable job behind.
   * `lastStep` is durable diagnostics, not a skip cursor: a resume re-runs
   * every step (each is a no-op on already-clean data) rather than trusting
   * a pointer that could hide a partially-failed page.
   */
  async function runCleanup(uid) {
    await lockAccount(uid);
    await markJob(uid, { status: "running", attemptCount: FieldValue.increment(1) });

    try {
      for (const step of cleanupSteps(uid)) {
        await step.run();
        await markJob(uid, { lastStep: step.name });
      }

      try {
        await auth.deleteUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") {
          throw error; // anything else is a real failure
        }
        // Already gone from a prior attempt — idempotent.
      }

      await markJob(uid, { status: "complete" });
    } catch (error) {
      // Keep the failure durably visible for ops; the job stays resumable.
      await markJob(uid, { status: "failed", errorCode: boundedErrorCode(error) }).catch(() => {});
      throw error;
    }
  }

  return { beginDeletion, getJob, runCleanup };
}

module.exports = {
  DELETE_CLEANUP_PAGE_SIZE,
  DELETION_JOB_ACTIVE_STATUSES,
  boundedErrorCode,
  classifyDeletionRequest,
  createAccountDeletionRunner,
  isResumableJob,
};
