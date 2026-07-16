// tests/firestore-rules.test.mjs
// Run: npm run rules:test  (starts against a running emulator: firebase emulators:exec)
// Covers every allow/deny branch that matters. Node 20+, type: module not required
// (.mjs). Dev deps: @firebase/rules-unit-testing, firebase (already present), mocha.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

const PROJECT_ID = 'studi-rules-test';
let env;

const ALICE = 'aliceUid';
const BOB = 'bobUid';
const MALLORY = 'malloryUid';

function ctx(uid, { verified = true, email } = {}) {
  return env
    .authenticatedContext(uid, {
      email: email ?? `${uid}@wisc.edu`,
      email_verified: verified,
    })
    .firestore();
}

function futureTs(hours = 24) {
  return Timestamp.fromMillis(Date.now() + hours * 3600 * 1000);
}

function validSession(hostUid, overrides = {}) {
  return {
    classId: 'COMPSCI 300',
    hostId: hostUid,
    locationId: 'college-library',
    title: 'COMP SCI 300 Study Session',
    startTime: futureTs(24),
    endTime: futureTs(26),
    participantIds: [hostUid],
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function convoId(a, b) {
  return [a, b].sort().join('__');
}

function validConversation(a, b) {
  const ids = [a, b].sort();
  return {
    participantIds: ids,
    participantKey: ids.join('__'),
    lastMessagePreview: '',
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => env.cleanup());
beforeEach(async () => env.clearFirestore());

// ---------------------------------------------------------------- helpers
async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), path), data);
  });
}

function batchWithRateLimit(db, uid, action) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rateLimits', uid, 'actions', action), {
    updatedAt: serverTimestamp(),
  });
  return batch;
}

function createSessionWithRateLimit(db, uid, sessionId, session) {
  const batch = batchWithRateLimit(db, uid, 'createSession');
  batch.set(doc(db, 'sessions', sessionId), session);
  return batch.commit();
}

function createMessageWithRateLimit(db, uid, conversationId, messageId, message) {
  const batch = batchWithRateLimit(db, uid, 'sendMessage');
  batch.set(doc(db, 'conversations', conversationId, 'messages', messageId), message);
  return batch.commit();
}

function updateConversationWithRateLimit(db, uid, conversationId, data) {
  const batch = batchWithRateLimit(db, uid, 'sendMessage');
  batch.update(doc(db, 'conversations', conversationId), data);
  return batch.commit();
}

// Mirrors sendSessionMessage in lib/firestore.ts: session-chat message +
// sendMessage rate-limit write in a single batch.
function createSessionChatMessage(db, uid, sessionId, messageId, message) {
  const batch = batchWithRateLimit(db, uid, 'sendMessage');
  batch.set(doc(db, 'sessions', sessionId, 'messages', messageId), message);
  return batch.commit();
}

