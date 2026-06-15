// ops/backfill-session-timestamps.mjs
//
// One-time backfill: convert legacy session startTime/endTime values that were
// stored as ISO strings (or other Date-like shapes) into real Firestore
// Timestamps, so they satisfy the `is timestamp` rules and appear in the
// Timestamp-range discovery queries (getUpcomingSessions). Already-Timestamp
// fields are left untouched.
//
// Dry-run by default — prints what it WOULD change and writes nothing.
// Pass --write to actually persist updates.
//
//   Dry-run:  node ops/backfill-session-timestamps.mjs /abs/path/serviceAccount.json
//   Write:    node ops/backfill-session-timestamps.mjs /abs/path/serviceAccount.json --write
//
// See ops/backfill-session-timestamps.md for the full runbook.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const keyPath = process.argv[2];
const write = process.argv.includes('--write');

if (!keyPath || keyPath.startsWith('--')) {
  console.error(
    'Usage: node ops/backfill-session-timestamps.mjs <serviceAccount.json> [--write]'
  );
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
const db = getFirestore();

/**
 * Mirrors lib/firestore.ts normalizeSessionTimestamp. Returns:
 *   { ts, changed: false } — value is already a Firestore Timestamp (leave as-is)
 *   { ts, changed: true }  — value is legacy (ISO string / Date / {seconds,…})
 *                            and needs to be rewritten as `ts`
 *   null                   — value is missing or unparseable (skip + log)
 */
function normalize(value) {
  if (value instanceof Timestamp) {
    return { ts: value, changed: false };
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : { ts: Timestamp.fromDate(value), changed: true };
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : { ts: Timestamp.fromDate(parsed), changed: true };
  }

  // A plain {seconds, nanoseconds} map (a Timestamp that lost its type) is NOT
  // a Firestore timestamp and fails `is timestamp` — rebuild it as a real one.
  if (value && typeof value === 'object' && typeof value.seconds === 'number') {
    const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : 0;
    return { ts: new Timestamp(value.seconds, nanoseconds), changed: true };
  }

  return null;
}

const BATCH_LIMIT = 400; // Firestore caps a write batch at 500; leave headroom.

async function main() {
  console.log(
    write
      ? '=== Session timestamp backfill — WRITE MODE (updates will be persisted) ==='
      : '=== Session timestamp backfill — DRY RUN (no writes; pass --write to apply) ==='
  );

  const snapshot = await db.collection('sessions').get();

  let scanned = 0;
  let updated = 0; // in dry-run: count that WOULD be updated
  let skippedInvalid = 0;
  let alreadyOk = 0;

  let batch = db.batch();
  let pending = 0;

  for (const docSnap of snapshot.docs) {
    scanned += 1;
    const data = docSnap.data();

    const start = normalize(data.startTime);
    const end = normalize(data.endTime);

    if (!start || !end) {
      skippedInvalid += 1;
      console.warn(
        `SKIP invalid ${docSnap.id}: startTime=${JSON.stringify(data.startTime)} ` +
          `endTime=${JSON.stringify(data.endTime)}`
      );
      continue;
    }

    if (!start.changed && !end.changed) {
      alreadyOk += 1;
      continue;
    }

    const patch = {};
    if (start.changed) {
      patch.startTime = start.ts;
    }
    if (end.changed) {
      patch.endTime = end.ts;
    }

    updated += 1;
    console.log(
      `${write ? 'UPDATE' : 'WOULD UPDATE'} ${docSnap.id}: ${Object.keys(patch).join(', ')}`
    );

    if (write) {
      batch.update(docSnap.ref, patch);
      pending += 1;
      if (pending >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (write && pending > 0) {
    await batch.commit();
  }

  console.log('--- Summary ---');
  console.log(`scanned:         ${scanned}`);
  console.log(`${write ? 'updated' : 'would update'}:    ${updated}`);
  console.log(`skipped invalid: ${skippedInvalid}`);
  console.log(`already ok:      ${alreadyOk}`);
  if (!write) {
    console.log('\nDRY RUN complete — nothing was written. Re-run with --write to apply.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  });
