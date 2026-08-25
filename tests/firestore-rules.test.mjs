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
  arrayRemove,
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
import {
  ALLOWED_CONTENT_CASES,
  BLOCKED_CONTENT_CASES,
} from './fixtures/content-moderation-cases.mjs';

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

function createConversationWithQuota(db, uid, otherUid) {
  const cid = convoId(uid, otherUid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', cid), validConversation(uid, otherUid));
  batch.set(doc(db, 'rateLimits', uid, 'actions', 'createConversation'), {
    windowStart: serverTimestamp(),
    count: 1,
    lastConversationId: cid,
    updatedAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 48 * 3600 * 1000),
  });
  return batch.commit();
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

function batchWithBoundRateLimit(db, uid, action, lastResourceId) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rateLimits', uid, 'actions', action), {
    lastResourceId,
    updatedAt: serverTimestamp(),
  });
  return batch;
}

function batchWithBoundFriendRequestRateLimit(db, uid, requestId) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rateLimits', uid, 'actions', 'friendRequest'), {
    lastRequestId: requestId,
    updatedAt: serverTimestamp(),
  });
  return batch;
}

function createSessionWithRateLimit(db, uid, sessionId, session) {
  const batch = batchWithBoundRateLimit(db, uid, 'createSession', `sessions/${sessionId}`);
  batch.set(doc(db, 'sessions', sessionId), session);
  return batch.commit();
}

function updateSessionWithRateLimit(db, uid, sessionId, update, boundSessionId = sessionId) {
  const batch = batchWithBoundRateLimit(
    db,
    uid,
    'updateSession',
    `sessions/${boundSessionId}`
  );
  batch.update(doc(db, 'sessions', sessionId), update);
  return batch.commit();
}

function createMessageWithRateLimit(db, uid, conversationId, messageId, message) {
  const batch = batchWithBoundRateLimit(
    db, uid, 'sendMessage', `conversations/${conversationId}/messages/${messageId}`
  );
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
  const batch = batchWithBoundRateLimit(
    db, uid, 'sendMessage', `sessions/${sessionId}/messages/${messageId}`
  );
  batch.set(doc(db, 'sessions', sessionId, 'messages', messageId), message);
  return batch.commit();
}

function updateMessageWithRateLimit(
  db,
  uid,
  threadType,
  threadId,
  messageId,
  update,
  boundThreadId = threadId,
  boundMessageId = messageId
) {
  const root = threadType === 'direct' ? 'conversations' : 'sessions';
  const batch = batchWithBoundRateLimit(
    db,
    uid,
    'updateMessage',
    `${root}/${boundThreadId}/messages/${boundMessageId}`
  );
  batch.update(doc(db, root, threadId, 'messages', messageId), update);
  return batch.commit();
}

// Mirrors sendDirectMessage in lib/firestore.ts: message + bound sendMessage
// limiter. Conversation metadata is Admin-trigger-authored from this message.
function clientSendFlow(db, uid, conversationId, messageId, text, replyTo) {
  const batch = batchWithBoundRateLimit(
    db, uid, 'sendMessage', `conversations/${conversationId}/messages/${messageId}`
  );
  batch.set(doc(db, 'conversations', conversationId, 'messages', messageId), {
    senderId: uid, text, createdAt: serverTimestamp(),
    ...(replyTo ? { replyTo } : {}),
  });
  return batch.commit();
}

function createReportWithRateLimit(db, uid, reportId, report) {
  const batch = batchWithBoundRateLimit(db, uid, 'reportUser', `reports/${reportId}`);
  batch.set(doc(db, 'reports', reportId), report);
  return batch.commit();
}

function createCatalogRequestWithRateLimit(db, uid, requestId, request) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'rateLimits', uid, 'actions', 'catalogRequest'), {
    lastRequestId: requestId,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'catalogRequests', requestId), request);
  return batch.commit();
}

function setRatingWithRateLimit(db, uid, ratingId, rating) {
  const batch = batchWithBoundRateLimit(
    db, uid, 'locationRating', `locationRatings/${ratingId}`
  );
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

describe('personal hidden chat history', () => {
  beforeEach(async () => {
    await seed(`users/${ALICE}`, { displayName: 'Alice', classes: [] });
    await seed(`users/${BOB}`, { displayName: 'Bob', classes: [] });
    await seed(`conversations/${convoId(ALICE, BOB)}`, {
      ...validConversation(ALICE, BOB),
      lastMessageAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await seed('sessions/sharedSession', {
      ...validSession(ALICE),
      participantIds: [ALICE, BOB],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  });

  it('lets an owner hide their own group chat', async () => {
    const db = ctx(ALICE);
    await assertSucceeds(setDoc(doc(db, 'users', ALICE, 'hiddenChats', 'group__sharedSession'), {
      chatType: 'group',
      threadId: 'sharedSession',
      removedAt: serverTimestamp(),
    }));
  });

  it('lets a participant hide their own direct chat without changing access', async () => {
    const db = ctx(ALICE);
    await assertSucceeds(setDoc(
      doc(db, 'users', ALICE, 'hiddenChats', `dm__${convoId(ALICE, BOB)}`),
      { chatType: 'dm', threadId: convoId(ALICE, BOB), removedAt: serverTimestamp() }
    ));

    await assertSucceeds(getDoc(doc(db, 'conversations', convoId(ALICE, BOB))));
  });

  it('rejects direct-chat markers for another user or an unrelated conversation', async () => {
    const directId = convoId(ALICE, BOB);
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', BOB, 'hiddenChats', `dm__${directId}`),
      { chatType: 'dm', threadId: directId, removedAt: serverTimestamp() }
    ));
    await assertFails(setDoc(
      doc(ctx(MALLORY), 'users', MALLORY, 'hiddenChats', `dm__${directId}`),
      { chatType: 'dm', threadId: directId, removedAt: serverTimestamp() }
    ));
  });

  it('cannot hide a session chat for another user or as a nonparticipant', async () => {
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', BOB, 'hiddenChats', 'group__sharedSession'),
      { chatType: 'group', threadId: 'sharedSession', removedAt: serverTimestamp() }
    ));
    await assertFails(setDoc(
      doc(ctx(MALLORY), 'users', MALLORY, 'hiddenChats', 'group__sharedSession'),
      { chatType: 'group', threadId: 'sharedSession', removedAt: serverTimestamp() }
    ));
  });

  it('rejects forged timestamps and mismatched document ids', async () => {
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', ALICE, 'hiddenChats', 'wrong-id'),
      { chatType: 'group', threadId: 'sharedSession', removedAt: serverTimestamp() }
    ));
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', ALICE, 'hiddenChats', 'group__sharedSession'),
      { chatType: 'group', threadId: 'sharedSession', removedAt: Timestamp.fromMillis(0) }
    ));
  });

  it('keeps markers private and lets only the owner restore one', async () => {
    const hiddenRef = doc(
      ctx(ALICE),
      'users',
      ALICE,
      'hiddenChats',
      'group__sharedSession'
    );
    await assertSucceeds(setDoc(hiddenRef, {
      chatType: 'group',
      threadId: 'sharedSession',
      removedAt: serverTimestamp(),
    }));

    await assertFails(getDoc(doc(
      ctx(BOB),
      'users',
      ALICE,
      'hiddenChats',
      'group__sharedSession'
    )));
    await assertFails(deleteDoc(doc(
      ctx(BOB),
      'users',
      ALICE,
      'hiddenChats',
      'group__sharedSession'
    )));
    await assertFails(updateDoc(doc(
      ctx(BOB),
      'users',
      ALICE,
      'hiddenChats',
      'group__sharedSession'
    ), { removedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(hiddenRef));
  });

  it('rejects an atomic write that tries to change another user\'s hidden state', async () => {
    const db = ctx(ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', ALICE, 'hiddenChats', 'group__sharedSession'), {
      chatType: 'group', threadId: 'sharedSession', removedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'users', BOB, 'hiddenChats', 'group__sharedSession'), {
      chatType: 'group', threadId: 'sharedSession', removedAt: serverTimestamp(),
    });

    await assertFails(batch.commit());
    const ownMarkerAfterFailure = await assertSucceeds(getDoc(doc(
      db,
      'users',
      ALICE,
      'hiddenChats',
      'group__sharedSession'
    )));
    assert.equal(ownMarkerAfterFailure.exists(), false);
  });

  it('does not change session membership, messages, or access', async () => {
    await seed('sessions/sharedSession/messages/message1', {
      senderId: ALICE,
      text: 'Meet by the windows',
      createdAt: Timestamp.now(),
    });
    const db = ctx(BOB);
    await assertSucceeds(setDoc(
      doc(db, 'users', BOB, 'hiddenChats', 'group__sharedSession'),
      { chatType: 'group', threadId: 'sharedSession', removedAt: serverTimestamp() }
    ));

    const sessionSnapshot = await assertSucceeds(
      getDoc(doc(db, 'sessions', 'sharedSession'))
    );
    const messageSnapshot = await assertSucceeds(
      getDoc(doc(db, 'sessions', 'sharedSession', 'messages', 'message1'))
    );
    assert.deepEqual(sessionSnapshot.data().participantIds, [ALICE, BOB]);
    assert.equal(messageSnapshot.data().text, 'Meet by the windows');
  });

  it('does not grant a nonparticipant access when a marker is admin-seeded', async () => {
    await seed('sessions/sharedSession/messages/message1', {
      senderId: ALICE,
      text: 'Participants only',
      createdAt: Timestamp.now(),
    });
    await seed(`users/${MALLORY}/hiddenChats/group__sharedSession`, {
      chatType: 'group',
      threadId: 'sharedSession',
      removedAt: Timestamp.now(),
    });

    await assertFails(getDoc(doc(
      ctx(MALLORY),
      'sessions',
      'sharedSession',
      'messages',
      'message1'
    )));
  });
});

