#!/usr/bin/env node
// scripts/resume-account-deletion.js — ops resume path for account-deletion
// jobs that outlived the user's token window. Once a deletion begins, the
// Auth account is disabled: the user can retry the deleteUserAccount callable
// only while their last ID token is still valid (≤1 h). After that, this
// script continues the job with service-account credentials.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> \
//     node scripts/resume-account-deletion.js <uid>
//
// Safety (all checks run through the same helpers as production code, in
// functions/account-deletion.js):
//   - the uid is strictly validated BEFORE any Firebase initialization or
//     read (safe charset, ≤128 chars; empty/padded/path-like values abort);
//   - the Admin SDK is pinned to the studi-b02c3 project explicitly — an ADC
//     context pointing anywhere else aborts before and after initialization;
//   - accountDeletionJobs/{uid} must exist, be well-formed, name this exact
//     uid, and be in an active (pending | running | failed) state. Deletion
//     must have been user-initiated through the callable (which records the
//     marker before disabling anything), so ops can never destructively
//     delete a merely-disabled (moderation) account, and completed jobs can
//     never restart.
// The cleanup itself is the exact same idempotent runner the callable uses.

const path = require("node:path");
const { createRequire } = require("node:module");

const {
  DELETION_PROJECT_ID,
  createAccountDeletionRunner,
  validateResumableJob,
  validateResumeScriptArgs,
} = require("../functions/account-deletion");

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const uid = process.argv[2];

  // Environment project context, if present, must agree with the pin —
  // checked before touching Firebase at all.
  const envProject =
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || DELETION_PROJECT_ID;

  const preflight = validateResumeScriptArgs({ uid, projectId: envProject });
  if (!preflight.ok) {
    if (preflight.reason === "invalid-uid") {
      fail(
        "Invalid uid argument — expected a bare Firebase uid ([A-Za-z0-9_-], ≤128 chars).\n" +
          "Usage: node scripts/resume-account-deletion.js <uid>"
      );
    }
    fail(
      `Project context '${envProject}' is not '${DELETION_PROJECT_ID}' — refusing. ` +
        "This script only ever operates on the pinned project."
    );
  }

  // firebase-admin lives in the functions package, not the app root.
  const requireFromFunctions = createRequire(
    path.join(__dirname, "..", "functions", "index.js")
  );
  const admin = requireFromFunctions("firebase-admin");

  // Explicit pin — never trust whatever project the ambient ADC resolves to.
  admin.initializeApp({ projectId: DELETION_PROJECT_ID });
  const resolvedProject = admin.app().options.projectId;
  if (resolvedProject !== DELETION_PROJECT_ID) {
    fail(
      `Resolved project '${resolvedProject}' is not '${DELETION_PROJECT_ID}' — aborting.`
    );
  }

  const runner = createAccountDeletionRunner({
    db: admin.firestore(),
    auth: admin.auth(),
    FieldValue: admin.firestore.FieldValue,
  });

  const job = await runner.getJob(uid);
  const verdict = validateResumableJob(job, uid);
  if (!verdict.ok) {
    const explanation = {
      "missing-job":
        `No accountDeletionJobs/${uid} marker — refusing. Deletion must be ` +
        "user-initiated through the deleteUserAccount callable; a disabled " +
        "account without a job is a moderation state, not a deletion.",
      "malformed-job": `Job doc for ${uid} is malformed — refusing to act on it.`,
      "user-mismatch": `Job doc for ${uid} names a different userId — refusing.`,
      "already-complete": `Job for ${uid} is already complete — nothing to resume.`,
      "unknown-status": `Job for ${uid} has an unrecognized status — refusing.`,
    }[verdict.reason];
    fail(explanation ?? `Job validation failed (${verdict.reason}).`);
  }

  console.log(
    `Resuming deletion for ${uid} ` +
      `(status: ${job.status}, attempts: ${job.attemptCount ?? 0}, lastStep: ${job.lastStep ?? "none"})`
  );
  await runner.runCleanup(uid);
  console.log(`Deletion complete for ${uid}.`);
}

main().catch((error) => {
  console.error("Resume failed (job remains resumable):", error);
  process.exit(1);
});
