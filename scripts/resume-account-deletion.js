#!/usr/bin/env node
// scripts/resume-account-deletion.js — ops resume path for account-deletion
// jobs that outlived the user's token window. Once a deletion begins, the
// Auth account is disabled: the user can retry the deleteUserAccount callable
// only while their last ID token is still valid (≤1 h). After that, this
// script continues the job with service-account credentials.
//
// Usage (Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS):
//   GOOGLE_CLOUD_PROJECT=<project-id> node scripts/resume-account-deletion.js <uid>
//
// Safety: it refuses to run unless accountDeletionJobs/{uid} exists with an
// active (pending | running | failed) status — deletion must have been
// explicitly requested by the user through the callable (which records the
// marker before disabling anything), so ops can never destructively delete a
// merely-disabled (moderation) account, and completed jobs can never restart.
// The cleanup itself is the exact same idempotent runner the callable uses.

const path = require("node:path");
const { createRequire } = require("node:module");

// firebase-admin lives in the functions package, not the app root.
const requireFromFunctions = createRequire(path.join(__dirname, "..", "functions", "index.js"));
const admin = requireFromFunctions("firebase-admin");

const {
  createAccountDeletionRunner,
  isResumableJob,
} = require("../functions/account-deletion");

async function main() {
  const uid = process.argv[2];

  if (!uid) {
    console.error("Usage: node scripts/resume-account-deletion.js <uid>");
    process.exit(1);
  }

  admin.initializeApp();
  const runner = createAccountDeletionRunner({
    db: admin.firestore(),
    auth: admin.auth(),
    FieldValue: admin.firestore.FieldValue,
  });

  const job = await runner.getJob(uid);

  if (!job) {
    console.error(
      `No accountDeletionJobs/${uid} marker — refusing. Deletion must be ` +
        "user-initiated through the deleteUserAccount callable; a disabled " +
        "account without a job is a moderation state, not a deletion."
    );
    process.exit(1);
  }

  if (!isResumableJob(job)) {
    console.error(`Job for ${uid} has status '${job.status}' — nothing to resume.`);
    process.exit(1);
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
