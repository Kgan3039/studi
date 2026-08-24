// tests/notification-validation.test.mjs
// Run: npm run test:notifications  (plain mocha — no emulator needed)
// Unit tests for the notification pipeline's pure helpers: payload
// validation/normalization, internal-route URL rules, and idempotent
// record-ID builders. The client mirrors the URL rules in
// lib/notifications.ts — these tests are the executable spec for both.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import validation from '../functions/notification-validation.js';

const {
  BODY_MAX_LENGTH,
  MAX_GROUP_CHAT_PARTICIPANTS,
  TITLE_MAX_LENGTH,
  blockPairIdsFor,
  dmNotificationId,
  filterBlockedRecipients,
  friendAcceptedNotificationId,
  friendCleanupPathsForBlock,
  friendRequestNotificationId,
  formatSessionChangedFields,
  getSessionChangedFields,
  groupMessageNotificationId,
  isAllowedNotificationUrl,
  isWithinGroupChatFanoutLimit,
  normalizeNotificationPayload,
  reminderNotificationId,
  sessionEventNotificationId,
} = validation;

const CONVO = 'aliceUid__bobUid';

function validPayload(overrides = {}) {
  return {
    type: 'dm_message',
    title: 'New message',
    body: 'see you at Helen C. White!',
    url: `/conversation/${CONVO}`,
    actorId: 'bobUid',
    conversationId: CONVO,
    ...overrides,
  };
}

describe('notification URL allowlist', () => {
  it('accepts every internal route shape', () => {
    assert.equal(isAllowedNotificationUrl('/notifications'), true);
    assert.equal(isAllowedNotificationUrl('/friends'), true);
    assert.equal(isAllowedNotificationUrl(`/conversation/${CONVO}`), true);
    assert.equal(isAllowedNotificationUrl('/session/AbC123_x-9'), true);
    assert.equal(isAllowedNotificationUrl('/session-chat/AbC123_x-9'), true);
    assert.equal(isAllowedNotificationUrl('/user/AbC123_x-9'), true);
  });

  it('holds /user to the same segment rules as the other routes', () => {
    assert.equal(isAllowedNotificationUrl('/user/..'), false);
    assert.equal(isAllowedNotificationUrl('/user/../admin'), false);
    assert.equal(isAllowedNotificationUrl('/user/a%2Fb'), false);
    assert.equal(isAllowedNotificationUrl('/user/'), false);
    assert.equal(isAllowedNotificationUrl('/user'), false);
    assert.equal(isAllowedNotificationUrl('/user/a/b'), false);
    assert.equal(isAllowedNotificationUrl(`/user/${'a'.repeat(201)}`), false);
  });

  it('/friends is exact — no trailing segment', () => {
    assert.equal(isAllowedNotificationUrl('/friends/'), false);
    assert.equal(isAllowedNotificationUrl('/friends/x'), false);
  });

  it('holds /session-chat to the same segment rules as the other routes', () => {
    assert.equal(isAllowedNotificationUrl('/session-chat/..'), false);
    assert.equal(isAllowedNotificationUrl('/session-chat/../admin'), false);
    assert.equal(isAllowedNotificationUrl('/session-chat/a%2Fb'), false);
    assert.equal(isAllowedNotificationUrl('/session-chat/'), false);
    assert.equal(isAllowedNotificationUrl('/session-chat'), false);
    assert.equal(isAllowedNotificationUrl('/session-chat/a/b'), false);
    assert.equal(isAllowedNotificationUrl(`/session-chat/${'a'.repeat(201)}`), false);
  });

  it('rejects traversal and dot segments', () => {
    assert.equal(isAllowedNotificationUrl('/session/..'), false);
    assert.equal(isAllowedNotificationUrl('/session/.'), false);
    assert.equal(isAllowedNotificationUrl('/session/../admin'), false);
    assert.equal(isAllowedNotificationUrl('/conversation/../../session/x'), false);
  });

  it('rejects percent-encoded separators and malformed escapes', () => {
    assert.equal(isAllowedNotificationUrl('/session/a%2Fb'), false);
    assert.equal(isAllowedNotificationUrl('/session/a%2fb'), false);
    assert.equal(isAllowedNotificationUrl('/session/a%5Cb'), false);
    assert.equal(isAllowedNotificationUrl('/session/a%2E%2E'), false);
    assert.equal(isAllowedNotificationUrl('/session/%'), false);
    assert.equal(isAllowedNotificationUrl('/session/%E0%A4%A'), false);
  });

  it('rejects external schemes and protocol-relative forms', () => {
    assert.equal(isAllowedNotificationUrl('https://evil.example/session/x'), false);
    assert.equal(isAllowedNotificationUrl('studi://session/x'), false);
    assert.equal(isAllowedNotificationUrl('javascript:alert(1)'), false);
    assert.equal(isAllowedNotificationUrl('//evil.example'), false);
  });

  it('rejects malformed, empty, or overlong IDs and extra segments', () => {
    assert.equal(isAllowedNotificationUrl('/session/'), false);
    assert.equal(isAllowedNotificationUrl('/session'), false);
    assert.equal(isAllowedNotificationUrl('/session/a/b'), false);
    assert.equal(isAllowedNotificationUrl('/session/a b'), false);
    assert.equal(isAllowedNotificationUrl('/session/a?x=1'), false);
    assert.equal(isAllowedNotificationUrl('/session/a#f'), false);
    assert.equal(isAllowedNotificationUrl(`/session/${'a'.repeat(201)}`), false);
    assert.equal(isAllowedNotificationUrl('/profile/abc'), false);
    assert.equal(isAllowedNotificationUrl(''), false);
    assert.equal(isAllowedNotificationUrl(null), false);
    assert.equal(isAllowedNotificationUrl(42), false);
  });
});