// Mirrors sendDirectMessage in lib/firestore.ts: message + metadata bump +
// sendMessage rate-limit write in a single batch.
function clientSendFlow(db, uid, conversationId, messageId, text) {
  const batch = batchWithRateLimit(db, uid, 'sendMessage');
  batch.set(doc(db, 'conversations', conversationId, 'messages', messageId), {
    senderId: uid, text, createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'conversations', conversationId), {
    lastMessagePreview: text.slice(0, 200),
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

function createReportWithRateLimit(db, uid, reportId, report) {
  const batch = batchWithRateLimit(db, uid, 'reportUser');
  batch.set(doc(db, 'reports', reportId), report);
  return batch.commit();
}

function setRatingWithRateLimit(db, uid, ratingId, rating) {
  const batch = batchWithRateLimit(db, uid, 'locationRating');
  batch.set(doc(db, 'locationRatings', ratingId), rating);
  return batch.commit();
}

// ---------------------------------------------------------------- identity
describe('identity gates', () => {
  it('denies unverified users reading anything', async () => {
    await seed(`users/${ALICE}`, { displayName: 'Alice', classes: [] });
    await assertFails(getDoc(doc(ctx(BOB, { verified: false }), 'users', ALICE)));
  });

  it('denies non-wisc.edu verified emails', async () => {
    await seed(`users/${ALICE}`, { displayName: 'Alice', classes: [] });
    await assertFails(
      getDoc(doc(ctx(BOB, { email: 'bob@gmail.com' }), 'users', ALICE))
    );
  });
});

// ---------------------------------------------------------------- users
describe('users', () => {
  it('verified user reads public profiles', async () => {
    await seed(`users/${ALICE}`, { displayName: 'Alice', classes: [] });
    await assertSucceeds(getDoc(doc(ctx(BOB), 'users', ALICE)));
  });

  it('owner creates a valid public profile', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice A',
        displayNameLower: 'alice a',
        classes: ['MATH 221'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('owner saves displayNameLower when it matches displayName.lower()', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice Anderson',
        displayNameLower: 'alice anderson',
        classes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a displayNameLower that is not the lowercase of displayName', async () => {
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice Anderson',
        displayNameLower: 'bob',
        classes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    // displayNameLower without a displayName is also rejected.
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayNameLower: 'alice anderson',
        classes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  // Rollout PHASE 1: old clients that don't write displayNameLower must keep
  // working (see docs/friends-rollout.md). PHASE 2 makes these mandatory.
  it('allows a new named profile without displayNameLower (rollout phase 1, old client)', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice Anderson',
        classes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('allows a rename that omits displayNameLower (rollout phase 1, legacy doc)', async () => {
    // Legacy/old-client doc: no displayNameLower present, so the rename doesn't
    // strand a stale lower value (the sync check only fires when it's present).
    await seed(`users/${ALICE}`, {
      displayName: 'Alice Anderson',
      classes: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alicia Anderson',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('allows a rename that updates displayNameLower to match', async () => {
    await seed(`users/${ALICE}`, {
      displayName: 'Alice Anderson',
      displayNameLower: 'alice anderson',
      classes: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alicia Anderson',
        displayNameLower: 'alicia anderson',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('lets a legacy profile (no displayNameLower) edit unrelated fields', async () => {
    // Legacy shape: has a displayName but predates displayNameLower.
    await seed(`users/${ALICE}`, {
      displayName: 'Alice Anderson',
      classes: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        year: 'Junior',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('lets a legacy profile self-heal by adding a matching displayNameLower', async () => {
    await seed(`users/${ALICE}`, {
      displayName: 'Alice Anderson',
      classes: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayNameLower: 'alice anderson',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects PII fields on the public doc', async () => {
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice',
        classes: [],
        phone: '608-555-0100',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects >12 classes and >60-char names', async () => {
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'A'.repeat(61),
        classes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice',
        classes: Array.from({ length: 13 }, (_, i) => `C${i}`),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('owner saves expanded profile fields (year/major/pronouns/bio)', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice A',
        displayNameLower: 'alice a',
        classes: ['MATH 221'],
        year: 'Junior',
        major: 'Computer Science',
        pronouns: 'she/her',
        bio: 'CS junior — usually at College Library before midterms.',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects a year outside the enum', async () => {
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice',
        classes: [],
        year: 'Super Senior',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('rejects overlong or empty expanded fields', async () => {
    const base = {
      displayName: 'Alice',
      classes: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), { ...base, major: 'M'.repeat(61) })
    );
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), { ...base, pronouns: 'p'.repeat(21) })
    );
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), { ...base, bio: 'b'.repeat(141) })
    );
    // Cleared fields must be deleted, never stored as ''.
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE), { ...base, major: '' })
    );
  });

  it('owner clears expanded fields by deleting the keys', async () => {
    await seed(`users/${ALICE}`, {
      displayName: 'Alice',
      classes: [],
      year: 'Junior',
      major: 'Computer Science',
      pronouns: 'she/her',
      bio: 'Old bio',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await assertSucceeds(
      updateDoc(doc(ctx(ALICE), 'users', ALICE), {
        year: deleteField(),
        major: deleteField(),
        pronouns: deleteField(),
        bio: deleteField(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('non-owner cannot write someone else’s profile', async () => {
    await assertFails(
      setDoc(doc(ctx(MALLORY), 'users', ALICE), {
        displayName: 'Pwned',
        classes: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('private profile: owner-only read; email must match token', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'users', ALICE, 'private', 'profile'), {
        email: `${ALICE}@wisc.edu`,
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      getDoc(doc(ctx(BOB), 'users', ALICE, 'private', 'profile'))
    );
    await assertFails(
      setDoc(doc(ctx(ALICE), 'users', ALICE, 'private', 'profile'), {
        email: 'spoofed@wisc.edu',
        updatedAt: serverTimestamp(),
      })
    );
  });
});

// --------------------------------------------------------- user settings
describe('user settings (users/{uid}/private/settings)', () => {
  const settingsRef = (db, uid) => doc(db, 'users', uid, 'private', 'settings');
  const allPrefs = (overrides = {}) => ({
    sessionReminders: true,
    sessionActivity: true,
    dmMessages: true,
    groupMessages: true,
    friendRequests: true,
    ...overrides,
  });

  it('owner creates valid settings (full and partial pref maps)', async () => {
    await assertSucceeds(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: allPrefs(), updatedAt: serverTimestamp(),
    }));
    // Partial map is valid — a missing key means enabled.
    await assertSucceeds(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: { dmMessages: false }, updatedAt: serverTimestamp(),
    }));
  });

  it('owner updates a single preference in place', async () => {
    await seed(`users/${ALICE}/private/settings`, {
      notificationPrefs: allPrefs(), updatedAt: Timestamp.now(),
    });
    await assertSucceeds(updateDoc(settingsRef(ctx(ALICE), ALICE), {
      'notificationPrefs.dmMessages': false,
      updatedAt: serverTimestamp(),
    }));
  });

  it('another user cannot read or write settings', async () => {
    await seed(`users/${ALICE}/private/settings`, {
      notificationPrefs: allPrefs(), updatedAt: Timestamp.now(),
    });
    await assertFails(getDoc(settingsRef(ctx(BOB), ALICE)));
    await assertFails(setDoc(settingsRef(ctx(BOB), ALICE), {
      notificationPrefs: allPrefs({ dmMessages: false }),
      updatedAt: serverTimestamp(),
    }));
  });

  it('rejects unknown keys at both levels', async () => {
    await assertFails(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: allPrefs(),
      marketingOptIn: true,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: allPrefs({ emailDigest: true }),
      updatedAt: serverTimestamp(),
    }));
    // No public/private-profile data in the settings doc:
    await assertFails(setDoc(settingsRef(ctx(ALICE), ALICE), {
      email: `${ALICE}@wisc.edu`, updatedAt: serverTimestamp(),
    }));
  });

  it('rejects non-boolean preference values', async () => {
    await assertFails(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: allPrefs({ dmMessages: 'yes' }),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: allPrefs({ sessionReminders: 1 }),
      updatedAt: serverTimestamp(),
    }));
  });

  it('rejects arbitrary updatedAt values', async () => {
    await assertFails(setDoc(settingsRef(ctx(ALICE), ALICE), {
      notificationPrefs: allPrefs(), updatedAt: Timestamp.fromMillis(0),
    }));
    // Updates must re-pin updatedAt to the server clock too:
    await seed(`users/${ALICE}/private/settings`, {
      notificationPrefs: allPrefs(), updatedAt: Timestamp.now(),
    });
    await assertFails(updateDoc(settingsRef(ctx(ALICE), ALICE), {
      'notificationPrefs.dmMessages': false,
    }));
  });

  it('owner can read a missing settings doc (client falls back to enabled defaults)', async () => {
    await assertSucceeds(getDoc(settingsRef(ctx(ALICE), ALICE)));
  });
});

// ------------------------------------------- notifications (users/{uid}/notifications)
describe('notifications (users/{uid}/notifications)', () => {
  const notifRef = (db, uid, id = 'n1') => doc(db, 'users', uid, 'notifications', id);
  const validNotification = (overrides = {}) => ({
    type: 'dm_message',
    title: 'New message',
    body: 'see you at Helen C. White!',
    url: `/conversation/${convoId(ALICE, BOB)}`,
    actorId: BOB,
    conversationId: convoId(ALICE, BOB),
    createdAt: Timestamp.now(),
    readAt: null,
    expiresAt: futureTs(60 * 24),
    ...overrides,
  });

  it('owner can read own notifications (get and list)', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification());
    await assertSucceeds(getDoc(notifRef(ctx(ALICE), ALICE)));
    await assertSucceeds(getDocs(collection(ctx(ALICE), 'users', ALICE, 'notifications')));
  });

  it('non-owner cannot read or list notifications', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification());
    await assertFails(getDoc(notifRef(ctx(BOB), ALICE)));
    await assertFails(getDocs(collection(ctx(BOB), 'users', ALICE, 'notifications')));
  });

  it('clients cannot create notifications, even for themselves', async () => {
    await assertFails(setDoc(notifRef(ctx(ALICE), ALICE), validNotification()));
    await assertFails(setDoc(notifRef(ctx(MALLORY), ALICE), validNotification()));
  });

  it('owner can mark a notification read (readAt pinned to server time)', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification());
    await assertSucceeds(updateDoc(notifRef(ctx(ALICE), ALICE), {
      readAt: serverTimestamp(),
    }));
  });

  it('readAt transitions only once — a second mark-read is denied', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification({ readAt: Timestamp.now() }));
    await assertFails(updateDoc(notifRef(ctx(ALICE), ALICE), {
      readAt: serverTimestamp(),
    }));
  });

  it('rejects forged readAt values (arbitrary timestamp, un-read to null)', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification());
    await assertFails(updateDoc(notifRef(ctx(ALICE), ALICE), {
      readAt: Timestamp.fromMillis(0),
    }));
    await seed(`users/${ALICE}/notifications/n2`, validNotification({ readAt: Timestamp.now() }));
    await assertFails(updateDoc(notifRef(ctx(ALICE), ALICE, 'n2'), { readAt: null }));
  });

  it('no other field can be modified, alone or alongside readAt', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification());
    await assertFails(updateDoc(notifRef(ctx(ALICE), ALICE), {
      title: 'edited', readAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(notifRef(ctx(ALICE), ALICE), {
      url: '/session/other',
    }));
    await assertFails(updateDoc(notifRef(ctx(ALICE), ALICE), {
      expiresAt: futureTs(24 * 365), readAt: serverTimestamp(),
    }));
  });

  it('owner cannot delete notifications (no client dismiss; TTL expires them)', async () => {
    await seed(`users/${ALICE}/notifications/n1`, validNotification());
    await assertFails(deleteDoc(notifRef(ctx(ALICE), ALICE)));
  });

  it('owner can read a missing notification doc safely', async () => {
    await assertSucceeds(getDoc(notifRef(ctx(ALICE), ALICE, 'missing')));
  });
});

// ---------------------------------------------------------------- sessions
describe('sessions', () => {
  it('valid create succeeds', async () => {
    await assertSucceeds(
      createSessionWithRateLimit(ctx(ALICE), ALICE, 's1', validSession(ALICE))
    );
  });

  it('session create requires a fresh per-user rate-limit write', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'sessions', 's1'), validSession(ALICE)));

    await seed(`rateLimits/${ALICE}/actions/createSession`, { updatedAt: Timestamp.now() });
    await assertFails(
      createSessionWithRateLimit(ctx(ALICE), ALICE, 's2', validSession(ALICE))
    );
  });

  it('rejects forged hostId, stuffed participants, bad status, past start', async () => {
    await assertFails(createSessionWithRateLimit(ctx(MALLORY), MALLORY, 's1',
      validSession(ALICE)));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 's1',
      validSession(ALICE, { participantIds: [ALICE, BOB] })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 's1',
      validSession(ALICE, { status: 'full' })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 's1',
      validSession(ALICE, { startTime: Timestamp.fromMillis(Date.now() - 3600_000) })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 's1',
      validSession(ALICE, { startTime: futureTs(24 * 40) }))); // >31 days
  });

  it('self-join: succeeds on open future session; blocked by host-block', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 's1'), {
      participantIds: [ALICE, BOB],
      updatedAt: serverTimestamp(),
    }));
  });

  it('join rejected when cancelled, past, joining others, or blocked', async () => {
    const base = validSession(ALICE, { createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await seed('sessions/cancelled', { ...base, status: 'cancelled' });
    await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 'cancelled'), {
      participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
    }));

    await seed('sessions/past', {
      ...base,
      startTime: Timestamp.fromMillis(Date.now() - 7200_000),
      endTime: Timestamp.fromMillis(Date.now() - 3600_000),
    });
    await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 'past'), {
      participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
    }));

    await seed('sessions/s1', base);
    // Mallory tries to inject Bob:
    await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 's1'), {
      participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
    }));

    await seed(`userBlocks/${ALICE}__${BOB}`, {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 's1'), {
      participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
    }));
  });

  it('double-join no-op (updatedAt only) is allowed for existing participants', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      participantIds: [ALICE, BOB],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 's1'), {
      updatedAt: serverTimestamp(),
    }));
  });

  it('self-leave succeeds; removing someone else fails', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      participantIds: [ALICE, BOB],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 's1'), {
      participantIds: [ALICE], updatedAt: serverTimestamp(),
    }));
  });

  it('host can cancel and kick, cannot inject or transfer hostId', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      participantIds: [ALICE, BOB],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      status: 'cancelled', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      participantIds: [ALICE], updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      participantIds: [ALICE, MALLORY], updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      hostId: MALLORY, updatedAt: serverTimestamp(),
    }));
  });

  it('host edit revalidates times: no past start, ordered, max 12h', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    // Valid reschedule within the window:
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      startTime: futureTs(48), endTime: futureTs(50), updatedAt: serverTimestamp(),
    }));
    // Past startTime:
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      startTime: Timestamp.fromMillis(Date.now() - 3600_000),
      updatedAt: serverTimestamp(),
    }));
    // startTime beyond the 31-day window:
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      startTime: futureTs(24 * 40), endTime: futureTs(24 * 40 + 2),
      updatedAt: serverTimestamp(),
    }));
    // endTime before startTime:
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      endTime: futureTs(47), updatedAt: serverTimestamp(),
    }));
    // Duration over 12 hours:
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      endTime: futureTs(48 + 13), updatedAt: serverTimestamp(),
    }));
    // Non-timestamp times:
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      startTime: 'tomorrow', updatedAt: serverTimestamp(),
    }));
  });

  it('host edit revalidates status, title, and locationId', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      title: 'Moved to Memorial', locationId: 'memorial-library',
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      status: 'archived', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      title: '', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      title: 'T'.repeat(81), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      locationId: '', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      locationId: 'L'.repeat(61), updatedAt: serverTimestamp(),
    }));
    // Identity stays pinned:
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      classId: 'MATH 221', updatedAt: serverTimestamp(),
    }));
  });

  it('host can delete; others cannot', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(deleteDoc(doc(ctx(BOB), 'sessions', 's1')));
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'sessions', 's1')));
  });
});

