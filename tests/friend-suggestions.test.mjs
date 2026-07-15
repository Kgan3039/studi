// tests/friend-suggestions.test.mjs
// Run: npm run test:friends  (plain mocha — no emulator needed)
// Unit tests for the pure suggestion ranking/filtering in
// functions/friend-suggestions.js. The getFriendSuggestions callable wires
// bounded Admin reads to buildFriendSuggestions; these tests pin the
// exclusion, dedupe, ranking, and bound rules independently of Firebase.

import { strict as assert } from 'node:assert';
import suggestions from '../functions/friend-suggestions.js';

const { buildFriendSuggestions, MAX_SUGGESTIONS } = suggestions;

const SENDER = 'senderUid';
const MY_CLASSES = ['CS 300', 'MATH 221', 'STAT 240'];

function candidate(uid, classes = ['CS 300'], displayName = uid) {
  return { uid, displayName, classes };
}

describe('friend suggestions — exclusions and bounds', () => {
  it('never suggests the caller', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate(SENDER), candidate('bob')],
      excludedUids: new Set(),
      existingBlockIds: new Set(),
    });
    assert.deepEqual(out.map((s) => s.uid), ['bob']);
  });

  it('excludes an already-friend candidate even if beyond the first page', () => {
    // The caller pre-loads the full friend id set; a friend from page 2 is in it.
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate('friendFromPage2'), candidate('stranger')],
      excludedUids: new Set(['friendFromPage2']),
      existingBlockIds: new Set(),
    });
    assert.deepEqual(out.map((s) => s.uid), ['stranger']);
  });

  it('excludes a pending-request candidate even if beyond the first page', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate('requestedPage2'), candidate('stranger')],
      excludedUids: new Set(['requestedPage2']),
      existingBlockIds: new Set(),
    });
    assert.deepEqual(out.map((s) => s.uid), ['stranger']);
  });

  it('excludes a candidate the sender blocked', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate('blockedByMe'), candidate('ok')],
      excludedUids: new Set(),
      existingBlockIds: new Set([`${SENDER}__blockedByMe`]),
    });
    assert.deepEqual(out.map((s) => s.uid), ['ok']);
  });

  it('excludes a candidate who blocked the sender', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate('blockedMe'), candidate('ok')],
      excludedUids: new Set(),
      existingBlockIds: new Set([`blockedMe__${SENDER}`]),
    });
    assert.deepEqual(out.map((s) => s.uid), ['ok']);
  });

  it('drops candidates with no shared class', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate('noOverlap', ['HIST 101']), candidate('overlap', ['CS 300'])],
      excludedUids: new Set(),
      existingBlockIds: new Set(),
    });
    assert.deepEqual(out.map((s) => s.uid), ['overlap']);
  });

  it('deduplicates repeated candidate uids', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [candidate('dup'), candidate('dup'), candidate('dup')],
      excludedUids: new Set(),
      existingBlockIds: new Set(),
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].uid, 'dup');
  });

  it('ranks by shared-class count, then name', () => {
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: [
        candidate('one', ['CS 300'], 'Zed'),
        candidate('three', ['CS 300', 'MATH 221', 'STAT 240'], 'Ada'),
        candidate('two', ['CS 300', 'MATH 221'], 'Bea'),
      ],
      excludedUids: new Set(),
      existingBlockIds: new Set(),
    });
    assert.deepEqual(out.map((s) => s.uid), ['three', 'two', 'one']);
    assert.deepEqual(out[0].sharedClasses, ['CS 300', 'MATH 221', 'STAT 240']);
  });

  it('bounds the result count to the cap', () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 25 }, (_, i) =>
      candidate(`u${String(i).padStart(3, '0')}`)
    );
    const out = buildFriendSuggestions({
      senderUid: SENDER,
      myClasses: MY_CLASSES,
      candidates: many,
      excludedUids: new Set(),
      existingBlockIds: new Set(),
    });
    assert.equal(out.length, MAX_SUGGESTIONS);
  });
});
