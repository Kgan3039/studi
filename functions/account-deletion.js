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

// The only project the ops resume script may ever touch. Matches .firebaserc
// and firebaseConfig.ts.
const DELETION_PROJECT_ID = "studi-b02c3";

// Firebase Auth uids are ≤128 chars; the charset matches the backend-wide
// safe-ID pattern (notification-validation.js). Rejects empty, padded,
// path-like, dotted, and percent-encoded values outright.
const SAFE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isValidDeletionUid(value) {
  return typeof value === "string" && SAFE_UID_PATTERN.test(value);
}

/**
 * Preflight for the ops resume script — must pass BEFORE any Firebase
 * initialization or reads. Returns { ok: true } or { ok: false, reason }.
 */
function validateResumeScriptArgs({ uid, projectId }) {
  if (!isValidDeletionUid(uid)) {
    return { ok: false, reason: "invalid-uid" };
  }
  if (projectId !== DELETION_PROJECT_ID) {
    return { ok: false, reason: "wrong-project" };
  }
  return { ok: true };
}

function isResumableJob(job) {
  return !!job && DELETION_JOB_ACTIVE_STATUSES.includes(job.status);
}

/**
 * Strict gate before runCleanup() may be driven from the ops path: the job
 * doc must exist, be well-formed, belong to the target uid, and be in an
 * active (non-complete) state. Returns { ok: true } or { ok: false, reason }.
 */