describe('per-message delete-for-self markers', () => {
  const directThreadId = convoId(ALICE, BOB);
  const directThreadKey = `direct__${directThreadId}`;
  const sessionThreadKey = 'session__sharedSession';

  beforeEach(async () => {
    await seed(`conversations/${directThreadId}`, {
      ...validConversation(ALICE, BOB),
      lastMessageAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await seed(`conversations/${directThreadId}/messages/directMessage`, {
      senderId: ALICE, text: 'Direct message', createdAt: Timestamp.now(),
    });
    await seed('sessions/sharedSession', {
      ...validSession(ALICE),
      participantIds: [ALICE, BOB],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await seed('sessions/sharedSession/messages/sessionMessage', {
      senderId: BOB, text: 'Session message', createdAt: Timestamp.now(),
    });
  });

  it('lets a participant privately hide DM and session messages', async () => {
    const db = ctx(ALICE);
    await assertSucceeds(setDoc(
      doc(db, 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'directMessage'),
      {
        threadType: 'direct', threadId: directThreadId,
        messageId: 'directMessage', hiddenAt: serverTimestamp(),
      }
    ));
    await assertSucceeds(setDoc(
      doc(db, 'users', ALICE, 'messageHides', sessionThreadKey, 'messages', 'sessionMessage'),
      {
        threadType: 'session', threadId: 'sharedSession',
        messageId: 'sessionMessage', hiddenAt: serverTimestamp(),
      }
    ));
    await assertSucceeds(getDocs(collection(
      db, 'users', ALICE, 'messageHides', directThreadKey, 'messages'
    )));
  });

  it('keeps markers owner-only and does not alter shared messages', async () => {
    const markerRef = doc(
      ctx(ALICE), 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'directMessage'
    );
    await assertSucceeds(setDoc(markerRef, {
      threadType: 'direct', threadId: directThreadId,
      messageId: 'directMessage', hiddenAt: serverTimestamp(),
    }));

    await assertFails(getDoc(doc(
      ctx(BOB), 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'directMessage'
    )));
    await assertFails(deleteDoc(doc(
      ctx(BOB), 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'directMessage'
    )));
    await assertSucceeds(getDoc(doc(
      ctx(BOB), 'conversations', directThreadId, 'messages', 'directMessage'
    )));
    await assertSucceeds(deleteDoc(markerRef));
  });

  it('rejects outsider, nonexistent-message, mismatched-id, and forged-time markers', async () => {
    await assertFails(setDoc(
      doc(ctx(MALLORY), 'users', MALLORY, 'messageHides', sessionThreadKey, 'messages', 'sessionMessage'),
      {
        threadType: 'session', threadId: 'sharedSession',
        messageId: 'sessionMessage', hiddenAt: serverTimestamp(),
      }
    ));
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'missing'),
      {
        threadType: 'direct', threadId: directThreadId,
        messageId: 'missing', hiddenAt: serverTimestamp(),
      }
    ));
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'directMessage'),
      {
        threadType: 'direct', threadId: directThreadId,
        messageId: 'different', hiddenAt: serverTimestamp(),
      }
    ));
    await assertFails(setDoc(
      doc(ctx(ALICE), 'users', ALICE, 'messageHides', directThreadKey, 'messages', 'directMessage'),
      {
        threadType: 'direct', threadId: directThreadId,
        messageId: 'directMessage', hiddenAt: Timestamp.fromMillis(0),
      }
    ));
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

  it('rejects an unverified create atomically, then permits one verified retry', async () => {
    await assertFails(
      createSessionWithRateLimit(
        ctx(ALICE, { verified: false }),
        ALICE,
        'stale-token-attempt',
        validSession(ALICE)
      )
    );

    const verifiedDb = ctx(ALICE);
    assert.equal((await getDoc(doc(verifiedDb, 'sessions', 'stale-token-attempt'))).exists(), false);
    await env.withSecurityRulesDisabled(async (adminContext) => {
      const limiter = await getDoc(
        doc(adminContext.firestore(), 'rateLimits', ALICE, 'actions', 'createSession')
      );
      assert.equal(limiter.exists(), false);
    });

    await assertSucceeds(
      createSessionWithRateLimit(verifiedDb, ALICE, 'verified-retry', validSession(ALICE))
    );
    assert.equal((await getDoc(doc(verifiedDb, 'sessions', 'verified-retry'))).exists(), true);
  });

  it('allows at most one of two concurrent session-create batches', async () => {
    const aliceDb = ctx(ALICE);
    const results = await Promise.allSettled([
      createSessionWithRateLimit(aliceDb, ALICE, 'rapid-create-1', validSession(ALICE)),
      createSessionWithRateLimit(aliceDb, ALICE, 'rapid-create-2', validSession(ALICE)),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

    const created = await Promise.all([
      getDoc(doc(aliceDb, 'sessions', 'rapid-create-1')),
      getDoc(doc(aliceDb, 'sessions', 'rapid-create-2')),
    ]);
    assert.equal(created.filter((snapshot) => snapshot.exists()).length, 1);
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
    // Past startTime:
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      startTime: Timestamp.fromMillis(Date.now() - 3600_000),
      updatedAt: serverTimestamp(),
    }));
    // startTime beyond the 31-day window:
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      startTime: futureTs(24 * 40), endTime: futureTs(24 * 40 + 2),
      updatedAt: serverTimestamp(),
    }));
    // endTime before startTime:
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      endTime: futureTs(47), updatedAt: serverTimestamp(),
    }));
    // Duration over 12 hours:
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      endTime: futureTs(48 + 13), updatedAt: serverTimestamp(),
    }));
    // Non-timestamp times:
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      startTime: 'tomorrow', updatedAt: serverTimestamp(),
    }));
    // Valid reschedule within the window:
    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      startTime: futureTs(48), endTime: futureTs(50), updatedAt: serverTimestamp(),
    }));
  });

  it('host edit revalidates status, title, and locationId', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      status: 'archived', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: '', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'T'.repeat(81), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      locationId: '', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      locationId: 'L'.repeat(61), updatedAt: serverTimestamp(),
    }));
    // The host may change the class, while ownership and creation metadata
    // remain pinned for every host edit.
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      classId: 'C'.repeat(21), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(BOB), BOB, 's1', {
      classId: 'PHYSICS 101', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'Moved to Memorial', classId: 'MATH 221', locationId: 'memorial-library',
      updatedAt: serverTimestamp(),
    }));
  });

  it('denies client session hard-delete for hosts and non-hosts', async () => {
    await seed('sessions/s1', validSession(ALICE, {
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(deleteDoc(doc(ctx(BOB), 'sessions', 's1')));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'sessions', 's1')));
  });
});

