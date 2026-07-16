// tests/friend-suggestions.test.mjs
// Run: npm run test:friends  (plain mocha — no emulator needed)
// Unit tests for the pure suggestion ranking/filtering in
// functions/friend-suggestions.js. The getFriendSuggestions callable wires
// bounded Admin reads to buildFriendSuggestions; these tests pin the
// exclusion, dedupe, ranking, and bound rules independently of Firebase.

import { strict as assert } from 'node:assert';
import suggestions from '../functions/friend-suggestions.js';
import pairId from '../functions/pair-id.js';

const {
  buildFriendSuggestions,
  MAX_SUGGESTIONS,
  MAX_SUGGESTION_READS,
  CANDIDATE_SCAN_LIMIT,
  RELATIONSHIP_DOCS_PER_CANDIDATE,
  isCandidateExcludedByExistence,
  relationshipDocRefsForCandidate,
} = suggestions;
const { isSafeUid, directedPairId, sortedPairId, parsePairMembers } = pairId;

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

describe('friend suggestions — per-candidate deterministic exclusion (bounded)', () => {
  const CAND = 'candidateUid';

  it('checks exactly five deterministic docs per candidate', () => {
    const refs = relationshipDocRefsForCandidate(SENDER, CAND);
    assert.equal(refs.length, RELATIONSHIP_DOCS_PER_CANDIDATE);
    assert.deepEqual(refs, [
      { collection: 'friendships', id: sortedPairId(SENDER, CAND) },
      { collection: 'friendRequests', id: directedPairId(SENDER, CAND) },
      { collection: 'friendRequests', id: directedPairId(CAND, SENDER) },
      { collection: 'userBlocks', id: directedPairId(SENDER, CAND) },
      { collection: 'userBlocks', id: directedPairId(CAND, SENDER) },
    ]);
  });

  it('documented worst-case read bound is 1 + 40 + 40*5 = 241', () => {
    assert.equal(CANDIDATE_SCAN_LIMIT, 40);
    assert.equal(RELATIONSHIP_DOCS_PER_CANDIDATE, 5);
    assert.equal(MAX_SUGGESTION_READS, 241);
  });

  // The exclusion is per-pair, so a friend/request/block is caught by the
  // candidate's OWN five docs — independent of how many OTHER relationships the
  // caller has (e.g. 500+ friends beyond any page cap).
  it('excludes when the friendship doc exists (even with 500+ unrelated rels)', () => {
    const unrelated = new Set(
      Array.from({ length: 600 }, (_, i) => `friendships/${sortedPairId(SENDER, `other${i}`)}`)
    );
    unrelated.add(`friendships/${sortedPairId(SENDER, CAND)}`);
    assert.equal(isCandidateExcludedByExistence(SENDER, CAND, unrelated), true);
  });

  it('excludes when an outgoing OR incoming request doc exists', () => {
    assert.equal(
      isCandidateExcludedByExistence(SENDER, CAND, new Set([`friendRequests/${directedPairId(SENDER, CAND)}`])),
      true
    );
    assert.equal(
      isCandidateExcludedByExistence(SENDER, CAND, new Set([`friendRequests/${directedPairId(CAND, SENDER)}`])),
      true
    );
  });

  it('excludes when a block doc exists in either direction', () => {
    assert.equal(
      isCandidateExcludedByExistence(SENDER, CAND, new Set([`userBlocks/${directedPairId(SENDER, CAND)}`])),
      true
    );
    assert.equal(
      isCandidateExcludedByExistence(SENDER, CAND, new Set([`userBlocks/${directedPairId(CAND, SENDER)}`])),
      true
    );
  });

  it('does NOT exclude when only unrelated docs exist', () => {
    const unrelated = new Set([
      `friendships/${sortedPairId(SENDER, 'someoneElse')}`,
      `friendRequests/${directedPairId(SENDER, 'anotherPerson')}`,
      `userBlocks/${directedPairId('x', 'y')}`,
    ]);
    assert.equal(isCandidateExcludedByExistence(SENDER, CAND, unrelated), false);
  });
});

describe('pair-id encoding (shared helper)', () => {
  it('rejects empty components', () => {
    assert.equal(parsePairMembers('__x'), null);
    assert.equal(parsePairMembers('x__'), null);
    assert.equal(parsePairMembers('__'), null);
  });

  it('rejects malformed ids (no separator, >2 parts)', () => {
    assert.equal(parsePairMembers('nosep'), null);
    assert.equal(parsePairMembers('a__b__c'), null);
    assert.equal(parsePairMembers(42), null);
  });

  it('rejects self-pairs', () => {
    assert.equal(parsePairMembers('x__x'), null);
  });

  it('parses a well-formed pair id into its two members', () => {
    assert.deepEqual(parsePairMembers('aaa__bbb'), ['aaa', 'bbb']);
  });

  it('constrains uids to [A-Za-z0-9] so `__` can never be ambiguous', () => {
    // Documented decision: Studi uids are Firebase [A-Za-z0-9] email/password
    // uids. `_` and `-` are rejected, so a component can never contain `__`.
    assert.equal(isSafeUid('AbC123'), true);
    assert.equal(isSafeUid('a_b'), false);
    assert.equal(isSafeUid('a-b'), false);
    assert.equal(isSafeUid('a__b'), false);
    assert.equal(isSafeUid(''), false);
    assert.equal(isSafeUid('x'.repeat(129)), false);
    assert.equal(isSafeUid('x'.repeat(128)), true);
  });

  it('sorted friendship id is stable regardless of argument order', () => {
    assert.equal(sortedPairId('aaa', 'bbb'), sortedPairId('bbb', 'aaa'));
    assert.equal(sortedPairId('bbb', 'aaa'), 'aaa__bbb');
  });

  it('directed request id preserves direction', () => {
    assert.equal(directedPairId('aaa', 'bbb'), 'aaa__bbb');
    assert.notEqual(directedPairId('aaa', 'bbb'), directedPairId('bbb', 'aaa'));
  });
});