describe('notification payload validation', () => {
  it('accepts a valid payload and trims/bounds text', () => {
    const normalized = normalizeNotificationPayload(
      validPayload({ title: `  padded title  `, body: 'x'.repeat(BODY_MAX_LENGTH + 50) })
    );
    assert.ok(normalized);
    assert.equal(normalized.title, 'padded title');
    assert.equal(normalized.body.length, BODY_MAX_LENGTH);
    assert.ok(normalized.title.length <= TITLE_MAX_LENGTH);
    assert.equal(normalized.url, `/conversation/${CONVO}`);
    assert.equal(normalized.conversationId, CONVO);
  });

  it('rejects unknown types and non-object input', () => {
    assert.equal(normalizeNotificationPayload(validPayload({ type: 'marketing_blast' })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ type: undefined })), null);
    assert.equal(normalizeNotificationPayload(null), null);
    assert.equal(normalizeNotificationPayload('dm_message'), null);
  });

  it('rejects empty or non-string title/body', () => {
    assert.equal(normalizeNotificationPayload(validPayload({ title: '   ' })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ body: '' })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ title: 42 })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ body: undefined })), null);
  });

  it('rejects payloads whose url fails the route allowlist', () => {
    assert.equal(
      normalizeNotificationPayload(validPayload({ url: 'https://evil.example/x' })),
      null
    );
    assert.equal(normalizeNotificationPayload(validPayload({ url: '/session/../x' })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ url: undefined })), null);
  });

  it('rejects unsafe optional IDs but allows their absence', () => {
    assert.equal(normalizeNotificationPayload(validPayload({ actorId: 'a/b' })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ sessionId: '..' })), null);
    assert.equal(normalizeNotificationPayload(validPayload({ conversationId: '' })), null);
    const minimal = normalizeNotificationPayload({
      type: 'session_reminder',
      title: 'Starting soon',
      body: 'CS 354 starts in about 25 min.',
      url: '/session/s1',
    });
    assert.ok(minimal);
    assert.equal('actorId' in minimal, false);
  });
});