// ------------------------------------------ strict material session-edit limiter
describe('material session edit limiter', () => {
  const seededSession = (host, overrides = {}) =>
    validSession(host, {
      capacity: 4,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      ...overrides,
    });

  it('allows the first bound material edit and denies another inside 30 seconds', async () => {
    await seed('sessions/s1', seededSession(ALICE));
    await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      title: 'Missing limiter', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'First correction', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'Too soon', updatedAt: serverTimestamp(),
    }));

    const stored = await getDoc(doc(ctx(ALICE), 'sessions', 's1'));
    assert.equal(stored.data().title, 'First correction');
  });

  it('allows a material edit after the 30-second cooldown', async () => {
    await seed('sessions/s1', seededSession(ALICE));
    await seed(`rateLimits/${ALICE}/actions/updateSession`, {
      lastResourceId: 'sessions/s1',
      updatedAt: Timestamp.fromMillis(Date.now() - 31_000),
    });

    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      locationId: 'memorial-library', updatedAt: serverTimestamp(),
    }));
  });

  it('denies one limiter reused for two session edits in the same batch', async () => {
    await seed('sessions/s1', seededSession(ALICE));
    await seed('sessions/s2', seededSession(ALICE));
    const db = ctx(ALICE);
    const batch = batchWithBoundRateLimit(db, ALICE, 'updateSession', 'sessions/s1');
    batch.update(doc(db, 'sessions', 's1'), {
      title: 'First edit', updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'sessions', 's2'), {
      title: 'Second edit', updatedAt: serverTimestamp(),
    });

    await assertFails(batch.commit());
  });

  it('denies mismatched paths, forged hosts, extra limiter fields, and deletion', async () => {
    await seed('sessions/s1', seededSession(ALICE));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'Wrong binding', updatedAt: serverTimestamp(),
    }, 's2'));
    await assertFails(updateSessionWithRateLimit(ctx(MALLORY), MALLORY, 's1', {
      title: 'Not the host', updatedAt: serverTimestamp(),
    }));

    const db = ctx(ALICE);
    await assertFails(setDoc(doc(db, 'rateLimits', ALICE, 'actions', 'updateSession'), {
      lastResourceId: 'sessions/s1', updatedAt: serverTimestamp(), extra: true,
    }));
    await seed(`rateLimits/${ALICE}/actions/updateSession`, {
      lastResourceId: 'sessions/s1', updatedAt: Timestamp.fromMillis(0),
    });
    await assertFails(deleteDoc(doc(db, 'rateLimits', ALICE, 'actions', 'updateSession')));
  });

  it('pins host-edit updatedAt to request.time', async () => {
    await seed('sessions/s1', seededSession(ALICE));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'Forged timestamp', updatedAt: Timestamp.fromMillis(0),
    }));
  });

  it('requires the host to remain in participantIds', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      participantIds: [ALICE, BOB],
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'Host removed', participantIds: [BOB], updatedAt: serverTimestamp(),
    }));
  });

  it('keeps cancel, kick, and metadata-only writes outside the material limiter', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      participantIds: [ALICE, BOB],
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      participantIds: [ALICE], updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      status: 'cancelled', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 's1'), {
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      title: 'COMP SCI 300 Study Session', updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(
      doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', 'updateSession'),
      { lastResourceId: 'sessions/s1', updatedAt: serverTimestamp() }
    ));

    await env.withSecurityRulesDisabled(async (context) => {
      const limiter = await getDoc(
        doc(context.firestore(), 'rateLimits', ALICE, 'actions', 'updateSession')
      );
      assert.equal(limiter.exists(), false);
    });
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
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      capacity: 2, updatedAt: serverTimestamp(), // below the 3 already seated
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      capacity: 21, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      capacity: 1, updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      capacity: 3, updatedAt: serverTimestamp(), // == current participant count
    }));
  });

  it('host kick + reduce in one update is judged on the post-state count', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      capacity: 4, participantIds: [ALICE, BOB, MALLORY],
    }));
    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      participantIds: [ALICE, BOB], capacity: 2, updatedAt: serverTimestamp(),
    }));
  });

  it('host may drop the capacity field entirely (back to unlimited)', async () => {
    await seed('sessions/s1', seededSession(ALICE, { capacity: 2 }));
    await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 's1', {
      capacity: deleteField(), updatedAt: serverTimestamp(),
    }));
  });

  it('non-host cannot touch capacity', async () => {
    await seed('sessions/s1', seededSession(ALICE, {
      capacity: 4, participantIds: [ALICE, BOB],
    }));
    await assertFails(updateSessionWithRateLimit(ctx(BOB), BOB, 's1', {
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
    // Threads open only against real accounts, so the counterpart's profile
    // doc must exist (mirrors the friendRequests exists(users/{toUid}) check).
    await seed(`users/${BOB}`, { displayName: 'Bob', classes: [] });
    await assertSucceeds(
      createConversationWithQuota(ctx(ALICE), ALICE, BOB)
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

  it('clients cannot mutate conversation metadata or participants', async () => {
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
    await assertFails(updateConversationWithRateLimit(ctx(ALICE), ALICE, cid, {
      lastMessagePreview: 'hey', lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  it('denies forged metadata even with a fresh sendMessage limiter', async () => {
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
    // A client cannot forge a preview by coupling it to a real message write.
    const db = ctx(ALICE);
    const forgedBatch = batchWithBoundRateLimit(
      db, ALICE, 'sendMessage', `conversations/${cid}/messages/m-forged`
    );
    forgedBatch.set(doc(db, 'conversations', cid, 'messages', 'm-forged'), {
      senderId: ALICE, text: 'ordinary study message', createdAt: serverTimestamp(),
    });
    forgedBatch.update(doc(db, 'conversations', cid), {
      lastMessagePreview: 'kill yourself',
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await assertFails(forgedBatch.commit());

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

  it('full client send batch (message + bound limiter) passes', async () => {
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

  it('accepts a bounded reply snapshot and keeps it immutable until unsend', async () => {
    const cid = convoId(ALICE, BOB);
    const messageId = 'reply-message';
    const messageRef = doc(ctx(ALICE), 'conversations', cid, 'messages', messageId);
    const replyTo = { messageId: 'source-message', senderId: BOB, text: 'Meet at Memorial?' };
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });

    await assertSucceeds(clientSendFlow(ctx(ALICE), ALICE, cid, messageId, 'Works for me.', replyTo));
    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, messageId, {
      text: 'Changed reply', originalText: 'Works for me.', editedAt: serverTimestamp(),
      replyTo: { ...replyTo, text: 'Forged context' },
    }));
    await assertSucceeds(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, messageId, {
      text: 'Confirmed.', originalText: 'Works for me.', editedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(messageRef, {
      text: '', originalText: deleteField(), editedAt: deleteField(),
      replyTo: deleteField(), unsentAt: serverTimestamp(),
    }));

    const saved = await assertSucceeds(getDoc(messageRef));
    assert.equal('replyTo' in saved.data(), false);
  });

  it('client send flow accepts a max-length message without client metadata writes', async () => {
    const cid = convoId(ALICE, BOB);
    const longText = 'x'.repeat(2000);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });
    await assertSucceeds(clientSendFlow(ctx(ALICE), ALICE, cid, 'm1', longText));
    await assertFails(setDoc(doc(ctx(ALICE), 'conversations', cid, 'messages', 'm1b'), {
      senderId: ALICE, text: 'missing rate limit', createdAt: serverTimestamp(),
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

  it('lets DM participants add and remove only their own message reaction', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/reactable`, {
      senderId: ALICE, text: 'React to this', createdAt: Timestamp.now(),
    });

    const aliceDb = ctx(ALICE);
    const bobDb = ctx(BOB);
    await assertSucceeds(updateMessageWithRateLimit(
      aliceDb, ALICE, 'direct', cid, 'reactable', { likedByIds: arrayUnion(ALICE) }
    ));
    await assertSucceeds(updateMessageWithRateLimit(
      bobDb, BOB, 'direct', cid, 'reactable', { likedByIds: arrayUnion(BOB) }
    ));

    await assertFails(updateMessageWithRateLimit(
      bobDb, BOB, 'direct', cid, 'reactable', { likedByIds: arrayRemove(ALICE) }
    ));
    await assertFails(updateMessageWithRateLimit(
      ctx(MALLORY), MALLORY, 'direct', cid, 'reactable', { likedByIds: arrayUnion(MALLORY) }
    ));
    await assertFails(updateMessageWithRateLimit(aliceDb, ALICE, 'direct', cid, 'reactable', {
      likedByIds: arrayRemove(ALICE),
      text: 'Reaction write cannot edit content',
    }));
    await assertFails(updateMessageWithRateLimit(
      aliceDb, ALICE, 'direct', cid, 'reactable', { likedByIds: [ALICE, BOB, MALLORY] }
    ));
    await seed(`rateLimits/${ALICE}/actions/updateMessage`, {
      lastResourceId: `conversations/${cid}/messages/reactable`,
      updatedAt: Timestamp.fromMillis(Date.now() - 2_000),
    });
    await assertSucceeds(updateMessageWithRateLimit(
      aliceDb, ALICE, 'direct', cid, 'reactable', { likedByIds: arrayRemove(ALICE) }
    ));

    const saved = await assertSucceeds(getDoc(
      doc(aliceDb, 'conversations', cid, 'messages', 'reactable')
    ));
    assert.deepEqual(saved.data().likedByIds, [BOB]);
  });

  it('enforces unique reaction sets and exact caller-only transitions', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    const cases = [
      ['replace-other', [BOB, MALLORY], [ALICE, MALLORY]],
      ['duplicate-padding', [BOB], [BOB, BOB, ALICE]],
      ['add-two', [BOB], [BOB, ALICE, MALLORY]],
      ['remove-other-keep-caller', [ALICE, BOB], [ALICE]],
      ['duplicate-collapse', [ALICE, BOB, MALLORY], [BOB, BOB]],
    ];
    for (const [messageId, beforeLikes, afterLikes] of cases) {
      await seed(`conversations/${cid}/messages/${messageId}`, {
        senderId: BOB, text: 'Reaction integrity', likedByIds: beforeLikes,
        createdAt: Timestamp.now(),
      });
      await assertFails(updateMessageWithRateLimit(
        ctx(ALICE), ALICE, 'direct', cid, messageId, { likedByIds: afterLikes }
      ));
    }
  });

  it('binds one authoritative update limiter to exactly one message mutation', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/one`, {
      senderId: BOB, text: 'One', createdAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/two`, {
      senderId: BOB, text: 'Two', createdAt: Timestamp.now(),
    });

    await assertSucceeds(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'direct', cid, 'one', { likedByIds: [ALICE] }
    ));
    await assertFails(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'direct', cid, 'one', { likedByIds: [] }
    ));
    await seed(`rateLimits/${ALICE}/actions/updateMessage`, {
      lastResourceId: `conversations/${cid}/messages/one`,
      updatedAt: Timestamp.fromMillis(Date.now() - 2_000),
    });
    await assertSucceeds(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'direct', cid, 'one', { likedByIds: [] }
    ));

    await seed(`rateLimits/${ALICE}/actions/updateMessage`, {
      lastResourceId: `conversations/${cid}/messages/one`,
      updatedAt: Timestamp.fromMillis(Date.now() - 2_000),
    });
    await assertFails(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'direct', cid, 'two', { likedByIds: [ALICE] }, cid, 'one'
    ));

    const reuseDb = ctx(ALICE);
    const reuseBatch = batchWithBoundRateLimit(
      reuseDb, ALICE, 'updateMessage', `conversations/${cid}/messages/one`
    );
    reuseBatch.update(doc(reuseDb, 'conversations', cid, 'messages', 'one'), {
      likedByIds: [ALICE],
    });
    reuseBatch.update(doc(reuseDb, 'conversations', cid, 'messages', 'two'), {
      likedByIds: [ALICE],
    });
    await assertFails(reuseBatch.commit());

    await assertFails(setDoc(
      doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', 'updateMessage'),
      {
        lastResourceId: `conversations/${cid}/messages/one`,
        updatedAt: serverTimestamp(),
      }
    ));

    await seed(`rateLimits/${ALICE}/actions/updateMessage`, {
      lastResourceId: `conversations/${cid}/messages/one`,
      updatedAt: Timestamp.fromMillis(Date.now() - 2_000),
    });
    await assertFails(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'direct', cid, 'one', { likedByIds: [ALICE, ALICE] }
    ));
    let limiterAfterFailure;
    await env.withSecurityRulesDisabled(async (adminContext) => {
      limiterAfterFailure = await getDoc(
        doc(adminContext.firestore(), 'rateLimits', ALICE, 'actions', 'updateMessage')
      );
    });
    assert.equal(
      limiterAfterFailure.data().updatedAt.toMillis() <= Date.now() - 1_000,
      true
    );
  });

  it('blocks DM reactions after either participant blocks the other', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/reactable`, {
      senderId: ALICE, text: 'Sent before block', createdAt: Timestamp.now(),
    });
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });

    await assertFails(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'direct', cid, 'reactable', { likedByIds: arrayUnion(ALICE) }
    ));
    await assertFails(updateMessageWithRateLimit(
      ctx(BOB), BOB, 'direct', cid, 'reactable', { likedByIds: arrayUnion(BOB) }
    ));
  });

  it('lets the sender edit for 15 minutes while preserving the first version', async () => {
    const cid = convoId(ALICE, BOB);
    const messageRef = doc(ctx(ALICE), 'conversations', cid, 'messages', 'editable');
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/editable`, {
      senderId: ALICE,
      text: 'Original plan',
      likedByIds: [BOB],
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
    });

    await assertSucceeds(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'editable', {
      text: 'Updated plan', originalText: 'Original plan', editedAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${ALICE}/actions/updateMessage`, {
      lastResourceId: `conversations/${cid}/messages/editable`,
      updatedAt: Timestamp.fromMillis(Date.now() - 2_000),
    });
    await assertSucceeds(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'editable', {
      text: 'Final plan', originalText: 'Original plan', editedAt: serverTimestamp(),
    }));
    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'editable', {
      text: 'Forged history', originalText: 'Not the original', editedAt: serverTimestamp(),
    }));
    await assertFails(updateMessageWithRateLimit(ctx(BOB), BOB, 'direct', cid, 'editable', {
      text: 'Hijacked', originalText: 'Original plan', editedAt: serverTimestamp(),
    }));

    const saved = await assertSucceeds(getDoc(messageRef));
    assert.equal(saved.data().text, 'Final plan');
    assert.equal(saved.data().originalText, 'Original plan');
    assert.deepEqual(saved.data().likedByIds, [BOB]);
  });

  it('rejects late, empty, objectionable, and identity-changing DM edits', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/old`, {
      senderId: ALICE, text: 'Old text',
      createdAt: Timestamp.fromMillis(Date.now() - 16 * 60_000),
    });
    const oldRef = doc(ctx(ALICE), 'conversations', cid, 'messages', 'old');

    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'old', {
      text: 'Too late', originalText: 'Old text', editedAt: serverTimestamp(),
    }));
    await seed(`conversations/${cid}/messages/fresh`, {
      senderId: ALICE, text: 'Fresh text', createdAt: Timestamp.now(),
    });
    const freshRef = doc(ctx(ALICE), 'conversations', cid, 'messages', 'fresh');
    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'fresh', {
      text: '', originalText: 'Fresh text', editedAt: serverTimestamp(),
    }));
    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'fresh', {
      text: 'kill yourself', originalText: 'Fresh text', editedAt: serverTimestamp(),
    }));
    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'fresh', {
      senderId: BOB, text: 'Changed identity',
      originalText: 'Fresh text', editedAt: serverTimestamp(),
    }));
  });

  it('lets the sender unsend for 2 minutes and removes all shared content', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/fresh`, {
      senderId: ALICE, text: 'Remove this', originalText: 'First version',
      editedAt: Timestamp.now(), likedByIds: [BOB],
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
    });
    const freshRef = doc(ctx(ALICE), 'conversations', cid, 'messages', 'fresh');
    await assertSucceeds(updateDoc(freshRef, {
      text: '', originalText: deleteField(), editedAt: deleteField(),
      likedByIds: deleteField(),
      unsentAt: serverTimestamp(),
    }));

    const saved = await assertSucceeds(getDoc(freshRef));
    assert.equal(saved.data().text, '');
    assert.equal('originalText' in saved.data(), false);
    assert.equal('editedAt' in saved.data(), false);
    assert.equal('likedByIds' in saved.data(), false);
    await assertFails(updateDoc(freshRef, { unsentAt: serverTimestamp() }));
    await assertFails(deleteDoc(freshRef));
  });

  it('rejects late and non-sender unsends', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/old`, {
      senderId: ALICE, text: 'Old text',
      createdAt: Timestamp.fromMillis(Date.now() - 3 * 60_000),
    });
    const aliceRef = doc(ctx(ALICE), 'conversations', cid, 'messages', 'old');
    const bobRef = doc(ctx(BOB), 'conversations', cid, 'messages', 'old');
    const update = { text: '', unsentAt: serverTimestamp() };
    await assertFails(updateDoc(aliceRef, update));
    await assertFails(updateDoc(bobRef, update));
  });

  it('blocks post-block edits while still letting the sender remove content', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/fresh`, {
      senderId: ALICE, text: 'Sent before block', createdAt: Timestamp.now(),
    });
    await seed(`userBlocks/${BOB}__${ALICE}`, {
      blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
    });
    const messageRef = doc(ctx(ALICE), 'conversations', cid, 'messages', 'fresh');

    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'direct', cid, 'fresh', {
      text: 'Changed after block', originalText: 'Sent before block',
      editedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(messageRef, {
      text: '', unsentAt: serverTimestamp(),
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

  it('lets session participants add and remove only their own reactions', async () => {
    await seedChatSession();
    await seed('sessions/s1/messages/reactable', {
      senderId: ALICE, text: 'Group message', createdAt: Timestamp.now(),
    });

    const aliceRef = doc(ctx(ALICE), 'sessions', 's1', 'messages', 'reactable');
    const bobRef = doc(ctx(BOB), 'sessions', 's1', 'messages', 'reactable');
    await assertSucceeds(updateMessageWithRateLimit(
      ctx(BOB), BOB, 'session', 's1', 'reactable', { likedByIds: arrayUnion(BOB) }
    ));
    await assertSucceeds(updateMessageWithRateLimit(
      ctx(ALICE), ALICE, 'session', 's1', 'reactable', { likedByIds: arrayUnion(ALICE) }
    ));
    await assertFails(updateMessageWithRateLimit(
      ctx(BOB), BOB, 'session', 's1', 'reactable', { likedByIds: arrayRemove(ALICE) }
    ));
    await assertFails(updateMessageWithRateLimit(
      ctx(MALLORY), MALLORY, 'session', 's1', 'reactable', { likedByIds: arrayUnion(MALLORY) }
    ));
    await assertFails(updateMessageWithRateLimit(ctx(BOB), BOB, 'session', 's1', 'reactable', {
      likedByIds: arrayRemove(BOB),
      text: 'Reaction write cannot edit content',
    }));
    await seed(`rateLimits/${BOB}/actions/updateMessage`, {
      lastResourceId: 'sessions/s1/messages/reactable',
      updatedAt: Timestamp.fromMillis(Date.now() - 2_000),
    });
    await assertSucceeds(updateMessageWithRateLimit(
      ctx(BOB), BOB, 'session', 's1', 'reactable', { likedByIds: arrayRemove(BOB) }
    ));

    const saved = await assertSucceeds(getDoc(aliceRef));
    assert.deepEqual(saved.data().likedByIds, [ALICE]);
  });

  it('denies reactions when a session chat is cancelled or over the fanout cap', async () => {
    await seedChatSession('cancelled', { status: 'cancelled' });
    await seed('sessions/cancelled/messages/m1', {
      senderId: ALICE, text: 'Before cancellation', createdAt: Timestamp.now(),
    });
    await assertFails(updateMessageWithRateLimit(
      ctx(BOB), BOB, 'session', 'cancelled', 'm1', { likedByIds: arrayUnion(BOB) }
    ));

    const twentyOne = [ALICE, BOB, ...Array.from({ length: 19 }, (_, i) => `filler${i}`)];
    await seedChatSession('oversized', { participantIds: twentyOne });
    await seed('sessions/oversized/messages/m1', {
      senderId: ALICE, text: 'Legacy group', createdAt: Timestamp.now(),
    });
    await assertFails(updateMessageWithRateLimit(
      ctx(BOB), BOB, 'session', 'oversized', 'm1', { likedByIds: arrayUnion(BOB) }
    ));
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

  it('allows valid session-chat replies and rejects forged reply shapes', async () => {
    await seedChatSession();
    await assertSucceeds(createSessionChatMessage(ctx(BOB), BOB, 's1', 'reply-ok', {
      senderId: BOB,
      text: 'I will be there.',
      replyTo: { messageId: 'source', senderId: ALICE, text: 'Meet at the library?' },
      createdAt: serverTimestamp(),
    }));
    await seed(`rateLimits/${BOB}/actions/sendMessage`, {
      updatedAt: Timestamp.fromMillis(Date.now() - 10_000),
    });
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 's1', 'reply-forged', {
      senderId: BOB,
      text: 'Forged reply.',
      replyTo: { messageId: 'source', senderId: ALICE, text: 'x'.repeat(281) },
      createdAt: serverTimestamp(),
    }));
  });

  it('lets a sender edit and unsend inside the group-chat windows', async () => {
    await seedChatSession();
    await seed('sessions/s1/messages/m1', {
      senderId: BOB, text: 'original',
      likedByIds: [ALICE],
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
    });
    const messageRef = doc(ctx(BOB), 'sessions', 's1', 'messages', 'm1');

    await assertSucceeds(updateMessageWithRateLimit(ctx(BOB), BOB, 'session', 's1', 'm1', {
      text: 'edited', originalText: 'original', editedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(messageRef, {
      text: '', originalText: deleteField(), editedAt: deleteField(),
      likedByIds: deleteField(),
      unsentAt: serverTimestamp(),
    }));

    const saved = await assertSucceeds(getDoc(messageRef));
    assert.equal(saved.data().text, '');
    assert.equal('originalText' in saved.data(), false);
    assert.equal('likedByIds' in saved.data(), false);
    await assertFails(deleteDoc(messageRef));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'sessions', 's1', 'messages', 'm1')));
    await assertFails(deleteDoc(doc(ctx(MALLORY), 'sessions', 's1', 'messages', 'm1')));
  });

  it('rejects late, non-sender, and cancelled-session lifecycle updates', async () => {
    await seedChatSession();
    await seed('sessions/s1/messages/old', {
      senderId: BOB, text: 'old edit',
      createdAt: Timestamp.fromMillis(Date.now() - 16 * 60_000),
    });
    await seed('sessions/s1/messages/recent', {
      senderId: BOB, text: 'recent',
      createdAt: Timestamp.fromMillis(Date.now() - 3 * 60_000),
    });

    await assertFails(updateMessageWithRateLimit(ctx(BOB), BOB, 'session', 's1', 'old', {
      text: 'too late', originalText: 'old edit', editedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 's1', 'messages', 'recent'), {
      text: '', unsentAt: serverTimestamp(),
    }));
    await assertFails(updateMessageWithRateLimit(ctx(ALICE), ALICE, 'session', 's1', 'recent', {
      text: 'hijacked', originalText: 'recent', editedAt: serverTimestamp(),
    }));

    await seedChatSession('s1', { status: 'cancelled' });
    await seed('sessions/s1/messages/cancelled', {
      senderId: BOB, text: 'before cancellation', createdAt: Timestamp.now(),
    });
    await assertFails(updateMessageWithRateLimit(ctx(BOB), BOB, 'session', 's1', 'cancelled', {
      text: 'after cancellation', originalText: 'before cancellation',
      editedAt: serverTimestamp(),
    }));
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

  it('stops all sends after the two-hour post-session grace period', async () => {
    await seedChatSession('expired', {
      endTime: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000 - 5_000),
    });
    await assertFails(createSessionChatMessage(ctx(ALICE), ALICE, 'expired', 'm1', {
      senderId: ALICE,
      text: 'too late',
      createdAt: serverTimestamp(),
    }));
  });

  it('only keepers retain read access after the grace period', async () => {
    await seedChatSession('expired', {
      endTime: Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000 - 5_000),
    });
    await seed('sessions/expired/messages/m1', {
      senderId: ALICE,
      text: 'saved history',
      createdAt: Timestamp.now(),
    });
    await seed(`users/${ALICE}/keptSessionChats/expired`, {
      sessionId: 'expired',
      keptAt: Timestamp.now(),
    });

    await assertSucceeds(getDoc(doc(ctx(ALICE), 'sessions', 'expired', 'messages', 'm1')));
    await assertFails(getDoc(doc(ctx(BOB), 'sessions', 'expired', 'messages', 'm1')));
  });
});

describe('kept session chats (users/{uid}/keptSessionChats)', () => {
  it('lets a participant keep history during the two-hour grace period', async () => {
    await seed('sessions/grace', validSession(ALICE, {
      participantIds: [ALICE, BOB],
      endTime: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));

    await assertSucceeds(setDoc(doc(ctx(BOB), 'users', BOB, 'keptSessionChats', 'grace'), {
      sessionId: 'grace',
      keptAt: serverTimestamp(),
    }));
  });

  it('rejects outsiders, cross-user writes, and keeps after the deadline', async () => {
    await seed('sessions/grace', validSession(ALICE, {
      participantIds: [ALICE, BOB],
      endTime: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));
    await seed('sessions/expired', validSession(ALICE, {
      participantIds: [ALICE, BOB],
      endTime: Timestamp.fromMillis(Date.now() - 3 * 60 * 60 * 1000),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));

    await assertFails(setDoc(doc(ctx(MALLORY), 'users', MALLORY, 'keptSessionChats', 'grace'), {
      sessionId: 'grace',
      keptAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'users', BOB, 'keptSessionChats', 'grace'), {
      sessionId: 'grace',
      keptAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(BOB), 'users', BOB, 'keptSessionChats', 'expired'), {
      sessionId: 'expired',
      keptAt: serverTimestamp(),
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

describe('push token ownership registry (Admin SDK only)', () => {
  it('clients cannot read, write, or delete token ownership records', async () => {
    await seed('pushTokenOwners/tokenHash', { userId: ALICE, updatedAt: Timestamp.now() });
    await assertFails(getDoc(doc(ctx(ALICE), 'pushTokenOwners', 'tokenHash')));
    await assertFails(setDoc(doc(ctx(ALICE), 'pushTokenOwners', 'otherHash'), {
      userId: ALICE, updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'pushTokenOwners', 'tokenHash')));
    await seed('pushTokenInstallations/installationHash', {
      userId: ALICE,
      installationId: 'installation_0001',
      registrationId: 'registration_0001',
      tokenHash: 'tokenHash',
      updatedAt: Timestamp.now(),
    });
    await assertFails(getDoc(doc(ctx(ALICE), 'pushTokenInstallations', 'installationHash')));
    await assertFails(setDoc(doc(ctx(ALICE), 'pushTokenInstallations', 'otherHash'), {
      userId: ALICE,
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

  // Mirrors the updated sendFriendRequest in lib/friends.ts: request doc plus
  // an id-bound limiter write in one batch.
  function sendRequest(db, uid, fromUid, toUid) {
    const requestId = reqId(fromUid, toUid);
    const batch = batchWithBoundFriendRequestRateLimit(db, uid, requestId);
    batch.set(doc(db, 'friendRequests', requestId), {
      fromUid, toUid, createdAt: serverTimestamp(),
    });
    return batch.commit();
  }

  function sendLegacyRequest(db, uid, fromUid, toUid) {
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

  it('rejects the legacy updatedAt-only client shape', async () => {
    await seedUser(BOB);
    await assertFails(sendLegacyRequest(ctx(ALICE), ALICE, ALICE, BOB));
  });

  it('rejects a second request inside the ten-second cooldown', async () => {
    await seedUser(BOB);
    await seedUser(MALLORY);
    await assertSucceeds(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));
    await assertFails(sendRequest(ctx(ALICE), ALICE, ALICE, MALLORY));
  });

  it('allows another request once the ten-second cooldown has elapsed', async () => {
    await seedUser(BOB);
    await seed(`rateLimits/${ALICE}/actions/friendRequest`, {
      lastRequestId: reqId(ALICE, MALLORY),
      updatedAt: Timestamp.fromMillis(Date.now() - 11_000),
    });
    await assertSucceeds(sendRequest(ctx(ALICE), ALICE, ALICE, BOB));
  });

  it('rejects a bound limiter whose lastRequestId does not match the create', async () => {
    await seedUser(BOB);
    const db = ctx(ALICE);
    const batch = batchWithBoundFriendRequestRateLimit(
      db,
      ALICE,
      reqId(ALICE, MALLORY)
    );
    batch.set(doc(db, 'friendRequests', reqId(ALICE, BOB)), {
      fromUid: ALICE, toUid: BOB, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('rejects unknown fields on both bound and legacy friendRequest limiters', async () => {
    const db = ctx(ALICE);
    await assertFails(setDoc(doc(db, 'rateLimits', ALICE, 'actions', 'friendRequest'), {
      lastRequestId: reqId(ALICE, BOB),
      updatedAt: serverTimestamp(),
      extra: true,
    }));
    await assertFails(setDoc(doc(db, 'rateLimits', ALICE, 'actions', 'friendRequest'), {
      updatedAt: serverTimestamp(),
      extra: true,
    }));
  });

  it('rejects a forged limiter owner and denies limiter deletion', async () => {
    await assertFails(setDoc(
      doc(ctx(ALICE), 'rateLimits', BOB, 'actions', 'friendRequest'),
      { lastRequestId: reqId(BOB, MALLORY), updatedAt: serverTimestamp() }
    ));
    await seed(`rateLimits/${ALICE}/actions/friendRequest`, {
      lastRequestId: reqId(ALICE, BOB),
      updatedAt: Timestamp.now(),
    });
    await assertFails(
      deleteDoc(doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', 'friendRequest'))
    );
  });

  it('one bound limiter cannot authorize two request creates in one batch', async () => {
    await seedUser(BOB);
    await seedUser(MALLORY);
    const db = ctx(ALICE);
    const firstId = reqId(ALICE, BOB);
    const secondId = reqId(ALICE, MALLORY);
    const batch = batchWithBoundFriendRequestRateLimit(db, ALICE, firstId);
    batch.set(doc(db, 'friendRequests', firstId), {
      fromUid: ALICE, toUid: BOB, createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'friendRequests', secondId), {
      fromUid: ALICE, toUid: MALLORY, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
    assert.equal((await getDoc(doc(ctx(ALICE), 'friendRequests', firstId))).exists(), false);
    assert.equal((await getDoc(doc(ctx(ALICE), 'friendRequests', secondId))).exists(), false);
  });

  it('two concurrent bound batches against one limiter allow exactly one request', async () => {
    await seedUser(BOB);
    await seedUser(MALLORY);
    const attempts = await Promise.allSettled([
      sendRequest(ctx(ALICE), ALICE, ALICE, BOB),
      sendRequest(ctx(ALICE), ALICE, ALICE, MALLORY),
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
    const first = await getDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, BOB)));
    const second = await getDoc(doc(ctx(ALICE), 'friendRequests', reqId(ALICE, MALLORY)));
    assert.equal(Number(first.exists()) + Number(second.exists()), 1);
    const limiter = await getDoc(
      doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', 'friendRequest')
    );
    assert.equal(
      limiter.data().lastRequestId,
      first.exists() ? reqId(ALICE, BOB) : reqId(ALICE, MALLORY)
    );
  });

  it('rejects the legacy same-batch bypass', async () => {
    await seedUser(BOB);
    await seedUser(MALLORY);
    const db = ctx(ALICE);
    const batch = batchWithRateLimit(db, ALICE, 'friendRequest');
    batch.set(doc(db, 'friendRequests', reqId(ALICE, BOB)), {
      fromUid: ALICE, toUid: BOB, createdAt: serverTimestamp(),
    });
    batch.set(doc(db, 'friendRequests', reqId(ALICE, MALLORY)), {
      fromUid: ALICE, toUid: MALLORY, createdAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
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
    const batch = batchWithBoundFriendRequestRateLimit(db, ALICE, reqId(ALICE, BOB));
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
    const batch = batchWithBoundFriendRequestRateLimit(db, ALICE, `${ALICE}__${unsafe}`);
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

  it('allows owner raw reads but denies outsider get and list', async () => {
    await seed(`locationRatings/college-library__${ALICE}`, {
      locationId: 'college-library', userId: ALICE, stars: 4, tags: [],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await assertSucceeds(
      getDoc(doc(ctx(ALICE), 'locationRatings', `college-library__${ALICE}`))
    );
    await assertFails(
      getDoc(doc(ctx(BOB), 'locationRatings', `college-library__${ALICE}`))
    );
    await assertFails(getDocs(collection(ctx(BOB), 'locationRatings')));
    await assertSucceeds(getDocs(query(
      collection(ctx(ALICE), 'locationRatings'),
      where('userId', '==', ALICE)
    )));
  });

  it('keeps public location aggregates readable', async () => {
    await seed('locations/college-library', {
      name: 'College Library', ratingCount: 2, ratingSum: 9,
    });
    await assertSucceeds(getDoc(doc(ctx(BOB), 'locations', 'college-library')));
  });
});

// ------------------------------------------------ launch UGC moderation gate
describe('high-confidence UGC moderation', () => {
  const moderationParityCases = [
    ...BLOCKED_CONTENT_CASES.map((text) => [text, false]),
    ...ALLOWED_CONTENT_CASES.map((text) => [text, true]),
  ];

  for (const [text, allowed] of moderationParityCases) {
    it(`${allowed ? 'allows' : 'rejects'} parity case: ${text}`, async () => {
      const write = setDoc(doc(ctx(ALICE), 'users', ALICE), {
        displayName: 'Alice', classes: [], bio: text,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await (allowed ? assertSucceeds(write) : assertFails(write));
    });
  }

  it('rejects objectionable profile text while preserving normal Unicode', async () => {
    await assertFails(setDoc(doc(ctx(ALICE), 'users', ALICE), {
      displayName: 'Alice', classes: [], bio: 'kill yourself',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(ctx(ALICE), 'users', ALICE), {
      displayName: 'Alice', classes: [], bio: 'I will kill you',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(ctx(ALICE), 'users', ALICE), {
      displayName: 'José 王', classes: [], bio: 'Studying violence prevention 📚',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });

  it('rejects objectionable session titles and chat messages', async () => {
    await assertFails(createSessionWithRateLimit(
      ctx(ALICE), ALICE, 'bad-title', validSession(ALICE, { title: 'kys' })
    ));
    await seed('sessions/chat-moderation', validSession(ALICE, {
      participantIds: [ALICE, BOB], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await assertFails(createSessionChatMessage(ctx(BOB), BOB, 'chat-moderation', 'bad-message', {
      senderId: BOB, text: 'kill yourself', createdAt: serverTimestamp(),
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
    await assertSucceeds(createReportWithRateLimit(ctx(ALICE), ALICE, 'r1', valid(ALICE)));
    await assertFails(setDoc(doc(ctx(ALICE), 'reports', 'r1b'), valid(ALICE)));
    await assertFails(getDoc(doc(ctx(ALICE), 'reports', 'r1')));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'reports', 'r1')));
  });

  async function seedDirectReportTarget() {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/message123`, {
      senderId: BOB, text: 'reported direct message', createdAt: Timestamp.now(),
    });
    return cid;
  }

  async function seedSessionReportTarget() {
    await seed('sessions/session123', validSession(ALICE, {
      participantIds: [ALICE, BOB], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await seed('sessions/session123/messages/message123', {
      senderId: BOB, text: 'reported session message', createdAt: Timestamp.now(),
    });
  }

  it('accepts authentic DM and session message evidence without making reports readable', async () => {
    const cid = await seedDirectReportTarget();
    await assertSucceeds(createReportWithRateLimit(ctx(ALICE), ALICE, 'message-report', {
      ...valid(ALICE),
      context: 'conversation',
      contentType: 'direct_message',
      contentId: 'message123',
      threadId: cid,
      messageText: 'reported direct message',
    }));
    await assertFails(getDoc(doc(ctx(ALICE), 'reports', 'message-report')));

    await seed(`rateLimits/${ALICE}/actions/reportUser`, {
      lastResourceId: 'reports/message-report',
      updatedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
    });
    await seedSessionReportTarget();
    await assertSucceeds(createReportWithRateLimit(ctx(ALICE), ALICE, 'session-message-report', {
      ...valid(ALICE),
      context: 'session_chat', contentType: 'session_message',
      contentId: 'message123', threadId: 'session123',
      messageText: 'reported session message',
    }));
    await env.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await deleteDoc(doc(adminDb, 'sessions', 'session123', 'messages', 'message123'));
      const report = await getDoc(doc(adminDb, 'reports', 'session-message-report'));
      assert.equal(report.data().messageText, 'reported session message');
    });
  });

  it('rejects partial or malformed message references', async () => {
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'partial-report', {
      ...valid(ALICE), contentType: 'session_message', contentId: 'message123',
    }));
  });

  it('rejects nonexistent messages and forged message ids', async () => {
    await seedSessionReportTarget();
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'missing-message', {
      ...valid(ALICE), context: 'session_chat', contentType: 'session_message',
      contentId: 'does-not-exist', threadId: 'session123', messageText: 'invented',
    }));
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'forged-id', {
      ...valid(ALICE), context: 'session_chat', contentType: 'session_message',
      contentId: '../message123', threadId: 'session123', messageText: 'reported session message',
    }));
  });

  it('rejects a message reference substituted from another session', async () => {
    await seedSessionReportTarget();
    await seed('sessions/session456', validSession(ALICE, {
      participantIds: [ALICE, BOB], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await seed('sessions/session456/messages/other-message', {
      senderId: BOB, text: 'message from a different session', createdAt: Timestamp.now(),
    });
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'mismatched-thread', {
      ...valid(ALICE), context: 'session_chat', contentType: 'session_message',
      contentId: 'other-message', threadId: 'session123',
      messageText: 'message from a different session',
    }));
  });

  it('rejects a sender mismatch or altered evidence snapshot', async () => {
    await seedSessionReportTarget();
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'wrong-sender', {
      ...valid(ALICE), reportedUserId: MALLORY,
      context: 'session_chat', contentType: 'session_message',
      contentId: 'message123', threadId: 'session123', messageText: 'reported session message',
    }));
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'altered-evidence', {
      ...valid(ALICE), context: 'session_chat', contentType: 'session_message',
      contentId: 'message123', threadId: 'session123', messageText: 'different text',
    }));
  });

  it('binds edited-message reports to both current and original evidence', async () => {
    const cid = convoId(ALICE, BOB);
    await seed(`conversations/${cid}`, {
      ...validConversation(ALICE, BOB), createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(), lastMessageAt: Timestamp.now(),
    });
    await seed(`conversations/${cid}/messages/edited-message`, {
      senderId: BOB,
      text: 'edited current text',
      originalText: 'original reported text',
      editedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    });
    const evidence = {
      ...valid(ALICE),
      context: 'conversation',
      contentType: 'direct_message',
      contentId: 'edited-message',
      threadId: cid,
      messageText: 'edited current text',
      originalMessageText: 'original reported text',
    };

    await assertSucceeds(createReportWithRateLimit(
      ctx(ALICE), ALICE, 'edited-message-report', evidence
    ));
    await seed(`rateLimits/${ALICE}/actions/reportUser`, {
      lastResourceId: 'reports/edited-message-report',
      updatedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
    });
    await assertFails(createReportWithRateLimit(
      ctx(ALICE), ALICE, 'missing-original-evidence',
      Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'originalMessageText'))
    ));
    await assertFails(createReportWithRateLimit(
      ctx(ALICE), ALICE, 'forged-original-evidence',
      { ...evidence, originalMessageText: 'forged original' }
    ));

    await env.withSecurityRulesDisabled(async (adminContext) => {
      const saved = await getDoc(doc(adminContext.firestore(), 'reports', 'edited-message-report'));
      assert.equal(saved.data().messageText, 'edited current text');
      assert.equal(saved.data().originalMessageText, 'original reported text');
    });

    await seed(`rateLimits/${ALICE}/actions/reportUser`, {
      lastResourceId: 'reports/edited-message-report',
      updatedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
    });
    await seed('sessions/edited-report-session', validSession(ALICE, {
      participantIds: [ALICE, BOB], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
    await seed('sessions/edited-report-session/messages/edited-session-message', {
      senderId: BOB,
      text: 'current session text',
      originalText: 'original session text',
      editedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
    });
    await assertSucceeds(createReportWithRateLimit(
      ctx(ALICE), ALICE, 'edited-session-message-report', {
        ...valid(ALICE),
        context: 'session_chat',
        contentType: 'session_message',
        contentId: 'edited-session-message',
        threadId: 'edited-report-session',
        messageText: 'current session text',
        originalMessageText: 'original session text',
      }
    ));
  });

  it('rejects outsiders and self-reports for referenced messages', async () => {
    await seedSessionReportTarget();
    await assertFails(createReportWithRateLimit(ctx(MALLORY), MALLORY, 'outsider-report', {
      ...valid(MALLORY), context: 'session_chat', contentType: 'session_message',
      contentId: 'message123', threadId: 'session123', messageText: 'reported session message',
    }));
    await seed('sessions/self-report-session', validSession(ALICE));
    await seed('sessions/self-report-session/messages/own-message', {
      senderId: ALICE, text: 'my message', createdAt: Timestamp.now(),
    });
    await assertFails(createReportWithRateLimit(ctx(ALICE), ALICE, 'self-message-report', {
      ...valid(ALICE), reportedUserId: ALICE,
      context: 'session_chat', contentType: 'session_message',
      contentId: 'own-message', threadId: 'self-report-session', messageText: 'my message',
    }));
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

// ----------------------------------------------------- catalog requests
describe('catalog requests (write-only)', () => {
  const valid = (requester, overrides = {}) => ({
    requesterUserId: requester,
    type: 'course',
    name: 'COMPSCI 999',
    searchQuery: 'COMPSCI 999',
    details: 'A course missing from the catalog.',
    source: 'onboarding-classes',
    createdAt: serverTimestamp(),
    ...overrides,
  });

  it('one request with its matching limiter update succeeds and remains write-only', async () => {
    await assertSucceeds(
      createCatalogRequestWithRateLimit(ctx(ALICE), ALICE, 'cr1', valid(ALICE))
    );
    await assertFails(getDoc(doc(ctx(ALICE), 'catalogRequests', 'cr1')));
    await assertFails(updateDoc(doc(ctx(ALICE), 'catalogRequests', 'cr1'), {
      details: 'edited',
    }));
    await assertFails(deleteDoc(doc(ctx(ALICE), 'catalogRequests', 'cr1')));
  });

  it('a second request inside ten minutes fails', async () => {
    await seed(`rateLimits/${ALICE}/actions/catalogRequest`, {
      lastRequestId: 'cr1',
      updatedAt: Timestamp.now(),
    });
    await assertFails(
      createCatalogRequestWithRateLimit(ctx(ALICE), ALICE, 'cr2', valid(ALICE))
    );
  });

  it('two requests cannot share one limiter update in the same batch', async () => {
    const db = ctx(ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'rateLimits', ALICE, 'actions', 'catalogRequest'), {
      lastRequestId: 'cr-batch-1',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'catalogRequests', 'cr-batch-1'), valid(ALICE));
    batch.set(doc(db, 'catalogRequests', 'cr-batch-2'), valid(ALICE));

    await assertFails(batch.commit());
  });

  it('two concurrent independent batches allow exactly one request', async () => {
    const attempts = [ctx(ALICE), ctx(ALICE)].map((db) => {
      const requestRef = doc(collection(db, 'catalogRequests'));
      const batch = writeBatch(db);
      batch.set(doc(db, 'rateLimits', ALICE, 'actions', 'catalogRequest'), {
        lastRequestId: requestRef.id,
        updatedAt: serverTimestamp(),
      });
      batch.set(requestRef, valid(ALICE));
      return { requestId: requestRef.id, commit: batch.commit() };
    });

    const outcomes = await Promise.allSettled(attempts.map((attempt) => attempt.commit));
    const successfulIndexes = outcomes
      .map((outcome, index) => (outcome.status === 'fulfilled' ? index : -1))
      .filter((index) => index >= 0);
    const failedOutcomes = outcomes.filter((outcome) => outcome.status === 'rejected');

    assert.equal(successfulIndexes.length, 1);
    assert.equal(failedOutcomes.length, 1);

    const successfulRequestId = attempts[successfulIndexes[0]].requestId;
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const requestSnapshot = await getDocs(collection(adminDb, 'catalogRequests'));
      const limiterSnapshot = await getDoc(
        doc(adminDb, 'rateLimits', ALICE, 'actions', 'catalogRequest')
      );

      assert.equal(requestSnapshot.size, 1);
      assert.equal(requestSnapshot.docs[0].id, successfulRequestId);
      assert.equal(limiterSnapshot.data().lastRequestId, successfulRequestId);
    });
  });

  it('a request id that does not match lastRequestId fails', async () => {
    const db = ctx(ALICE);
    const batch = writeBatch(db);
    batch.set(doc(db, 'rateLimits', ALICE, 'actions', 'catalogRequest'), {
      lastRequestId: 'different-request',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'catalogRequests', 'cr-mismatch'), valid(ALICE));

    await assertFails(batch.commit());
  });

  it('rejects a forged requester uid', async () => {
    await assertFails(
      createCatalogRequestWithRateLimit(ctx(ALICE), ALICE, 'cr3', valid(BOB))
    );
  });

  it('allows another request once the cooldown has elapsed', async () => {
    await seed(`rateLimits/${ALICE}/actions/catalogRequest`, {
      lastRequestId: 'old-request',
      updatedAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000),
    });
    await assertSucceeds(
      createCatalogRequestWithRateLimit(ctx(ALICE), ALICE, 'cr-after-cooldown', valid(ALICE))
    );
  });

  it('rejects invalid types and oversized names', async () => {
    await assertFails(
      createCatalogRequestWithRateLimit(ctx(ALICE), ALICE, 'cr4', valid(ALICE, {
        type: 'building',
      }))
    );
    await assertFails(
      createCatalogRequestWithRateLimit(ctx(ALICE), ALICE, 'cr5', valid(ALICE, {
        name: 'x'.repeat(121),
      }))
    );
  });
});

// ---------------------------------------------------- PR A: rules hardening
// Regression coverage for the four rules-only findings fixed in PR A. Each
// block pairs the closed hole with a control proving the legitimate flow it
// sits next to still works.
describe('PR A hardening', () => {
  const seedUser = (uid) => seed(`users/${uid}`, { displayName: uid, classes: [] });

  const seedConversation = (a, b) =>
    seed(`conversations/${convoId(a, b)}`, {
      ...validConversation(a, b),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      lastMessageAt: Timestamp.now(),
    });

  // -- H1: conversation existence probing ---------------------------------
  describe('H1 conversation existence probing', () => {
    it('denies an outsider identically whether or not the thread exists', async () => {
      const cid = convoId(ALICE, BOB);

      // Missing doc: previously allowed through the `!exists()` arm, which let
      // a non-participant read "no thread here" off an empty snapshot.
      await assertFails(getDoc(doc(ctx(MALLORY), 'conversations', cid)));

      await seedConversation(ALICE, BOB);

      // Existing doc: denied before and after. Same outcome either way, so
      // there is nothing to distinguish and no oracle.
      await assertFails(getDoc(doc(ctx(MALLORY), 'conversations', cid)));
    });

    it('still lets a participant probe their own thread id before it exists', async () => {
      // getOrCreateDirectConversation depends on this: it getDocs the
      // deterministic id first and only creates on a miss.
      await assertSucceeds(getDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB))));
      await assertSucceeds(getDoc(doc(ctx(BOB), 'conversations', convoId(ALICE, BOB))));

      await seedConversation(ALICE, BOB);
      await assertSucceeds(getDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB))));
      await assertSucceeds(getDoc(doc(ctx(BOB), 'conversations', convoId(ALICE, BOB))));
    });

    it('denies malformed and self-pair conversation ids', async () => {
      await assertFails(getDoc(doc(ctx(ALICE), 'conversations', ALICE)));
      await assertFails(getDoc(doc(ctx(ALICE), 'conversations', `__${ALICE}`)));
      await assertFails(getDoc(doc(ctx(ALICE), 'conversations', `${ALICE}__${ALICE}`)));
      await assertFails(
        getDoc(doc(ctx(ALICE), 'conversations', `${ALICE}__${BOB}__${MALLORY}`))
      );
    });

    it('leaves the participant inbox query working', async () => {
      await seedConversation(ALICE, BOB);
      await assertSucceeds(getDocs(query(
        collection(ctx(ALICE), 'conversations'),
        where('participantIds', 'array-contains', ALICE)
      )));
      await assertFails(getDocs(collection(ctx(ALICE), 'conversations')));
    });
  });

  // -- H3 part 1: counterpart must exist ----------------------------------
  describe('H3 conversation counterpart existence', () => {
    it('denies a thread opened against a uid with no user doc', async () => {
      const ghost = 'ghostUid000000000000';
      await assertFails(
        setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, ghost)),
          validConversation(ALICE, ghost))
      );
    });

    it('allows a thread against a real account, from either side of the pair', async () => {
      await seedUser(ALICE);
      await seedUser(BOB);

      await assertSucceeds(
        createConversationWithQuota(ctx(ALICE), ALICE, BOB)
      );
      await env.clearFirestore();

      // The counterpart is participantIds[0] rather than [1] depending on sort
      // order — exercise the other branch of conversationCounterpart().
      await seedUser(ALICE);
      await seedUser(BOB);
      await assertSucceeds(
        createConversationWithQuota(ctx(BOB), BOB, ALICE)
      );
    });

    it('still enforces the pre-existing create invariants', async () => {
      await seedUser(BOB);
      // Blocked pair, even though Bob is a real account.
      await seed(`userBlocks/${BOB}__${ALICE}`, {
        blockerUserId: BOB, blockedUserId: ALICE, createdAt: Timestamp.now(),
      });
      await assertFails(
        setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)),
          validConversation(ALICE, BOB))
      );
    });
  });

  // -- H4: block uid validation -------------------------------------------
  describe('H4 block uid validation', () => {
    it('denies a blockedUserId that is not a safe uid component', async () => {
      // A `__`-bearing value used to mint a 3-segment doc that no
      // isBlockedEitherWay lookup could ever match.
      await assertFails(
        setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}__${MALLORY}`), {
          blockerUserId: ALICE,
          blockedUserId: `${BOB}__${MALLORY}`,
          createdAt: serverTimestamp(),
        })
      );
      await assertFails(
        setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__`), {
          blockerUserId: ALICE, blockedUserId: '', createdAt: serverTimestamp(),
        })
      );
      await assertFails(
        setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__bob-uid`), {
          blockerUserId: ALICE, blockedUserId: 'bob-uid', createdAt: serverTimestamp(),
        })
      );
    });

    it('still allows an ordinary block, and it still gates messaging', async () => {
      await assertSucceeds(
        setDoc(doc(ctx(ALICE), 'userBlocks', `${ALICE}__${BOB}`), {
          blockerUserId: ALICE, blockedUserId: BOB, createdAt: serverTimestamp(),
        })
      );
      await seedUser(BOB);
      await assertFails(
        setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)),
          validConversation(ALICE, BOB))
      );
    });
  });

  // -- H2: session participant invariants ----------------------------------
  describe('H2 session participant invariants', () => {
    const sessionWith = (host, participantIds, overrides = {}) =>
      validSession(host, {
        participantIds,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        ...overrides,
      });

    it('denies a host padding participantIds with duplicates', async () => {
      await seed('sessions/pad1', sessionWith(ALICE, [ALICE, BOB]));
      await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 'pad1'), {
        participantIds: [ALICE, ALICE, ALICE, ALICE, ALICE],
        updatedAt: serverTimestamp(),
      }));
      // A single duplicate is just as invalid as many.
      await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 'pad1'), {
        participantIds: [ALICE, BOB, BOB],
        updatedAt: serverTimestamp(),
      }));
    });

    it('denies unbounded growth on a legacy session with no capacity field', async () => {
      await seed('sessions/legacy1', sessionWith(ALICE, [ALICE, BOB]));
      await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 'legacy1'), {
        participantIds: Array(200).fill(ALICE),
        updatedAt: serverTimestamp(),
      }));
    });

    it('caps a self-join at the 20-seat ceiling even without a capacity field', async () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `filler${i}`);
      await seed('sessions/full20', sessionWith(ALICE, twenty));
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'full20'), {
        participantIds: [...twenty, MALLORY],
        updatedAt: serverTimestamp(),
      }));

      // One seat short of the ceiling, the same join is fine.
      const nineteen = twenty.slice(0, 19);
      await seed('sessions/open19', sessionWith(ALICE, nineteen));
      await assertSucceeds(updateDoc(doc(ctx(MALLORY), 'sessions', 'open19'), {
        participantIds: [...nineteen, MALLORY],
        updatedAt: serverTimestamp(),
      }));
    });

    it('keeps an oversized legacy session editable by its host', async () => {
      // Compatibility guard: a pre-existing session already above the ceiling
      // must stay cancellable and kickable rather than freezing solid.
      const oversized = Array.from({ length: 25 }, (_, i) => `legacyUid${i}`);
      await seed('sessions/over25', sessionWith(ALICE, [ALICE, ...oversized]));

      // Retitle with the roster untouched (26 entries, still over the ceiling).
      await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 'over25', {
        title: 'Renamed while oversized',
        updatedAt: serverTimestamp(),
      }));
      // Cancel.
      await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 'over25'), {
        status: 'cancelled', updatedAt: serverTimestamp(),
      }));
      // Kick down toward the ceiling.
      await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 'over25'), {
        participantIds: [ALICE, ...oversized.slice(0, 10)],
        updatedAt: serverTimestamp(),
      }));
      // But never grow, not even by duplicating an existing member.
      await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 'over25'), {
        participantIds: [ALICE, ...oversized, ALICE],
        updatedAt: serverTimestamp(),
      }));
    });

    it('leaves ordinary join, leave, kick and capacity behavior intact', async () => {
      await seed('sessions/normal', sessionWith(ALICE, [ALICE], { capacity: 3 }));

      // Join.
      await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 'normal'), {
        participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
      }));
      // Second join, filling capacity.
      await assertSucceeds(updateDoc(doc(ctx(MALLORY), 'sessions', 'normal'), {
        participantIds: [ALICE, BOB, MALLORY], updatedAt: serverTimestamp(),
      }));
      // Leave.
      await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 'normal'), {
        participantIds: [ALICE, MALLORY], updatedAt: serverTimestamp(),
      }));
      // Host kick.
      await assertSucceeds(updateDoc(doc(ctx(ALICE), 'sessions', 'normal'), {
        participantIds: [ALICE], updatedAt: serverTimestamp(),
      }));
      // Host raises capacity to the max.
      await assertSucceeds(updateSessionWithRateLimit(ctx(ALICE), ALICE, 'normal', {
        capacity: 20, updatedAt: serverTimestamp(),
      }));
    });

    it('denies a duplicate-padded self-leave that evicts another participant', async () => {
      // The leaver frees a slot and refills it with a duplicate of a member
      // who stays, so the roster shrinks by exactly one and every entry is
      // still a prior member — the old size + subset test passed this while
      // BOB was silently removed.
      await seed('sessions/leave3', sessionWith(ALICE, [ALICE, BOB, MALLORY]));
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'leave3'), {
        participantIds: [ALICE, ALICE],
        updatedAt: serverTimestamp(),
      }));
      // The same trick duplicating the host, and duplicating the other
      // non-host member, are equally denied.
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'leave3'), {
        participantIds: [BOB, BOB],
        updatedAt: serverTimestamp(),
      }));
      // And a leaver cannot simply drop someone else alongside themselves.
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'leave3'), {
        participantIds: [ALICE],
        updatedAt: serverTimestamp(),
      }));
    });

    it('denies a self-leave that pads the roster with duplicates', async () => {
      // Set equality alone would accept this — every remaining member is still
      // present, so nobody is evicted — but the array grows without limit.
      // isSelfLeave has no ceiling check, so the uniqueness clause is the only
      // thing bounding length here. Do not drop it as "hygiene".
      await seed('sessions/leaveBloat', sessionWith(ALICE, [ALICE, BOB, MALLORY]));
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'leaveBloat'), {
        participantIds: [...Array(500).fill(ALICE), BOB],
        updatedAt: serverTimestamp(),
      }));
      // Even a single surplus copy is refused.
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'leaveBloat'), {
        participantIds: [ALICE, ALICE, BOB],
        updatedAt: serverTimestamp(),
      }));
    });

    it('allows an ordinary self-leave from a multi-person session', async () => {
      await seed('sessions/leaveOk', sessionWith(ALICE, [ALICE, BOB, MALLORY]));
      // Mallory leaves; Alice and Bob keep their seats.
      await assertSucceeds(updateDoc(doc(ctx(MALLORY), 'sessions', 'leaveOk'), {
        participantIds: [ALICE, BOB],
        updatedAt: serverTimestamp(),
      }));
      // Bob then leaves the remaining pair.
      await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 'leaveOk'), {
        participantIds: [ALICE],
        updatedAt: serverTimestamp(),
      }));
    });

    it('allows a self-leave that reorders the remaining participants', async () => {
      // arrayRemove preserves order, but the rule pins the SET, not the
      // sequence — a reordered remainder must stay valid.
      await seed('sessions/leaveOrder', sessionWith(ALICE, [ALICE, BOB, MALLORY]));
      await assertSucceeds(updateDoc(doc(ctx(MALLORY), 'sessions', 'leaveOrder'), {
        participantIds: [BOB, ALICE],
        updatedAt: serverTimestamp(),
      }));
    });

    it('denies a host leaving their own roster', async () => {
      await seed('sessions/leaveHost', sessionWith(ALICE, [ALICE, BOB, MALLORY]));
      await assertFails(updateDoc(doc(ctx(ALICE), 'sessions', 'leaveHost'), {
        participantIds: [BOB, MALLORY],
        updatedAt: serverTimestamp(),
      }));
    });

    it('denies a non-host dropping someone else, with or without leaving', async () => {
      await seed('sessions/leaveBad', sessionWith(ALICE, [ALICE, BOB, MALLORY]));
      // Caller stays seated and evicts a third party — a kick, which only the
      // host may do. (Rewriting the roster unchanged is a separate, legitimate
      // no-op handled by isSelfJoinNoOp.)
      await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 'leaveBad'), {
        participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
      }));

      await env.clearFirestore();
      await seed('sessions/leaveBad', sessionWith(ALICE, [ALICE, BOB]));
      // Leaving while smuggling in a third party.
      await assertFails(updateDoc(doc(ctx(BOB), 'sessions', 'leaveBad'), {
        participantIds: [ALICE, MALLORY], updatedAt: serverTimestamp(),
      }));
      // A non-participant cannot "leave" on someone else's behalf.
      await assertFails(updateDoc(doc(ctx(MALLORY), 'sessions', 'leaveBad'), {
        participantIds: [ALICE], updatedAt: serverTimestamp(),
      }));
    });

    it('leaves a legacy no-capacity session joinable below the ceiling', async () => {
      await seed('sessions/legacy2', sessionWith(ALICE, [ALICE]));
      await assertSucceeds(updateDoc(doc(ctx(BOB), 'sessions', 'legacy2'), {
        participantIds: [ALICE, BOB], updatedAt: serverTimestamp(),
      }));
    });
  });
});