function validateResumableJob(job, uid) {
  if (!job || typeof job !== "object") {
    return { ok: false, reason: "missing-job" };
  }
  if (typeof job.userId !== "string" || typeof job.status !== "string") {
    return { ok: false, reason: "malformed-job" };
  }
  if (job.userId !== uid) {
    return { ok: false, reason: "user-mismatch" };
  }
  if (job.status === "complete") {
    return { ok: false, reason: "already-complete" };
  }
  if (!DELETION_JOB_ACTIVE_STATUSES.includes(job.status)) {
    return { ok: false, reason: "unknown-status" };
  }
  return { ok: true };
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

  async function deleteOwnedPushRegistries(collectionName, uid) {
    await drainQuery(
      db.collection(collectionName).where("userId", "==", uid),
      async (docs) => {
        await db.runTransaction(async (tx) => {
          const current = await Promise.all(docs.map((docSnap) => tx.get(docSnap.ref)));
          current.forEach((snapshot) => {
            if (snapshot.exists && snapshot.data()?.userId === uid) {
              tx.delete(snapshot.ref);
            }
          });
        });
      }
    );
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
        // Pending requests in both directions (deterministic-ID docs, but
        // queried by field so a partially-deleted page resumes cleanly).
        name: "friend-requests",
        run: async () => {
          await deleteQueryBatch(db.collection("friendRequests").where("fromUid", "==", uid));
          await deleteQueryBatch(db.collection("friendRequests").where("toUid", "==", uid));
        },
      },
      {
        // Friendships name both members in userIds — the counterpart loses the
        // friendship too, same as the DM-conversation model above.
        name: "friendships",
        run: () =>
          deleteQueryBatch(db.collection("friendships").where("userIds", "array-contains", uid)),
      },
      {
        // The aggregate trigger decrements location counts per delete.
        name: "location-ratings",
        run: () => deleteQueryBatch(db.collection("locationRatings").where("userId", "==", uid)),
      },
      {
        // Re-read in a transaction so a token transferred to another user
        // after the query cannot lose its new ownership registry.
        name: "push-token-owners",
        run: () => deleteOwnedPushRegistries("pushTokenOwners", uid),
      },
      {
        name: "push-token-installations",
        run: () => deleteOwnedPushRegistries("pushTokenInstallations", uid),
      },
      {
        // Preserve the requested catalog item for review, but remove the
        // account link. Deleting requesterUserId also removes each updated doc
        // from this query, so every bounded page makes strict progress and a
        // retry safely resumes from what remains.
        name: "catalog-requests",
        run: () =>
          drainQuery(
            db.collection("catalogRequests").where("requesterUserId", "==", uid),
            async (docs) => {
              const batch = db.batch();
              docs.forEach((docSnap) =>
                batch.update(docSnap.ref, {
                  requesterUserId: FieldValue.delete(),
                  anonymized: true,
                  anonymizedAt: FieldValue.serverTimestamp(),
                })
              );
              await batch.commit();
            }
          ),
      },
      {
        // Public doc + private, notifications, and reads subcollections.
        name: "user-tree",
        run: () => db.recursiveDelete(db.collection("users").doc(uid)),
      },
    ];
  }

  /**
   * Best-effort durable failure record. `lastStep` names the PHASE that was
   * executing when the failure hit (per-step writes already recorded the
   * last completed step up to that point). A failure while writing the
   * failure state itself is logged loudly but never masks the original
   * error — the caller always rethrows what actually broke.
   */
  async function persistFailure(uid, phase, originalError) {
    try {
      await markJob(uid, {
        status: "failed",
        lastStep: phase,
        errorCode: boundedErrorCode(originalError),
      });
    } catch (writeError) {
      console.error(
        `Account-deletion failure state could not be persisted (uid: ${uid}, phase: ${phase});` +
          " original error follows the rethrow",
        writeError
      );
    }
  }

  /**
   * First step of a fresh deletion: record intent, then lock the account.
   * The marker is written BEFORE anything is disabled or destroyed, so every
   * later state is attributable to an explicit user request. Both phases run
   * inside the protected lifecycle — a lock failure lands on the job doc as
   * status: failed instead of vanishing.
   */
  async function beginDeletion(uid) {
    let phase = "record-intent";
    try {
      await markJob(uid, {
        status: "pending",
        requestedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        attemptCount: 0,
      });
      phase = "lock-account";
      await lockAccount(uid);
    } catch (error) {
      await persistFailure(uid, phase, error);
      throw error;
    }
  }

  /**
   * Run (or re-run) the cleanup. Safe to call repeatedly: the account is
   * re-locked first, every step is idempotent, the Auth user is deleted only
   * after all data cleanup finished, and `complete` is written only after
   * that — so an interrupted run always leaves a resumable job behind.
   * The ENTIRE lifecycle (lock, running-write, steps, auth deletion,
   * complete-write) is failure-protected: whatever phase breaks is persisted
   * as status: failed with that phase in lastStep. Per-step lastStep writes
   * are durable diagnostics, not a skip cursor: a resume re-runs every step
   * (each is a no-op on already-clean data) rather than trusting a pointer
   * that could hide a partially-failed page. attemptCount increments only
   * when a run reaches `running` — a pre-lock failure preserves it.
   */
  async function runCleanup(uid) {
    let phase = "lock-account";
    try {
      await lockAccount(uid);

      phase = "mark-running";
      await markJob(uid, { status: "running", attemptCount: FieldValue.increment(1) });

      for (const step of cleanupSteps(uid)) {
        phase = step.name;
        await step.run();
        await markJob(uid, { lastStep: step.name });
      }

      phase = "delete-auth-user";
      try {
        await auth.deleteUser(uid);
      } catch (error) {
        if (error?.code !== "auth/user-not-found") {
          throw error; // anything else is a real failure
        }
        // Already gone from a prior attempt — idempotent.
      }

      phase = "mark-complete";
      await markJob(uid, { status: "complete" });
    } catch (error) {
      // Keep the failure durably visible for ops; the job stays resumable.
      await persistFailure(uid, phase, error);
      throw error;
    }
  }

  return { beginDeletion, getJob, runCleanup };
}

module.exports = {
  DELETE_CLEANUP_PAGE_SIZE,
  DELETION_JOB_ACTIVE_STATUSES,
  DELETION_PROJECT_ID,
  boundedErrorCode,
  classifyDeletionRequest,
  createAccountDeletionRunner,
  isResumableJob,
  isValidDeletionUid,
  validateResumableJob,
  validateResumeScriptArgs,
};
