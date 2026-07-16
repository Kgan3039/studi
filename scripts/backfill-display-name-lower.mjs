#!/usr/bin/env node
// scripts/backfill-display-name-lower.mjs — one-time ops backfill for the
// friend-search shadow field `displayNameLower` (PR 6).
//
// WHY THIS EXISTS
//   Friend search (lib/friends.ts searchUsersByNamePrefix) runs a case-
//   insensitive prefix query. Firestore range queries are case-SENSITIVE, so
//   the client writes a lowercase copy of displayName as `displayNameLower`
//   and searches that. Every displayName write path now writes the pair
//   (createOrUpdateUserProfile + updateUserDisplayName), and firestore.rules
//   pins displayNameLower == displayName.lower(). But profiles created BEFORE
//   this PR have no displayNameLower and are invisible to the canonical
//   search query. The client covers them at runtime with a bounded, case-
//   sensitive fallback query on the raw displayName, and they self-heal the
//   next time the user re-saves their name — this script closes the gap for
//   everyone at once.
//
// SAFETY
//   - Pinned to the studi-b02c3 project explicitly; an ADC context pointing
//     anywhere else aborts before any read.
//   - Idempotent: only touches docs that lack displayNameLower (or whose value
//     has drifted from displayName.lower()); a re-run after a partial pass
//     resumes cleanly. Writes ONLY displayNameLower — never displayName,
//     classes, or timestamps — so it can't clobber a concurrent profile edit.
//   - Paged (500-doc batches) so it never loads the whole users collection.
//
// USAGE (NOT run as part of deploy — an operator runs it once, deliberately):
//   GOOGLE_APPLICATION_CREDENTIALS=<service-account.json> \
//     GOOGLE_CLOUD_PROJECT=studi-b02c3 \
//     node scripts/backfill-display-name-lower.mjs [--dry-run]

import admin from "firebase-admin";

const PROJECT_ID = "studi-b02c3";
const PAGE_SIZE = 500;
const DRY_RUN = process.argv.includes("--dry-run");

function fail(message) {
  console.error(message);
  process.exit(1);
}

const envProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (envProject && envProject !== PROJECT_ID) {
  fail(
    `Project context '${envProject}' is not '${PROJECT_ID}' — refusing. ` +
      "This backfill only ever operates on the pinned project."
  );
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  let scanned = 0;
  let updated = 0;
  let cursor = null;

  for (;;) {
    let query = db.collection("users").orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    if (snap.empty) {
      break;
    }

    const batch = db.batch();
    let batchWrites = 0;

    for (const docSnap of snap.docs) {
      scanned += 1;
      const data = docSnap.data();
      const displayName = typeof data.displayName === "string" ? data.displayName : "";
      if (!displayName) {
        continue; // nothing to normalize — no name to search on
      }

      const expected = displayName.toLowerCase();
      if (data.displayNameLower === expected) {
        continue; // already correct
      }

      updated += 1;
      if (!DRY_RUN) {
        batch.update(docSnap.ref, { displayNameLower: expected });
        batchWrites += 1;
      }
    }

    if (batchWrites > 0) {
      await batch.commit();
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) {
      break;
    }
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Scanned ${scanned} users; ` +
      `${DRY_RUN ? "would update" : "updated"} ${updated} missing/stale displayNameLower.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => fail(`Backfill failed: ${error?.message ?? error}`));