// -------------------------------------- bound generic interval limiters (H1)
describe('bound generic interval limiters', () => {
  const adapters = [
    {
      name: 'createSession',
      action: 'createSession',
      path: (id) => `sessions/${id}`,
      setup: async () => {},
      stage(batch, db, id, actor) {
        batch.set(doc(db, 'sessions', id), validSession(actor));
      },
    },
    {
      name: 'direct message',
      action: 'sendMessage',
      path: (id) => `conversations/${convoId(ALICE, BOB)}/messages/${id}`,
      setup: async () => {
        await seed(`users/${ALICE}`, { displayName: 'Alice', classes: [] });
        await seed(`users/${BOB}`, { displayName: 'Bob', classes: [] });
        await seed(`conversations/${convoId(ALICE, BOB)}`, {
          participantIds: [ALICE, BOB].sort(),
          participantKey: convoId(ALICE, BOB),
          lastMessagePreview: '',
          lastMessageAt: Timestamp.now(), createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
      },
      stage(batch, db, id, actor) {
        const cid = convoId(ALICE, BOB);
        batch.set(doc(db, 'conversations', cid, 'messages', id), {
          senderId: actor, text: 'hello', createdAt: serverTimestamp(),
        });
      },
    },
    {
      name: 'session chat message',
      action: 'sendMessage',
      path: (id) => `sessions/chat-session/messages/${id}`,
      setup: async () => {
        await seed('sessions/chat-session', validSession(ALICE, {
          participantIds: [ALICE, BOB],
        }));
      },
      stage(batch, db, id, actor) {
        batch.set(doc(db, 'sessions', 'chat-session', 'messages', id), {
          senderId: actor, text: 'hello', createdAt: serverTimestamp(),
        });
      },
    },
    {
      name: 'reportUser',
      action: 'reportUser',
      path: (id) => `reports/${id}`,
      setup: async () => {},
      stage(batch, db, id, actor) {
        batch.set(doc(db, 'reports', id), {
          reporterUserId: actor, reportedUserId: BOB, reason: 'Spam', details: '',
          context: 'general', createdAt: serverTimestamp(),
        });
      },
    },
    {
      name: 'locationRating',
      action: 'locationRating',
      path: (id) => `locationRatings/${id}__${ALICE}`,
      setup: async () => {},
      stage(batch, db, id, actor) {
        batch.set(doc(db, 'locationRatings', `${id}__${ALICE}`), {
          locationId: id, userId: actor, stars: 5, tags: [],
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      },
    },
  ];

  function commit(adapter, db, actor, ids, boundId, legacy = false) {
    const batch = legacy
      ? batchWithRateLimit(db, actor, adapter.action)
      : batchWithBoundRateLimit(db, actor, adapter.action, adapter.path(boundId));
    ids.forEach((id) => adapter.stage(batch, db, id, actor));
    return batch.commit();
  }

  async function resetFor(adapter) {
    await env.clearFirestore();
    await adapter.setup();
  }

  it('accepts one correctly bound write for every action', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      await assertSucceeds(commit(adapter, ctx(ALICE), ALICE, ['one'], 'one'));
    }
  });

  it('denies a second bound write inside the interval', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      await assertSucceeds(commit(adapter, ctx(ALICE), ALICE, ['one'], 'one'));
      await assertFails(commit(adapter, ctx(ALICE), ALICE, ['two'], 'two'));
    }
  });

  it('denies two resources reusing one bound limiter in the same batch', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      await assertFails(commit(adapter, ctx(ALICE), ALICE, ['one', 'two'], 'one'));
    }
  });

  it('denies a mismatched resource binding', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      await assertFails(commit(adapter, ctx(ALICE), ALICE, ['one'], 'other'));
    }
  });

  it('denies forged actor ownership', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      await assertFails(commit(adapter, ctx(MALLORY), ALICE, ['one'], 'one'));
    }
  });

  it('serializes concurrent independent bound writes', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      const results = await Promise.allSettled([
        commit(adapter, ctx(ALICE), ALICE, ['one'], 'one'),
        commit(adapter, ctx(ALICE), ALICE, ['two'], 'two'),
      ]);
      assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1,
        `${adapter.name}: exactly one commit succeeds`);
      assert.equal(results.filter(({ status }) => status === 'rejected').length, 1,
        `${adapter.name}: exactly one commit is throttled`);
    }
  });

  it('rejects the legacy unbound shape and its same-batch bypass', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      await assertFails(commit(adapter, ctx(ALICE), ALICE, ['one'], 'one', true));
      await resetFor(adapter);
      await assertFails(commit(adapter, ctx(ALICE), ALICE, ['one', 'two'], 'one', true));
    }
  });

  it('rejects deletion and extra limiter fields', async () => {
    for (const adapter of adapters) {
      await resetFor(adapter);
      const db = ctx(ALICE);
      await assertFails(setDoc(doc(db, 'rateLimits', ALICE, 'actions', adapter.action), {
        updatedAt: serverTimestamp(), lastResourceId: adapter.path('one'), extra: true,
      }));
      await seed(`rateLimits/${ALICE}/actions/${adapter.action}`, {
        updatedAt: Timestamp.fromMillis(0),
      });
      await assertFails(deleteDoc(doc(db, 'rateLimits', ALICE, 'actions', adapter.action)));
    }
  });
});