describe('idempotent record IDs (CloudEvent-keyed)', () => {
  it('DM: retries of one event dedupe; no cross-conversation collision', () => {
    // Same CloudEvent delivered twice (retry) → identical ID.
    assert.equal(dmNotificationId(CONVO, 'event-1'), dmNotificationId(CONVO, 'event-1'));
    // Different messages are different events → distinct IDs.
    assert.notEqual(dmNotificationId(CONVO, 'event-1'), dmNotificationId(CONVO, 'event-2'));
    // Same event ID string in another conversation can never collide.
    assert.notEqual(
      dmNotificationId('aliceUid__caraUid', 'event-1'),
      dmNotificationId(CONVO, 'event-1')
    );
  });

  it('session joins: leave/rejoin (new events) notify again, retries dedupe', () => {
    const firstJoin = sessionEventNotificationId('join', 'event-join-1');
    const retry = sessionEventNotificationId('join', 'event-join-1');
    const rejoin = sessionEventNotificationId('join', 'event-join-2');
    assert.equal(firstJoin, retry);
    assert.notEqual(firstJoin, rejoin);
  });

  it('cancel/reopen/cancel produces distinct records per cancel event', () => {
    assert.notEqual(
      sessionEventNotificationId('cancel', 'event-cancel-1'),
      sessionEventNotificationId('cancel', 'event-cancel-2')
    );
  });

  it('reverting to a prior time/location still notifies (no state hashing)', () => {
    // Two edits that land on identical session state are still two events.
    assert.notEqual(
      sessionEventNotificationId('update', 'event-edit-1'),
      sessionEventNotificationId('update', 'event-edit-3')
    );
  });

  it('reminders: one per uid per session start occurrence', () => {
    const start = 1786000000000;
    assert.equal(
      reminderNotificationId('s1', 'aliceUid', start),
      reminderNotificationId('s1', 'aliceUid', start)
    );
    // Rescheduled session (new startTime) legitimately reminds again.
    assert.notEqual(
      reminderNotificationId('s1', 'aliceUid', start),
      reminderNotificationId('s1', 'aliceUid', start + 3_600_000)
    );
    assert.notEqual(
      reminderNotificationId('s1', 'aliceUid', start),
      reminderNotificationId('s1', 'bobUid', start)
    );
    assert.notEqual(
      reminderNotificationId('s1', 'aliceUid', start),
      reminderNotificationId('s2', 'aliceUid', start)
    );
  });

  it('group messages: retries dedupe, new messages notify, sessions never collide', () => {
    // Same CloudEvent delivered twice (retry) → identical ID.
    assert.equal(
      groupMessageNotificationId('s1', 'event-1'),
      groupMessageNotificationId('s1', 'event-1')
    );
    // Every new message is a new event → distinct IDs.
    assert.notEqual(
      groupMessageNotificationId('s1', 'event-1'),
      groupMessageNotificationId('s1', 'event-2')
    );
    // Same event ID string under another session can never collide.
    assert.notEqual(
      groupMessageNotificationId('s1', 'event-1'),
      groupMessageNotificationId('s2', 'event-1')
    );
    assert.equal(/^[A-Za-z0-9_-]+$/.test(groupMessageNotificationId('a/b', 'e.v')), true);
  });

  it('sanitizes unexpected characters out of doc IDs', () => {
    const id = dmNotificationId('a/b', 'e.v/t');
    assert.equal(/^[A-Za-z0-9_-]+$/.test(id), true);
  });

  it('friend request/accepted: retries dedupe, distinct events notify again', () => {
    assert.equal(
      friendRequestNotificationId('event-1'),
      friendRequestNotificationId('event-1')
    );
    assert.notEqual(
      friendRequestNotificationId('event-1'),
      friendRequestNotificationId('event-2')
    );
    assert.equal(
      friendAcceptedNotificationId('event-1'),
      friendAcceptedNotificationId('event-1')
    );
    // request and accepted IDs never collide even on the same event id.
    assert.notEqual(
      friendRequestNotificationId('event-1'),
      friendAcceptedNotificationId('event-1')
    );
    assert.equal(/^[A-Za-z0-9_-]+$/.test(friendRequestNotificationId('e.v/t')), true);
  });
});

describe('session edit notification fields', () => {
  it('describes every attendee-visible host edit', () => {
    const before = {
      classId: 'COMPSCI 300',
      startTime: { seconds: 100, nanoseconds: 0 },
      endTime: { seconds: 200, nanoseconds: 0 },
      locationId: 'college-library',
      capacity: 4,
      title: 'Study Session',
    };
    const after = {
      ...before,
      classId: 'MATH 221',
      startTime: { seconds: 101, nanoseconds: 0 },
      locationId: 'memorial-library',
      capacity: 6,
      title: 'Exam Review',
    };

    const changed = getSessionChangedFields(before, after);
    assert.deepEqual(changed, ['class', 'date/time', 'location', 'capacity', 'title']);
    assert.equal(
      formatSessionChangedFields(changed),
      'class, date/time, location, capacity and title'
    );
  });

  it('ignores participant and metadata-only writes', () => {
    const session = {
      classId: 'COMPSCI 300',
      startTime: { seconds: 100, nanoseconds: 0 },
      endTime: { seconds: 200, nanoseconds: 0 },
      locationId: 'college-library',
      capacity: 4,
      title: 'Study Session',
      participantIds: ['aliceUid'],
      updatedAt: { seconds: 100, nanoseconds: 0 },
    };

    assert.deepEqual(
      getSessionChangedFields(session, { ...session, participantIds: ['aliceUid', 'bobUid'] }),
      []
    );
  });
});

