# Test-data wipe (D7)

Manual procedure for clearing all test accounts and test data before launch.
Run AFTER PR 3 is applied, BEFORE deploying the PR 4/5 rules + indexes + functions
(the single late deploy — bundle README step 7).

> **This document does not run anything. Every step below is performed by a human
> in the Firebase console (or via the optional script), deliberately.**

## What gets deleted

- **All Firebase Auth users.**
- Firestore collections, including all subcollections:
  - `users` (including each user's `private/profile` subdocument)
  - `sessions`
  - `conversations` (including `messages` subcollections)
  - `userBlocks`
  - `reports`
  - `locationRatings`

## What must be KEPT

- ⚠️ **`locations` — DO NOT DELETE.** This is curated static data (60+ UW study
  spots) and is the only collection that survives the wipe. It is not test data.
  If it is deleted by mistake, Explore falls back to the bundled built-in list,
  but any console-side curation is lost.

## Pre-wipe backup (recommended)

Even for test data, take a cheap snapshot first — it makes the wipe reversible
and preserves `reports` evidence if you ever need it:

1. **Firestore export** (requires a Cloud Storage bucket; the default
   `gs://studi-b02c3.firebasestorage.app` works):
   ```sh
   gcloud firestore export gs://studi-b02c3.firebasestorage.app/pre-wipe-backup-$(date +%Y%m%d)
   ```
   (Run from a machine with `gcloud` authed to the project. Console alternative:
   Google Cloud console → Firestore → Import/Export → Export.)
2. **Auth users export**:
   ```sh
   firebase auth:export pre-wipe-auth-users.json --project studi-b02c3
   ```
   Store the file OUTSIDE the repo; it contains emails. Never commit it.

## Procedure (console-only, no script needed at current data volume)

1. Firebase console → **Authentication → Users** → select all → **Delete**.
2. Firebase console → **Firestore** → for each of `users`, `sessions`,
   `conversations`, `userBlocks`, `reports`, `locationRatings`:
   open the collection → ⋮ menu → **Delete collection**.
   (Console collection-delete recursively removes subcollections, so
   `users/*/private` and `conversations/*/messages` go with their parents.)
3. **Stop. Do not touch `locations`.**

## Script alternative (if you prefer repeatable)

Requires a service-account key (Project settings → Service accounts → Generate
key) saved OUTSIDE the repo. Never commit it.

```js
// ops/wipe.mjs  — run: node ops/wipe.mjs /absolute/path/to/serviceAccount.json
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const sa = JSON.parse(readFileSync(process.argv[2], 'utf8'));
initializeApp({ credential: cert(sa) });
const db = getFirestore();

// 'locations' is intentionally absent — it must survive the wipe.
const WIPE = ['users', 'sessions', 'conversations', 'userBlocks', 'reports', 'locationRatings'];
for (const col of WIPE) {
  await db.recursiveDelete(db.collection(col));
  console.log('wiped', col);
}

let pageToken;
do {
  const page = await getAuth().listUsers(1000, pageToken);
  if (page.users.length) {
    await getAuth().deleteUsers(page.users.map((u) => u.uid));
    console.log('deleted', page.users.length, 'auth users');
  }
  pageToken = page.pageToken;
} while (pageToken);
console.log('done');
```

`npm i firebase-admin` in a scratch folder to run it; do not add it to the
app's package.json.

## Post-wipe verification

All of these must hold before proceeding to the deploy step:

1. **Authentication → Users** shows zero users.
2. **Firestore data browser** shows exactly one root collection: `locations`.
   None of `users`, `sessions`, `conversations`, `userBlocks`, `reports`,
   `locationRatings` appear (Firestore hides empty collections — they should
   simply be gone from the list).
3. Open a few `locations` docs and confirm the curated spots are intact
   (name, building, campusArea, tags).
4. Confirm no `locations` doc carries leftover `ratingCount` / `ratingSum` /
   `tagCounts` fields, so the aggregate trigger starts from zero. (None are
   expected — the trigger was never deployed pre-wipe — but verify.)
5. Spot-check in the app (old rules still deployed at this point): signed-out
   Home renders; nothing crashes from missing data.

## After the wipe

Next step in the choreography (NOT part of this document, do not run it as
part of the wipe): Blaze upgrade + $10 budget alert, then the single deploy
`firebase deploy --only firestore:rules,firestore:indexes,functions`.