// --------------------------------------------------------- session capacity
describe('session capacity', () => {
  const seededSession = (host, overrides = {}) =>
    validSession(host, {
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides,
    });

  it('create accepts capacity at and inside the 2–20 bounds', async () => {
    await assertSucceeds(createSessionWithRateLimit(ctx(ALICE), ALICE, 'c2',
      validSession(ALICE, { capacity: 2 })));
    await env.clearFirestore();
    await assertSucceeds(createSessionWithRateLimit(ctx(ALICE), ALICE, 'c8',
      validSession(ALICE, { capacity: 8 })));
    await env.clearFirestore();
    await assertSucceeds(createSessionWithRateLimit(ctx(ALICE), ALICE, 'c20',
      validSession(ALICE, { capacity: 20 })));
  });

  it('create without capacity stays valid (legacy unlimited shape)', async () => {
    await assertSucceeds(createSessionWithRateLimit(ctx(ALICE), ALICE, 's1',
      validSession(ALICE)));
  });

  it('create rejects out-of-range and non-int capacity', async () => {
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 'bad1',
      validSession(ALICE, { capacity: 1 })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 'bad2',
      validSession(ALICE, { capacity: 21 })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 'bad3',
      validSession(ALICE, { capacity: 2.5 })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 'bad4',
      validSession(ALICE, { capacity: 'eight' })));
    await assertFails(createSessionWithRateLimit(ctx(ALICE), ALICE, 'bad5',
      validSession(ALICE, { capacity: null })));
  });

  it('join succeeds below capacity, is denied at capacity', async () => {
    await seed('sessions/s1', seededSession(ALICE, { capacity: 3 }));
    await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 's1'), {
      participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
    }));
    // Bob took seat 2 of 3; Mallory takes the last one:
    await assertSucceeds(updateDoc(doc(ctx(MALLORY), 'sessions', 's1'), {
      participantIds: [ALICE, BOB, MALLORY], updatedAt: serverTimestamp(),
    }));
    // 3 of 3 seated — a fourth join must be rejected by rules alone:
    await assertFails(updateDoc(doc(ctx('daveUid'), 'sessions', 's1'), {
      participantIds: [ALICE, BOB, MALLORY, 'daveUid'], updatedAt: serverTimestamp(),
    }));
  });

  it('legacy session without capacity keeps unlimited joins', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      participantIds: [ALICE, BOB, MALLORY],
    }));
    await assertSucceeds(updateDoc(doc(ctx('daveUid'), 'sessions', 's1'), {
      participantIds: [ALICE, BOB, MALLORY, 'daveUid'], updatedAt: serverTimestamp(),
    }));
  });

  it('host can raise capacity or match the current count, never go below it', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      capacity: 4, participantIds: [ALICE, BOB, MALLORY],
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      capacity: 10, updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      capacity: 3, updatedAt: serverTimestamp(), // == current participant count
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      capacity: 2, updatedAt: serverTimestamp(), // below the 3 already seated
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      capacity: 21, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      capacity: 1, updatedAt: serverTimestamp(),
    }));
  });

  it('host kick + reduce in one update is judged on the post-state count', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      capacity: 4, participantIds: [ALICE, BOB, MALLORY],
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      participantIds: [ALICE, BOB], capacity: 2, updatedAt: serverTimestamp(),
    }));
  });

  it('host may drop the capacity field entirely (back to unlimited)', async () => {
    await seed('sessions/s1', seededSession(ALICE, { capacity: 2 }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      capacity: deleteField(), updatedAt: serverTimestamp(),
    }));
  });

  it('non-host cannot touch capacity', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      capacity: 4, participantIds: [ALICE, BOB],
    }));
    await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 's1'), {
      capacity: 20, updatedAt: serverTimestamp(),
    }));
  });

  it('two users competing for the final seat: exactly one transaction wins', async () => {
    await seed('sessions/s1', seededSession(ALICE, { capacity: 2 }));

    // Mirrors lib/firestore.ts joinSession: read, check the seat count,
    // claim atomically. The loser's retry re-reads a full session and aborts.
    const joinTx = (db, uid) =>
      runTransaction(db, async (tx) => {
        const snap = await tx.get(doc(db, 'sessions', 's1'));
        const data = snap.data();
        if (
          typeof data.capacity === 'number' &&
          data.participantIds.length >= data.capacity
        ) {
          throw new Error('session-full');
        }
        tx.update(doc(db, 'sessions', 's1'), {
          participantIds: arrayUnion(uid),
          updatedAt: serverTimestamp(),
        });
        return 'joined';
      });

    const [bobResult, malloryResult] = await Promise.allSettled([
      joinTx(ctx(BOB), BOB),
      joinTx(ctx(MALLORY), MALLORY),
    ]);

    const outcomes = [bobResult, malloryResult];
    const winners = outcomes.filter((r) => r.status === 'fulfilled');
    const losers = outcomes.filter((r) => r.status === 'rejected');
    assert.equal(winners.length, 1, 'exactly one join should win the last seat');
    assert.equal(losers.length, 1, 'the other join must be rejected');

    // The stored doc holds exactly capacity participants — never over-filled.
    await env.withSecurityRulesDisabled(async (c) => {
      const snap = await getDoc(doc(c.firestore(), 'sessions', 's1'));
      assert.equal(snap.data().participantIds.length, 2);
    });
  });
});