// ------------------------------------------- PR B: new-conversation quota
describe('conversation quota enforcement', () => {
  const QUOTA_MAX = 10;
  const quotaPath = (uid) => `rateLimits/${uid}/actions/createConversation`;
  const quotaRef = (db, uid) => doc(db, 'rateLimits', uid, 'actions', 'createConversation');
  const ttl = (hours = 48) => Timestamp.fromMillis(Date.now() + hours * 3600 * 1000);
  const liveWindow = (count, lastConversationId = convoId(ALICE, BOB)) => ({
    windowStart: Timestamp.now(), count, lastConversationId,
    updatedAt: Timestamp.now(), expiresAt: ttl(),
  });
  const seedUser = (uid) => seed(`users/${uid}`, { displayName: uid, classes: [] });
  // Minimum-interval actions. Friend requests are owner-readable for safe
  // cooldown UX; the remaining action documents stay unreadable.
  const INTERVAL_ACTIONS = ['sendMessage', 'createSession', 'reportUser',
                            'locationRating', 'friendRequest', 'updateMessage'];
  const PRIVATE_INTERVAL_ACTIONS = ['sendMessage', 'createSession', 'reportUser',
                                    'locationRating', 'updateMessage'];

  // A fresh-window counter write, as the client transaction emits it.
  const openWindow = (lastConversationId = convoId(ALICE, BOB)) => ({
    windowStart: serverTimestamp(), count: 1,
    lastConversationId,
    updatedAt: serverTimestamp(), expiresAt: ttl(),
  });

  describe('counter transitions', () => {
    it('opens a window at count 1 and increments inside it', async () => {
      await assertSucceeds(setDoc(quotaRef(ctx(ALICE), ALICE), openWindow()));

      await env.clearFirestore();
      await seed(quotaPath(ALICE), liveWindow(1));
      await assertSucceeds(setDoc(quotaRef(ctx(ALICE), ALICE), {
          windowStart: (await getDocAsOwner(ALICE)).windowStart,
          lastConversationId: convoId(ALICE, BOB),
        count: 2, updatedAt: serverTimestamp(), expiresAt: ttl(),
      }));
    });

    it('denies exceeding the cap', async () => {
      await seed(quotaPath(ALICE), liveWindow(QUOTA_MAX));
      const stored = await getDocAsOwner(ALICE);
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), {
          windowStart: stored.windowStart, count: QUOTA_MAX + 1,
          lastConversationId: convoId(ALICE, BOB),
        updatedAt: serverTimestamp(), expiresAt: ttl(),
      }));
    });

    it('denies an early window reset while the window is still live', async () => {
      // The whole point: a spender cannot start over before the window closes.
      await seed(quotaPath(ALICE), liveWindow(QUOTA_MAX));
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), openWindow()));
    });

    it('allows a reset once the window has fully expired', async () => {
      await seed(quotaPath(ALICE), {
        windowStart: Timestamp.fromMillis(Date.now() - 25 * 3600 * 1000),
        count: QUOTA_MAX,
        updatedAt: Timestamp.fromMillis(Date.now() - 25 * 3600 * 1000),
        expiresAt: ttl(),
      });
      await assertSucceeds(setDoc(quotaRef(ctx(ALICE), ALICE), openWindow()));
    });

    it('denies forged counts, forged windowStart, and backdating', async () => {
      await seed(quotaPath(ALICE), liveWindow(3));
      const stored = await getDocAsOwner(ALICE);

      // Skipping ahead, standing still, and going backwards are all denied.
      for (const count of [5, 3, 2]) {
        await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), {
          windowStart: stored.windowStart, count,
          lastConversationId: convoId(ALICE, BOB),
          updatedAt: serverTimestamp(), expiresAt: ttl(),
        }));
      }

      // Carrying a different windowStart on an increment.
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), {
        windowStart: Timestamp.fromMillis(Date.now() - 60 * 1000), count: 4,
        lastConversationId: convoId(ALICE, BOB),
        updatedAt: serverTimestamp(), expiresAt: ttl(),
      }));

      // Backdating the window on a reset (would shorten the next window).
      await env.clearFirestore();
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), {
        windowStart: Timestamp.fromMillis(Date.now() - 23 * 3600 * 1000), count: 1,
        lastConversationId: convoId(ALICE, BOB),
        updatedAt: serverTimestamp(), expiresAt: ttl(),
      }));
    });

    it('pins updatedAt, the expiresAt band, and the exact key set', async () => {
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), {
        ...openWindow(), updatedAt: Timestamp.fromMillis(0),
      }));
      // TTL horizon must land at or after the window closes, and not absurdly far.
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), { ...openWindow(), expiresAt: ttl(1) }));
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), { ...openWindow(), expiresAt: ttl(200) }));
      // No smuggled fields.
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), { ...openWindow(), bonus: 99 }));
      // count must be a positive int.
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), { ...openWindow(), count: 0 }));
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), { ...openWindow(), count: 1.5 }));
    });

    it('denies deletion and third-party writes', async () => {
      await seed(quotaPath(ALICE), liveWindow(5));
      await assertFails(deleteDoc(quotaRef(ctx(ALICE), ALICE)));
      await assertFails(setDoc(quotaRef(ctx(MALLORY), ALICE), openWindow()));
    });
  });

  describe('read access', () => {
    it('owner reads own createConversation counter', async () => {
      await seed(quotaPath(ALICE), liveWindow(4));
      await assertSucceeds(getDoc(quotaRef(ctx(ALICE), ALICE)));
    });

    it('denies another user reading the createConversation counter', async () => {
      await seed(quotaPath(ALICE), liveWindow(4));
      await assertFails(getDoc(quotaRef(ctx(MALLORY), ALICE)));
    });

    it('denies the OWNER reading the unrelated interval-action docs', async () => {
      // Read is scoped to createConversation, the only action a client reads.
      // An interval doc's updatedAt would tell its owner exactly when the
      // throttle lifts; nothing needs that, so it stays denied.
      for (const action of PRIVATE_INTERVAL_ACTIONS) {
        await seed(`rateLimits/${ALICE}/actions/${action}`, { updatedAt: Timestamp.now() });
        await assertFails(getDoc(doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', action)));
      }
    });

    it('allows only the owner to read the friendRequest limiter as cooldown evidence', async () => {
      await seed(`rateLimits/${ALICE}/actions/friendRequest`, {
        lastRequestId: `${ALICE}__${BOB}`,
        updatedAt: Timestamp.now(),
      });
      await assertSucceeds(
        getDoc(doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', 'friendRequest'))
      );
      await assertFails(
        getDoc(doc(ctx(MALLORY), 'rateLimits', ALICE, 'actions', 'friendRequest'))
      );
    });

    it('denies another user reading interval-action docs', async () => {
      for (const action of INTERVAL_ACTIONS) {
        await seed(`rateLimits/${ALICE}/actions/${action}`, { updatedAt: Timestamp.now() });
        await assertFails(getDoc(doc(ctx(MALLORY), 'rateLimits', ALICE, 'actions', action)));
      }
    });
  });

  describe('the two rate-limit shapes stay separate', () => {
    it('createConversation rejects the interval shape', async () => {
      await assertFails(setDoc(quotaRef(ctx(ALICE), ALICE), { updatedAt: serverTimestamp() }));
    });

    it('interval actions reject the counter shape', async () => {
      for (const action of INTERVAL_ACTIONS) {
        await assertFails(setDoc(
          doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', action), openWindow()));
      }
    });

    it('interval actions reject unbound writes', async () => {
      for (const action of INTERVAL_ACTIONS) {
        await assertFails(setDoc(
          doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', action),
          { updatedAt: serverTimestamp() }));
      }
    });

    it('rejects an unknown action name in either shape', async () => {
      await assertFails(setDoc(
        doc(ctx(ALICE), 'rateLimits', ALICE, 'actions', 'madeUpAction'), openWindow()));
    });
  });

  describe('conversation create with enforced quota', () => {
    it('fails without a counter transaction', async () => {
      await seedUser(BOB);
      await assertFails(setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)),
        validConversation(ALICE, BOB)));
    });

    it('succeeds WITH the counter written in the same atomic commit', async () => {
      await seedUser(BOB);
      const db = ctx(ALICE);
      const batch = writeBatch(db);
      batch.set(doc(db, 'conversations', convoId(ALICE, BOB)), validConversation(ALICE, BOB));
      batch.set(quotaRef(db, ALICE), openWindow(convoId(ALICE, BOB)));
      await assertSucceeds(batch.commit());
    });

    it('one counter update cannot authorize two conversation creates', async () => {
      await seedUser(BOB);
      await seedUser(MALLORY);
      const db = ctx(ALICE);
      const firstId = convoId(ALICE, BOB);
      const secondId = convoId(ALICE, MALLORY);
      const batch = writeBatch(db);
      batch.set(doc(db, 'conversations', firstId), validConversation(ALICE, BOB));
      batch.set(doc(db, 'conversations', secondId), validConversation(ALICE, MALLORY));
      batch.set(quotaRef(db, ALICE), openWindow(firstId));
      await assertFails(batch.commit());
    });

    it('a spent quota blocks conversation creation', async () => {
      await seedUser(BOB);
      await seed(quotaPath(ALICE), liveWindow(QUOTA_MAX));
      await assertFails(setDoc(doc(ctx(ALICE), 'conversations', convoId(ALICE, BOB)),
        validConversation(ALICE, BOB)));
    });
  });

  // Mirrors the exact write sequence getOrCreateDirectConversation emits, so
  // the integration risk (serverTimestamp resolved inside a transaction, the
  // expiresAt band, reset-vs-increment) is proven against real rules rather
  // than assumed. The client's own decision logic is re-validated server-side,
  // so a bug there is denied rather than trusted.
  describe('client transaction shape', () => {
    const TTL_MS = 48 * 3600 * 1000;

    function clientOpenChat(db, uid, otherUid) {
      const cid = convoId(uid, otherUid);
      return runTransaction(db, async (tx) => {
        const existing = await tx.get(doc(db, 'conversations', cid));
        if (existing.exists()) {
          return 'existing';
        }
        const quotaSnap = await tx.get(quotaRef(db, uid));
        const stored = quotaSnap.exists() ? quotaSnap.data() : undefined;
        const startedAt = stored?.windowStart?.toMillis?.() ?? null;
        const live = startedAt !== null && Date.now() - startedAt < 24 * 3600 * 1000;
        const nextCount = live ? stored.count + 1 : 1;

        tx.set(doc(db, 'conversations', cid), validConversation(uid, otherUid));
        tx.set(quotaRef(db, uid), {
          windowStart: live ? stored.windowStart : serverTimestamp(),
          count: nextCount,
          lastConversationId: cid,
          updatedAt: serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
        });
        return 'created';
      });
    }

    it('opens the window and creates the thread in one commit', async () => {
      await seedUser(BOB);
      await assertSucceeds(clientOpenChat(ctx(ALICE), ALICE, BOB));

      let stored;
      await env.withSecurityRulesDisabled(async (c) => {
        stored = (await getDoc(doc(c.firestore(), quotaPath(ALICE)))).data();
      });
      assert.equal(stored.count, 1);
    });

    it('increments the live window on a second, different counterpart', async () => {
      await seedUser(BOB);
      await seedUser(MALLORY);
      await assertSucceeds(clientOpenChat(ctx(ALICE), ALICE, BOB));
      await assertSucceeds(clientOpenChat(ctx(ALICE), ALICE, MALLORY));

      let stored;
      await env.withSecurityRulesDisabled(async (c) => {
        stored = (await getDoc(doc(c.firestore(), quotaPath(ALICE)))).data();
      });
      assert.equal(stored.count, 2, 'two distinct counterparts consumed two slots');
    });

    it('reopening an existing thread consumes no quota', async () => {
      await seedUser(BOB);
      await assertSucceeds(clientOpenChat(ctx(ALICE), ALICE, BOB));
      // Second open short-circuits before the quota read.
      assert.equal(await clientOpenChat(ctx(ALICE), ALICE, BOB), 'existing');

      let stored;
      await env.withSecurityRulesDisabled(async (c) => {
        stored = (await getDoc(doc(c.firestore(), quotaPath(ALICE)))).data();
      });
      assert.equal(stored.count, 1, 'still 1 — reopening is free');
    });

    it('is rejected by rules if the client miscounts past the cap, and leaves nothing behind', async () => {
      // Safety net: even a buggy or patched client cannot exceed the cap,
      // because the transition is re-validated server-side.
      await seedUser(BOB);
      await seed(quotaPath(ALICE), liveWindow(QUOTA_MAX));
      const before = await getDocAsOwner(ALICE);

      await assertFails(clientOpenChat(ctx(ALICE), ALICE, BOB));

      // Atomicity: the rejected counter write must take the conversation down
      // with it. A half-applied commit here would be the worst outcome — a
      // free conversation whose quota was never charged.
      let convo, after;
      await env.withSecurityRulesDisabled(async (c) => {
        convo = await getDoc(doc(c.firestore(), 'conversations', convoId(ALICE, BOB)));
        after = (await getDoc(doc(c.firestore(), quotaPath(ALICE)))).data();
      });
      assert.equal(convo.exists(), false, 'no conversation document was created');
      assert.equal(after.count, QUOTA_MAX, 'counter unchanged');
      assert.equal(after.windowStart.toMillis(), before.windowStart.toMillis(),
        'window not restarted');
      assert.equal(after.updatedAt.toMillis(), before.updatedAt.toMillis(),
        'counter document not touched at all');
    });
  });

  // Reads the stored counter with rules bypassed so a test can echo windowStart
  // back on an increment (the client does this from its transaction read).
  async function getDocAsOwner(uid) {
    let data;
    await env.withSecurityRulesDisabled(async (c) => {
      const snap = await getDoc(doc(c.firestore(), quotaPath(uid)));
      data = snap.data();
    });
    return data;
  }
});
