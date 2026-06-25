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
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
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
        classes: ['MATH 221'],
        createdAt: serverTimestamp(),
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

// ---------------------------------------------------------------- sessions
describe('sessions', () => {
  it('valid create succeeds', async () => {
    await assertSucceeds(
      setDoc(doc(ctx(ALICE), 'sessions', 's1'), validSession(ALICE))
    );
  });

  it('rejects forged hostId, stuffed participants, bad status, past start', async () => {
    await assertFails(setDoc(doc(ctx(MALLORY), 'sessions', 's1'),
      validSession(ALICE)));
    await assertFails(setDoc(doc(ctx(ALICE), 'sessions', 's1'),
      validSession(ALICE, { participantIds: [ALICE, BOB] })));
    await assertFails(setDoc(doc(ctx(ALICE), 'sessions', 's1'),
      validSession(ALICE, { status: 'full' })));
    await assertFails(setDoc(doc(ctx(ALICE), 'sessions', 's1'),
      validSession(ALICE, { startTime: Timestamp.fromMillis(Date.now() - 3600_000) })));
    await assertFails(setDoc(doc(ctx(ALICE), 'sessions', 's1'),
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

  it('host can delete; others cannot', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(deleteDoc(doc(ctx(BOB), 'sessions', 's1')));
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'sessions', 's1')));
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
    await seed(`conversations/${convoId(ALICE, BOB)}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertFails(updateDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)), {
      participantIds: [ALICE, MALLORY].sort(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)), {
      lastMessagePreview: 'x'.repeat(201), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)), {
      lastMessagePreview: 'hey', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
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
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm1'), {
      senderId: ALICE, text: longText, createdAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(ALICE), 'conversations', cid), {
      lastMessagePreview: longText, lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'conversations', cid), {
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
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm1'), {
      senderId: ALICE, text: 'study at 7?', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm2'), {
      senderId: BOB, text: 'spoofed', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(MALLORY), 'conversations', cid, 'messages', 'm3'), {
      senderId: MALLORY, text: 'intruder', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm4'), {
      senderId: ALICE, text: 'x'.repeat(2001), createdAt: serverTimestamp(),
    }));
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm5'), {
      senderId: ALICE, text: 'still here', createdAt: serverTimestamp(),
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

describe('userBlocks (D5: blocker-only visibility)', () => {
  it('blocker creates/reads/deletes; blocked party cannot read', async () => {
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`), {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`)));
    await assertFails(getDoc(doc(ctx(BOB), 'userBlocks', `${ALICE}__${BOB}`)));
    await assertFails(setDoc(doc(ctx(MALLORY), 'userBlocks', `${ALICE}__${BOB}`), {
      blockerUserId: ALICE, blockedUserId: BOB, createdAt: serverTimestamp(),
    }));
    await assertSucceeds(deleteDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`)));
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

// ---------------------------------------------------------------- reports
describe('reports (immutable, write-only)', () => {
  const valid = (reporter) => ({
    reporterUserId: reporter, reportedUserId: BOB, reason: 'Harassment',
    details: 'sent repeated unwanted messages', context: 'conversation',
    createdAt: serverTimestamp(),
  });

  it('reporter creates; nobody reads/updates/deletes', async () => {
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'reports', 'r1'), valid(ALICE)));
    await assertFails(getDoc(doc(ctx(ALICE), 'reports', 'r1')));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'reports', 'r1')));
  });

  it('rejects spoofed reporter, bad reason, oversize details, self-report', async () => {
    await assertFails(setDoc(doc(ctx(MALLORY), 'reports', 'r2'), valid(ALICE)));
    await assertFails(setDoc(doc(ctx(ALICE), 'reports', 'r3'),
      { ...valid(ALICE), reason: 'Just vibes' }));
    await assertFails(setDoc(doc(ctx(ALICE), 'reports', 'r4'),
      { ...valid(ALICE), details: 'x'.repeat(1001) }));
    await assertFails(setDoc(doc(ctx(BOB), 'reports', 'r5'),
      { ...valid(BOB), reportedUserId: BOB }));
  });
});
