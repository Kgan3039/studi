# Session timestamp backfill

One-time migration that converts legacy session `startTime` / `endTime` values
stored as **ISO strings** (or other Date-like shapes) into real Firestore
**Timestamps**.

> **Why this is required before merge/deploy.** Discovery (`getUpcomingSessions`)
> queries sessions with `where('startTime', '>=', <Timestamp>)`. Firestore
> range filters only match documents whose field is the **same type** — a
> string-typed `startTime` never matches a Timestamp bound, so legacy
> string-backed sessions silently disappear from discovery and can't be joined
> under the current rules (`isValidNewSession` / join paths require
> `is timestamp`). The client-side normalization added in PR #29 fixes how rows
> are *rendered* once read, but it can't bring back rows the query never
> returns. This backfill rewrites the stored values so the queries find them.

This script:

- Scans every doc in the `sessions` collection.
- Converts `startTime` / `endTime` that are ISO strings, JS Dates, or plain
  `{seconds, nanoseconds}` maps into Firestore `Timestamp`s.
- **Leaves already-Timestamp fields unchanged.**
- Skips and logs any doc with a missing/unparseable value (no write for it).
- **Dry-run by default.** It writes nothing until you pass `--write`.
- Prints counts: scanned / updated / skipped invalid / already ok.

It does **not** touch Firestore rules, data models, or any other collection.

## Prerequisites

1. A **service-account key** (Firebase console → Project settings → Service
   accounts → *Generate new private key*). Save it **outside the repo**. Never
   commit it.
2. `firebase-admin` available to Node. It is intentionally **not** in the app's
   `package.json`, so install it without saving:

   ```sh
   # from the repo root
   npm install --no-save firebase-admin
   ```

   `--no-save` keeps `package.json` clean. If `package-lock.json` changes, you
   can restore it afterward with `git checkout package-lock.json`.

## Step 1 — Dry run (always do this first)

```sh
node ops/backfill-session-timestamps.mjs /absolute/path/to/serviceAccount.json
```

Review the output. It lists each `WOULD UPDATE <id>: startTime, endTime` and any
`SKIP invalid <id>: …`, then prints:

```
--- Summary ---
scanned:         <n>
would update:    <n>
skipped invalid: <n>
already ok:      <n>

DRY RUN complete — nothing was written. Re-run with --write to apply.
```

If `skipped invalid` is non-zero, inspect those docs by hand before proceeding —
they have data that can't be parsed into a date and won't be auto-fixed.

## Step 2 — Backup (recommended)

Cheap reversibility before any write:

```sh
gcloud firestore export gs://studi-b02c3.firebasestorage.app/pre-backfill-$(date +%Y%m%d)
```

(Run from a machine with `gcloud` authed to the project, or use the Cloud
console → Firestore → Import/Export.)

## Step 3 — Write

```sh
node ops/backfill-session-timestamps.mjs /absolute/path/to/serviceAccount.json --write
```

Output mirrors the dry run but with `UPDATE <id>` lines and an `updated:` count.
Updates are committed in batches of 400.

## Step 4 — Verify

Re-run the **dry run** (Step 1). A clean migration now reports:

```
scanned:         <n>
would update:    0
already ok:      <n>   (== scanned, minus any skipped invalid)
```

Spot-check in the app: previously-missing legacy sessions now appear in
discovery and can be joined.

## When to run

Run the **dry run** before merge to confirm the scope of legacy data. Run the
**write** as part of the launch deploy step (before, or immediately after,
deploying the PR #29 client) so discovery is consistent with the migrated data.