// ------------------------------------------------------------ conversations
describe('conversations + messages', () => {
  it('valid 2-person conversation at the deterministic id', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)),
        validConversation(ALICE, BOB))
    );
  });

  it('allows missing direct-conversation get without exposing existing conversations', async () => {
    const cid = convoId(ALICE, BOB);

    await assertSucceeds(getDoc(doc(ctx(ALICE), 'conversations', cid)));
    await assertFails(getDoc(doc(ctx(ALICE, { verified: false }), 'conversations', cid)));

    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });

    await assertSucceeds(getDoc(doc(ctx(ALICE), 'conversations', cid)));
    await assertFails(getDoc(doc(ctx(MALLORY), 'conversations', cid)));
    await assertFails(getDocs(collection(ctx(ALICE), 'conversations')));
    await assertSucceeds(
      getDocs(query(
        collection(ctx(ALICE), 'conversations'),
        where('participantIds', 'array-contains', ALICE)
      ))
    );
  });

  it('rejects forged timestamps on create', async () => {
    const future = Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)), {
      ...validConversation(ALICE, BOB), lastMessageAt: future,
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)), {
      ...validConversation(ALICE, BOB), createdAt: future,
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)), {
      ...validConversation(ALICE, BOB), updatedAt: Timestamp.fromMillis(0),
    }));
  });

  it('rejects wrong id, >2 people, third-party creation, blocked pairs', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', 'randomId'),
      validConversation(ALICE, BOB)));
    const three = validConversation(ALICE, BOB);
    three.participantIds = [ALICE, BOB, MALLORY].sort();
    await assertFails(setDoc(
      doc(ctx(ALICE), 'conversations', three.participantIds.join('__')), three));
    await assertFails(setDoc(doc(ctx(MALLORY), 'conversations', convoId(ALICE, BOB)),
      validConversation(ALICE, BOB)));
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)),
      validConversation(ALICE, BOB)));
  });

  it('participants cannot mutate participantIds; preview capped at 200', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertFails(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      participantIds: [ALICE, MALLORY].sort(),
      lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: 'x'.repeat(201),
      lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: 'hey', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('metadata bump requires the fresh sendMessage rate-limit write', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    // Bare update outside the send-message batch:
    await assertFails(updateDoc(doc(ctx(ALICE), 'conversations', cid), {
      lastMessagePreview: 'hey', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    // Stale rate-limit doc alone doesn't count either:
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(updateDoc(doc(ctx(ALICE), 'conversations', cid), {
      lastMessagePreview: 'hey', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    // Metadata timestamps must be server time (consistent with a real send):
    await assertFails(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: 'hey',
      lastMessageAt: Timestamp.fromMillis(Date.now() + 86_400_000),
      updatedAt: serverTimestamp(),
    }));
  });

  it('blocked participant cannot bump conversation preview/time', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });
    // Even with the fresh rate-limit write, the blocked pair cannot resurface
    // the thread — in either direction.
    await assertFails(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: 'still here', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateConversationWithRateLimit(ctx(BOB), BOB, cid, {
      lastMessagePreview: 'ping', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('full client send batch (message + metadata + rate limit) passes', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertSucceeds(clientSendFlow(ctx(ALICE), ALICE, cid, 'm1', 'study at 7?'));
    // Outsider can't run the same batch:
    await assertFails(clientSendFlow(ctx(MALLORY), MALLORY, cid, 'm2', 'intruder'));
  });

  it('client send flow for a max-length message: sliced preview passes, full text does not', async () => {
    // Regression: sendDirectMessage must write lastMessagePreview as
    // text.slice(0, 200) — a 2000-char message is a valid message but an
    // invalid preview, so the unsliced shape strands the conversation update.
    const cid = convoId(ALICE, BOB);
    const longText = 'x'.repeat(2000);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertSucceeds(createMessageWithRateLimit(ctx(ALICE), ALICE, cid, 'm1', {
      senderId: ALICE, text: longText, createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm1b'), {
      senderId: ALICE, text: 'missing rate limit', createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: longText, lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertSucceeds(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: longText.slice(0, 200), lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('messages: sender-only create, 1–2000 chars, block stops mid-thread', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertSucceeds(createMessageWithRateLimit(ctx(ALICE), ALICE, cid, 'm1', {
      senderId: ALICE, text: 'study at 7?', createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createMessageWithRateLimit(ctx(ALICE), ALICE, cid, 'm2', {
      senderId: BOB, text: 'spoofed', createdAt: serverTimestamp(),
    }));
    await assertFails(createMessageWithRateLimit(ctx(MALLORY), MALLORY, cid, 'm3', {
      senderId: MALLORY, text: 'intruder', createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createMessageWithRateLimit(ctx(ALICE), ALICE, cid, 'm4', {
      senderId: ALICE, text: 'x'.repeat(2001), createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, { updatedAt: Timestamp.now() });
    await assertFails(createMessageWithRateLimit(ctx(ALICE), ALICE, cid, 'm4b', {
      senderId: ALICE, text: 'too soon', createdAt: serverTimestamp(),
    }));
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });
    await seed(`rateLimits/${ALICE}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createMessageWithRateLimit(ctx(ALICE), ALICE, cid, 'm5', {
      senderId: ALICE, text: 'still here', createdAt: serverTimestamp(),
    }));
  });
});

// ------------------------------------------- session group chat (PR: group chat)
describe('session group chat (sessions/{sessionId}/messages)', () => {
  // ALICE hosts, BOB joined, MALLORY is outside the session.
  async function seedChatSession(sessionId = 's1', overrides = {}) {
    await seed(`sessions/${sessionId}`, validSession(ALICE, {
      participantIds: [ALICE, BOB],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides,
    }));
  }

  it('participants read and list messages; outsiders and unverified cannot', async () => {
    await seedChatSession();
    await seed('sessions/s1/messages/m1', {
      senderId: ALICE, text: 'front table', createdAt: Timestamp.now(),
    });

    await assertSucceeds(getDoc(doc(ctx(ALICE), 'sessions', 's1', 'messages', 'm1')));
    await assertSucceeds(getDocs(collection(ctx(BOB), 'sessions', 's1', 'messages')));
    await assertFails(getDoc(doc(ctx(MALLORY), 'sessions', 's1', 'messages', 'm1')));
    await assertFails(getDocs(collection(ctx(MALLORY), 'sessions', 's1', 'messages')));
    await assertFails(
      getDoc(doc(ctx(ALICE, { verified: false }), 'sessions', 's1', 'messages', 'm1'))
    );
  });

  it('participant (non-host too) sends with the fresh rate-limit batch', async () => {
    await seedChatSession();
    await assertSucceeds(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm1', {
      senderId: BOB, text: 'running 5 late', createdAt: serverTimestamp(),
    }));
    await assertSucceeds(createSessionChatMessage(ctx(ALICE), ALICE, 's1', 'm2', {
      senderId: ALICE, text: 'no rush', createdAt: serverTimestamp(),
    }));
  });

  it('send without the rate-limit batch is denied; too-soon resend is denied', async () => {
    await seedChatSession();
    await assertFails(setDoc(doc(ctx(BOB), 'sessions', 's1', 'messages', 'm1'), {
      senderId: BOB, text: 'no rate limit', createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${BOB}/actions/sendMessage`, { updatedAt: Timestamp.now() });
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm2', {
      senderId: BOB, text: 'too soon', createdAt: serverTimestamp(),
    }));
  });

  it('non-participants cannot send; sender spoofing is denied', async () => {
    await seedChatSession();
    await assertFails(createSessionChatMessage(ctx(MALLORY), MALLORY, 's1', 'm1', {
      senderId: MALLORY, text: 'intruder', createdAt: serverTimestamp(),
    }));
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm2', {
      senderId: ALICE, text: 'spoofed', createdAt: serverTimestamp(),
    }));
  });

  it('rejects extra keys, empty and oversized text, forged createdAt', async () => {
    await seedChatSession();
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm1', {
      senderId: BOB, senderName: 'Professor X', text: 'hi', createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${BOB}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm2', {
      senderId: BOB, text: '', createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${BOB}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm3', {
      senderId: BOB, text: 'x'.repeat(2001), createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${BOB}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm4', {
      senderId: BOB, text: 'forged clock',
      createdAt: Timestamp.fromMillis(Date.now() + 86_400_000),
    }));
  });

  it('messages are fully immutable — no client edits or deletes, even by the sender', async () => {
    await seedChatSession();
    await seed('sessions/s1/messages/m1', {
      senderId: BOB, text: 'original', createdAt: Timestamp.now(),
    });

    await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 's1', 'messages', 'm1'), {
      text: 'edited',
    }));
    await assertFails(deleteDoc(doc(ctx(BOB), 'sessions', 's1', 'messages', 'm1')));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'sessions', 's1', 'messages', 'm1')));
    await assertFails(deleteDoc(doc(ctx(MALLORY), 'sessions', 's1', 'messages', 'm1')));
  });

  it('cancellation makes the chat read-only for retained participants', async () => {
    await seedChatSession();
    // Before cancellation the participant can send…
    await assertSucceeds(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm1', {
      senderId: BOB, text: 'see you there', createdAt: serverTimestamp(),
    }));

    await seedChatSession('s1', { status: 'cancelled' });
    // …after it, the same participant (and the host) cannot send…
    await seed(`rateLimits/${BOB}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'm2', {
      senderId: BOB, text: 'anyone still going?', createdAt: serverTimestamp(),
    }));
    await assertFails(createSessionChatMessage(ctx(ALICE), ALICE, 's1', 'm3', {
      senderId: ALICE, text: 'sorry all', createdAt: serverTimestamp(),
    }));
    // …but retained participants keep the history, and outsiders still get nothing.
    await assertSucceeds(getDoc(doc(ctx(BOB), 'sessions', 's1', 'messages', 'm1')));
    await assertSucceeds(getDocs(collection(ctx(ALICE), 'sessions', 's1', 'messages')));
    await assertFails(getDoc(doc(ctx(MALLORY), 'sessions', 's1', 'messages', 'm1')));
    await assertFails(createSessionChatMessage(ctx(MALLORY), MALLORY, 's1', 'm4', {
      senderId: MALLORY, text: 'intruder', createdAt: serverTimestamp(),
    }));
  });

  it('fanout ceiling: exactly 20 participants can chat (legacy, no capacity field)', async () => {
    // validSession has no capacity — this is the legacy-uncapped shape.
    const twenty = [ALICE, BOB, ...Array.from({ length: 18 }, (_, i) => `filler${i}`)];
    await seedChatSession('s20', { participantIds: twenty });

    await assertSucceeds(createSessionChatMessage(ctx(ALICE), ALICE, 's20', 'm1', {
      senderId: ALICE, text: 'big group, still fine', createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDocs(collection(ctx(BOB), 'sessions', 's20', 'messages')));
  });

  it('fanout ceiling: 21 participants cannot send (legacy uncapped session)', async () => {
    const twentyOne = [ALICE, BOB, ...Array.from({ length: 19 }, (_, i) => `filler${i}`)];
    await seedChatSession('s21', { participantIds: twentyOne });

    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's21', 'm1', {
      senderId: BOB, text: 'too many of us', createdAt: serverTimestamp(),
    }));
    await assertFails(createSessionChatMessage(ctx(ALICE), ALICE, 's21', 'm2', {
      senderId: ALICE, text: 'host is capped too', createdAt: serverTimestamp(),
    }));
  });

  it('leaving the session ends read and send access', async () => {
    // Same shape as seedChatSession but BOB is no longer seated.
    await seed('sessions/s2', validSession(ALICE, {
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));
    await seed('sessions/s2/messages/m1', {
      senderId: ALICE, text: 'anyone here?', createdAt: Timestamp.now(),
    });

    await assertFails(getDoc(doc(ctx(BOB), 'sessions', 's2', 'messages', 'm1')));
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's2', 'm2', {
      senderId: BOB, text: 'i left but…', createdAt: serverTimestamp(),
    }));
  });
});

describe('chat read markers (users/{uid}/reads)', () => {
  const readRef = (db, uid, threadId = 's1') => doc(db, 'users', uid, 'reads', threadId);

  // Markers must point at a real thread the owner belongs to.
  async function seedOwnSession(sessionId = 's1', overrides = {}) {
    await seed(`sessions/${sessionId}`, validSession(BOB, {
      participantIds: [BOB, ALICE],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides,
    }));
  }

  it('owner marks a session thread they belong to, and can re-mark later', async () => {
    await seedOwnSession();
    await assertSucceeds(setDoc(readRef(ctx(ALICE), ALICE), {
      lastReadAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(readRef(ctx(ALICE), ALICE), {
      lastReadAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(readRef(ctx(ALICE), ALICE)));
  });

  it('owner marks a DM conversation thread they belong to', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertSucceeds(setDoc(readRef(ctx(ALICE), ALICE, cid), {
      lastReadAt: serverTimestamp(),
    }));
  });

  it('rejects junk thread ids that name no session or conversation', async () => {
    await assertFails(setDoc(readRef(ctx(ALICE), ALICE, 'no-such-thread'), {
      lastReadAt: serverTimestamp(),
    }));
  });

  it('rejects threads that do not include the owner', async () => {
    // A session ALICE is not part of…
    await seed('sessions/others', validSession(BOB, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(setDoc(readRef(ctx(ALICE), ALICE, 'others'), {
      lastReadAt: serverTimestamp(),
    }));
    // …and a conversation between two other people.
    const cid = convoId(BOB, MALLORY);
    await seed(`conversations/${cid}`, {
      ...validConversation(BOB, MALLORY),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertFails(setDoc(readRef(ctx(ALICE), ALICE, cid), {
      lastReadAt: serverTimestamp(),
    }));
  });

  it('rejects forged timestamps and extra keys', async () => {
    await seedOwnSession();
    await assertFails(setDoc(readRef(ctx(ALICE), ALICE), {
      lastReadAt: Timestamp.fromMillis(Date.now() + 86_400_000),
    }));
    await assertFails(setDoc(readRef(ctx(ALICE), ALICE), {
      lastReadAt: serverTimestamp(), sneaky: true,
    }));
  });

  it('only the owner reads or writes; delete is denied', async () => {
    await seedOwnSession();
    await seed(`users/${ALICE}/reads/s1`, { lastReadAt: Timestamp.now() });

    await assertFails(getDoc(readRef(ctx(BOB), ALICE)));
    await assertFails(setDoc(readRef(ctx(BOB), ALICE), { lastReadAt: serverTimestamp() }));
    await assertFails(deleteDoc(readRef(ctx(ALICE), ALICE)));
  });
});

describe('account deletion jobs (Admin SDK only)', () => {
  it('clients can never read or write deletion-job docs — not even their own', async () => {
    await seed(`accountDeletionJobs/${ALICE}`, {
      userId: ALICE, status: 'running', attemptCount: 1,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), requestedAt: Timestamp.now(),
    });

    await assertFails(getDoc(doc(ctx(ALICE), 'accountDeletionJobs', ALICE)));
    await assertFails(updateDoc(doc(ctx(ALICE), 'accountDeletionJobs', ALICE), {
      status: 'complete',
    }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'accountDeletionJobs', ALICE)));
    // Nobody can forge a job for themselves or anyone else.
    await assertFails(setDoc(doc(ctx(BOB), 'accountDeletionJobs', BOB), {
      userId: BOB, status: 'pending',
    }));
    await assertFails(setDoc(doc(ctx(MALLORY), 'accountDeletionJobs', ALICE), {
      userId: ALICE, status: 'failed',
    }));
  });
});

// ---------------------------------------------------------------- blocks
describe('locations (curated public data)', () => {
  it('readable by any signed-in user, including unverified', async () => {
    await seed('locations/college-library', { name: 'College Library', campusArea: 'Lakeshore' });
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'locations', 'college-library')));
    await assertSucceeds(
      getDoc(doc(ctx(BOB, { verified: false }), 'locations', 'college-library'))
    );
  });

  it('not readable signed-out; never client-writable', async () => {
    await seed('locations/college-library', { name: 'College Library', campusArea: 'Lakeshore' });
    await assertFails(
      getDoc(doc(env.unauthenticatedContext().firestore(), 'locations', 'college-library'))
    );
    await assertFails(updateDoc(doc(ctx(ALICE), 'locations', 'college-library'), {
      ratingCount: 9999,
    }));
  });
});

describe('userBlocks (D5: involved-party get, blocker-only list)', () => {
  it('blocker creates/reads/deletes; blocked party can get the doc naming them', async () => {
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`), {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`)));
    // Blocked side may probe the single doc that targets them (drives the
    // conversation screen's "messaging unavailable" state)…
    await assertSucceeds(getDoc(doc(ctx(BOB), 'userBlocks', `${ALICE}__${BOB}`)));
    // …but uninvolved users cannot, and nobody can list another's blocks.
    await assertFails(getDoc(doc(ctx(MALLORY), 'userBlocks', `${ALICE}__${BOB}`)));
    await assertFails(getDocs(query(
      collection(ctx(BOB), 'userBlocks'),
      where('blockedUserId', '==', BOB)
    )));
    await assertFails(setDoc(doc(ctx(MALLORY), 'userBlocks', `${ALICE}__${BOB}`), {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(ctx(BOB), 'userBlocks', `${ALICE}__${BOB}`)));
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`)));
  });

  it('blocker lists own blocks; involved get succeeds even when doc is absent', async () => {
    await seed(`userBlocks/${ALICE}__${BOB}`, {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: Timestamp.now(),
    });
    await assertSucceeds(getDocs(query(
      collection(ctx(ALICE), 'userBlocks'),
      where('blockerUserId', '==', ALICE)
    )));
    // The app probes `other__me` before knowing whether a block exists; the
    // get must be allowed (returning exists=false) rather than denied.
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'userBlocks', `${BOB}__${ALICE}`)));
  });

  it('cannot block yourself; id must match fields', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${ALICE}`), {
      blockerUserId: ALICE, blockedUserId: ALICE, createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'userBlocks', 'mismatched'), {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: serverTimestamp(),
    }));
  });
});

// ------------------------------------------------------------ friends (PR 6)
describe('friend requests (friendRequests/{from}__{to})', () => {
  const reqId = (from, to) => `${from}__${to}`;
  const seedUser = (uid) => seed(`users/${uid}`, { displayName: uid, classes: [] });

  // Mirrors sendFriendRequest in lib/friends.ts: request doc + friendRequest
  // rate-limit write in one batch.
  function sendRequest(db, uid, fromUid, toUid) {
    const batch = batchWithRateLimit(db, uid, 'friendRequest');
    batch.set(doc(db, 'friendRequests', reqId(fromUid, toUid)), {
      fromUid, toUid, createdAt: serverTimestamp(),
    });
    return batch.commit();
  }

  it('valid create succeeds with a fresh rate-limit write and a real target', async () => {
    await seedUser(BOB);
    await assertSucceeds(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));
  });

  it('requires the fresh rate-limit write', async () => {
    await seedUser(BOB);
    await assertFails(setDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB)), {
      fromUid: ALICE, toUid: BOB, createdAt: serverTimestamp(),
    }));
  });

  it('cannot friend yourself', async () => {
    await seedUser(ALICE);
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, ALICE));
  });

  it('rejects a forged fromUid', async () => {
    await seedUser(BOB);
    await assertFails(sendRequest(ctx(MALLORY), MALLORY, ALICE, BOB));
  });

  it('rejects a target user that does not exist', async () => {
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, 'ghostUid'));
  });

  it('rejects an id that does not match from__to', async () => {
    await seedUser(BOB);
    const db = ctx(ALICE);
    const batch = batchWithRateLimit(db, ALICE, 'friendRequest');
    batch.set(doc(db, 'friendRequests', 'wrongId'), {
      fromUid: ALICE, toUid: BOB, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('rejects a toUid that is not a safe [A-Za-z0-9] uid (unambiguous __ id)', async () => {
    // A uid containing `_` would make `from__to` ambiguous — denied at create.
    const unsafe = 'bad__uid';
    await seed(`users/${unsafe}`, { displayName: 'Weird', classes: [] });
    const db = ctx(ALICE);
    const batch = batchWithRateLimit(db, ALICE, 'friendRequest');
    batch.set(doc(db, 'friendRequests', `${ALICE}__${unsafe}`), {
      fromUid: ALICE, toUid: unsafe, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('rejects a reverse-duplicate request', async () => {
    await seedUser(ALICE);
    await seedUser(BOB);
    await seed(`friendRequests/${reqId(BOB, ALICE)}`, {
      fromUid: BOB, toUid: ALICE, createdAt: Timestamp.now(),
    });
    // Alice cannot send to Bob while Bob's request to Alice is pending.
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));
  });

  it('rejects a request to an existing friend', async () => {
    await seedUser(BOB);
    const ids = [ALICE, BOB].sort();
    await seed(`friendships/${ids.join('__')}`, {
      userIds: ids, acceptedBy: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));
  });

  it('rejects a blocked pair in either direction', async () => {
    await seedUser(BOB);
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));

    await env.clearFirestore();
    await seedUser(BOB);
    await seed(`userBlocks/${ALICE}__${BOB}`, {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));
  });

  it('only the two involved users can read a request; outsiders cannot', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB))));
    await assertSucceeds(getDoc(doc(ctx(BOB), 'friendRequests', reqId(ALICE, BOB))));
    await assertFails(getDoc(doc(ctx(MALLORY), 'friendRequests', reqId(ALICE, BOB))));
    // Recipient lists their incoming requests; an outsider cannot.
    await assertSucceeds(getDocs(query(
      collection(ctx(BOB), 'friendRequests'), where('toUid', '==', BOB)
    )));
    await assertFails(getDocs(query(
      collection(ctx(MALLORY), 'friendRequests'), where('toUid', '==', BOB)
    )));
  });

  it('outsiders cannot probe a MISSING request; pair members get exists=false', async () => {
    // No doc seeded — the get resolves against absence.
    // Pair members are allowed (client reads exists=false) …
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB))));
    await assertSucceeds(getDoc(doc(ctx(BOB), 'friendRequests', reqId(ALICE, BOB))));
    // … but an outsider is denied whether the doc exists or not, so "missing"
    // and "exists" are indistinguishable to them (no existence side channel).
    await assertFails(getDoc(doc(ctx(MALLORY), 'friendRequests', reqId(ALICE, BOB))));
  });

  it('rejects a malformed request id on get (no separator, >2 parts, empty/unsafe segments)', async () => {
    await assertFails(getDoc(doc(ctx(ALICE), 'friendRequests', 'no-separator')));
    await assertFails(
      getDoc(doc(ctx(ALICE), 'friendRequests', `${ALICE}__${BOB}__${MALLORY}`))
    );
    // Empty segments (`__x`, `x__`) and unsafe components are rejected.
    await assertFails(getDoc(doc(ctx(ALICE), 'friendRequests', `__${ALICE}`)));
    await assertFails(getDoc(doc(ctx(ALICE), 'friendRequests', `${ALICE}__`)));
  });

  it('a self-pair request id fails closed, even for that user, missing or not', async () => {
    // ALICE cannot get friendRequests/{ALICE__ALICE} — the two members must be
    // distinct, so a self-pair id is denied (no legitimate self-request exists).
    await assertFails(getDoc(doc(ctx(ALICE), 'friendRequests', `${ALICE}__${ALICE}`)));
    // A distinct pair the user belongs to still behaves as intended (exists=false).
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB))));
    // And an outsider is still denied a distinct missing pair.
    await assertFails(getDoc(doc(ctx(MALLORY), 'friendRequests', reqId(ALICE, BOB))));
  });

  it('requests are immutable (no update)', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(updateDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB)), {
      toUid: MALLORY,
    }));
  });

  it('sender cancels, recipient declines, outsider cannot delete', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(deleteDoc(doc(ctx(MALLORY), 'friendRequests', reqId(ALICE, BOB))));
    await assertSucceeds(deleteDoc(doc(ctx(BOB), 'friendRequests', reqId(ALICE, BOB))));
    // Re-seed and let the sender cancel.
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB))));
  });
});

describe('friendships (friendships/{sortedA}__{sortedB})', () => {
  const reqId = (from, to) => `${from}__${to}`;
  const pairId = (a, b) => [a, b].sort().join('__');

  // Mirrors acceptFriendRequest: delete the incoming request + create the
  // friendship in one batch (rules enforce the atomicity).
  function acceptBatch(db, recipient, sender) {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'friendRequests', reqId(sender, recipient)));
    const ids = [recipient, sender].sort();
    batch.set(doc(db, 'friendships', ids.join('__')), {
      userIds: ids, acceptedBy: recipient, createdAt: serverTimestamp(),
    });
    return batch.commit();
  }

  it('recipient accepts atomically (delete request + create friendship)', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    await assertSucceeds(acceptBatch(ctx(BOB), BOB, ALICE));
  });

  it('creating a friendship without deleting the request is denied', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    const ids = [ALICE, BOB].sort();
    await assertFails(setDoc(doc(ctx(BOB), 'friendships', ids.join('__')), {
      userIds: ids, acceptedBy: BOB, createdAt: serverTimestamp(),
    }));
  });

  it('creating a friendship with no request at all is denied', async () => {
    const ids = [ALICE, BOB].sort();
    await assertFails(setDoc(doc(ctx(BOB), 'friendships', ids.join('__')), {
      userIds: ids, acceptedBy: BOB, createdAt: serverTimestamp(),
    }));
  });

  it('the sender cannot accept their own request', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    // Alice (sender) tries to accept — the required doc is BOB__ALICE, which
    // does not exist, and deleting her own outgoing request doesn't satisfy it.
    const db = ctx(ALICE);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'friendRequests', reqId(ALICE, BOB)));
    const ids = [ALICE, BOB].sort();
    batch.set(doc(db, 'friendships', ids.join('__')), {
      userIds: ids, acceptedBy: ALICE, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('acceptedBy must be the caller and in the pair', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    const db = ctx(BOB);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'friendRequests', reqId(ALICE, BOB)));
    const ids = [ALICE, BOB].sort();
    batch.set(doc(db, 'friendships', ids.join('__')), {
      userIds: ids, acceptedBy: ALICE, createdAt: serverTimestamp(), // wrong accepter
    });
    await assertFails(batch.commit());
  });

  it('a blocked pair cannot become friends', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    await seed(`userBlocks/${ALICE}__${BOB}`, {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(acceptBatch(ctx(BOB), BOB, ALICE));
  });

  it('cannot block + delete request + create friendship in one batch', async () => {
    // The same-batch race: exists() sees no pre-batch block, so only the
    // existsAfter() check catches the block created alongside the accept.
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    const db = ctx(BOB);
    const batch = writeBatch(db);
    batch.set(doc(db, 'userBlocks', `${BOB}__${ALICE}`), {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'friendRequests', reqId(ALICE, BOB)));
    const ids = [ALICE, BOB].sort();
    batch.set(doc(db, 'friendships', ids.join('__')), {
      userIds: ids, acceptedBy: BOB, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('outsiders cannot probe a MISSING friendship; members get exists=false', async () => {
    const ids = [ALICE, BOB].sort();
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'friendships', ids.join('__'))));
    await assertSucceeds(getDoc(doc(ctx(BOB), 'friendships', ids.join('__'))));
    await assertFails(getDoc(doc(ctx(MALLORY), 'friendships', ids.join('__'))));
  });

  it('rejects a malformed friendship id on get', async () => {
    await assertFails(getDoc(doc(ctx(ALICE), 'friendships', 'no-separator')));
  });

  it('a self-pair friendship id fails closed, even for that user, missing or not', async () => {
    // ALICE cannot get friendships/{ALICE__ALICE} — members must be distinct.
    await assertFails(getDoc(doc(ctx(ALICE), 'friendships', `${ALICE}__${ALICE}`)));
    // A distinct pair the user belongs to still behaves as intended (exists=false).
    const ids = [ALICE, BOB].sort();
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'friendships', ids.join('__'))));
    // And an outsider is still denied the distinct missing pair.
    await assertFails(getDoc(doc(ctx(MALLORY), 'friendships', ids.join('__'))));
  });

  it('id must equal the sorted pair and hold exactly two distinct sorted uids', async () => {
    await seed(`friendRequests/${reqId(ALICE, BOB)}`, {
      fromUid: ALICE, toUid: BOB, createdAt: Timestamp.now(),
    });
    // Wrong doc id (unsorted / arbitrary).
    const db = ctx(BOB);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'friendRequests', reqId(ALICE, BOB)));
    batch.set(doc(db, 'friendships', 'not-the-pair'), {
      userIds: [ALICE, BOB].sort(), acceptedBy: BOB, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('only members read; outsiders cannot', async () => {
    const ids = [ALICE, BOB].sort();
    await seed(`friendships/${ids.join('__')}`, {
      userIds: ids, acceptedBy: BOB, createdAt: Timestamp.now(),
    });
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'friendships', ids.join('__'))));
    await assertSucceeds(getDocs(query(
      collection(ctx(ALICE), 'friendships'), where('userIds', 'array-contains', ALICE)
    )));
    await assertFails(getDoc(doc(ctx(MALLORY), 'friendships', ids.join('__'))));
    await assertFails(getDocs(query(
      collection(ctx(MALLORY), 'friendships'), where('userIds', 'array-contains', ALICE)
    )));
  });

  it('either friend can remove; a non-member cannot; no updates', async () => {
    const ids = [ALICE, BOB].sort();
    await seed(`friendships/${ids.join('__')}`, {
      userIds: ids, acceptedBy: BOB, createdAt: Timestamp.now(),
    });
    await assertFails(updateDoc(doc(ctx(ALICE), 'friendships', ids.join('__')), {
      acceptedBy: MALLORY,
    }));
    await assertFails(deleteDoc(doc(ctx(MALLORY), 'friendships', ids.join('__'))));
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'friendships', ids.join('__'))));
  });
});

// --------------------------------------------------------- location ratings
describe('locationRatings', () => {
  const validRating = (userId) => ({
    locationId: 'college-library',
    userId,
    stars: 5,
    tags: ['Quiet', 'Good WiFi'],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  it('owner creates a valid rating with a fresh rate-limit write', async () => {
    await assertSucceeds(
      setRatingWithRateLimit(
        ctx(ALICE),
        ALICE,
        `college-library__${ALICE}`,
        validRating(ALICE)
      )
    );
    await assertFails(
      setDoc(doc(ctx(ALICE), 'locationRatings', `college-library__${ALICE}`), validRating(ALICE))
    );
  });

  it('rating create/update is throttled per user', async () => {
    await seed(`rateLimits/${ALICE}/actions/locationRating`, { updatedAt: Timestamp.now() });
    await assertFails(
      setRatingWithRateLimit(
        ctx(ALICE),
        ALICE,
        `college-library__${ALICE}`,
        validRating(ALICE)
      )
    );
  });
});

// ---------------------------------------------------------------- reports
describe('reports (immutable, write-only)', () => {
  const valid = (reporter) => ({
    reporterUserId: reporter, reportedUserId: BOB, reason: 'Harassment',
    details: 'sent repeated unwanted messages', context: 'conversation',
    createdAt: serverTimestamp(),
  });

  it('reporter creates; nobody reads/updates/deletes', async () => {
    await assertSucceeds(createReportWithRateLimit(ctx(ALICE), ALICE, 'r1', valid(ALICE)));
    await assertFails(setDoc(doc(ctx(ALICE), 'reports', 'r1b'), valid(ALICE)));
    await assertFails(getDoc(doc(ctx(ALICE), 'reports', 'r1')));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'reports', 'r1')));
  });

  it('report create is throttled per reporter', async () => {
    await seed(`rateLimits/${ALICE}/actions/reportUser`, { updatedAt: Timestamp.now() });
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'r1', valid(ALICE)));
  });

  it('rejects spoofed reporter, bad reason, oversize details, self-report', async () => {
    await assertFails(createReportWithRateLimit(ctx(MALLORY), MALLORY, 'r2', valid(ALICE)));
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'r3',
      { ...valid(ALICE), reason: 'Just vibes' }));
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'r4',
      { ...valid(ALICE), details: 'x'.repeat(1001) }));
    await assertFails(createReportWithRateLimit(ctx(BOB), BOB, 'r5',
      { ...valid(BOB), reportedUserId: BOB }));
  });
});