describe('friend cleanup on block (deterministic paths)', () => {
  it('removes both request directions and the sorted-pair friendship', () => {
    // blocker < blocked lexically
    assert.deepEqual(friendCleanupPathsForBlock('aaa', 'bbb'), [
      { collection: 'friendRequests', id: 'aaa__bbb' },
      { collection: 'friendRequests', id: 'bbb__aaa' },
      { collection: 'friendships', id: 'aaa__bbb' },
    ]);
  });

  it('friendship id is always the sorted pair, regardless of block direction', () => {
    // blocker > blocked lexically — friendship id must still be sorted.
    assert.deepEqual(friendCleanupPathsForBlock('zzz', 'aaa'), [
      { collection: 'friendRequests', id: 'zzz__aaa' },
      { collection: 'friendRequests', id: 'aaa__zzz' },
      { collection: 'friendships', id: 'aaa__zzz' },
    ]);
  });
});

describe('group-message block filtering (server-side)', () => {
  // onSessionMessageCreated removes blocked recipients BEFORE notifyUser()
  // runs, so a filtered recipient gets neither the persistent record nor the
  // push — and since the filter takes no preference input, no
  // notificationPrefs value can resurrect a blocked notification. (Prefs are
  // applied later, inside notifyUser, and only ever suppress the push.)
  const SENDER = 'senderUid';
  const RECIPIENTS = ['bobUid', 'caraUid', 'danUid'];

  it('returns both block-doc directions for a pair', () => {
    assert.deepEqual(blockPairIdsFor('a', 'b'), ['a__b', 'b__a']);
  });

  it('sender-blocked-recipient is excluded — no record, no push', () => {
    const blocks = new Set(['senderUid__bobUid']); // sender blocked bob
    assert.deepEqual(
      filterBlockedRecipients(SENDER, RECIPIENTS, blocks),
      ['caraUid', 'danUid']
    );
  });

  it('recipient-blocked-sender is excluded — no record, no push', () => {
    const blocks = new Set(['caraUid__senderUid']); // cara blocked the sender
    assert.deepEqual(
      filterBlockedRecipients(SENDER, RECIPIENTS, blocks),
      ['bobUid', 'danUid']
    );
  });

  it('unrelated participants still notify; blocks between recipients are irrelevant', () => {
    // bob and cara blocked each other — neither is blocked against the sender.
    const blocks = new Set(['bobUid__caraUid', 'caraUid__bobUid']);
    assert.deepEqual(filterBlockedRecipients(SENDER, RECIPIENTS, blocks), RECIPIENTS);
  });

  it('no blocks means everyone stays; both directions at once still exclude once', () => {
    assert.deepEqual(filterBlockedRecipients(SENDER, RECIPIENTS, new Set()), RECIPIENTS);
    const blocks = new Set(['senderUid__danUid', 'danUid__senderUid']);
    assert.deepEqual(
      filterBlockedRecipients(SENDER, RECIPIENTS, blocks),
      ['bobUid', 'caraUid']
    );
  });
});

describe('group-chat fanout ceiling', () => {
  // Judged on the actual participant count, never the optional capacity
  // field — a legacy uncapped session is bounded by the same ceiling. The
  // same 20 is hardcoded in firestore.rules (messages create) and mirrored
  // in lib/firestore.ts.
  it('a full 20-participant session (legacy or capped) fans out', () => {
    assert.equal(MAX_GROUP_CHAT_PARTICIPANTS, 20);
    assert.equal(isWithinGroupChatFanoutLimit(20), true);
    assert.equal(isWithinGroupChatFanoutLimit(2), true);
  });

  it('21 participants (legacy uncapped session) do not fan out', () => {
    assert.equal(isWithinGroupChatFanoutLimit(21), false);
    assert.equal(isWithinGroupChatFanoutLimit(500), false);
  });

  it('non-integer counts never pass', () => {
    assert.equal(isWithinGroupChatFanoutLimit(Number.NaN), false);
    assert.equal(isWithinGroupChatFanoutLimit('20'), false);
    assert.equal(isWithinGroupChatFanoutLimit(undefined), false);
  });
});

describe('group-message lifecycle notification wiring', () => {
  const functionSource = readFileSync('functions/index.js', 'utf8');
  const groupTrigger = functionSource.slice(
    functionSource.indexOf('exports.onSessionMessageCreated'),
    functionSource.indexOf('exports.onSessionParticipantsUpdated')
  );

  it('re-reads current content and suppresses a delayed push after unsend', () => {
    assert.match(groupTrigger, /event\.data\.ref\.get\(\)/);
    assert.match(groupTrigger, /currentMessage\.unsentAt \|\| !currentText/);
    assert.match(groupTrigger, /body: `\$\{senderName\}: \$\{currentText\}`/);
  });
});
