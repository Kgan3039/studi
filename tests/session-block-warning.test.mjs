// tests/session-block-warning.test.mjs
// Run: npm run test:session-blocks  (plain mocha — no emulator needed)
//
// Covers the guarded join in lib/session-block-warning.js, plus a source-level
// check that every join surface actually routes through it.
//
// This repo has no jest or react-test-renderer harness, so the decision core
// takes its data through injected fetchers and is exercised directly here. The
// remaining gap is the adapter: lib/guarded-session-join.ts binds these
// fetchers to Firestore and renders the confirm request as an Alert, and that
// binding is verified by reading the diff, not by a test. See the "join surface
// routing" block below for what is pinned mechanically.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';

import warning from '../lib/session-block-warning.js';

const {
  BLOCKED_WARNING_BODY,
  BLOCKED_WARNING_CANCEL_LABEL,
  BLOCKED_WARNING_CONFIRM_LABEL,
  BLOCKED_WARNING_TITLE,
  BLOCKED_WARNING_VERIFICATION_ERROR,
  __resetGuardedJoinsForTests,
  blockedParticipantIds,
  isGuardedJoinInFlight,
  requestGuardedSessionJoin,
} = warning;

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const SESSION = 'session-1';
const ME = 'me';
const HOST = 'hostUid';
const FRIEND = 'friendUid';
const BLOCKED_A = 'blockedA';
const BLOCKED_B = 'blockedB';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Stands in for a screen: records the confirm request instead of rendering an
// Alert, records join() instead of hitting Firestore, records tracked events.
// `participants` / `blocked` may be an array, or a function (sync or async) so
// a test can change the answer between attempts or throw.
function start({ participants = [], blocked = [], sessionId = SESSION, join } = {}) {
  const events = [];
  const requests = [];
  const errors = [];
  const calls = { participants: 0, blocked: 0 };
  let joins = 0;

  const resolveSource = async (source) => (typeof source === 'function' ? source() : source);

  const promise = requestGuardedSessionJoin({
    sessionId,
    fetchParticipantIds: async () => {
      calls.participants += 1;
      return resolveSource(participants);
    },
    fetchBlockedUserIds: async () => {
      calls.blocked += 1;
      return resolveSource(blocked);
    },
    confirm: (request) => requests.push(request),
    join:
      join ??
      (() => {
        joins += 1;
      }),
    onVerificationError: (message) => errors.push(message),
    track: (event, properties) => events.push([event, properties]),
  });

  return {
    promise,
    calls,
    events,
    errors,
    eventNames: () => events.map(([name]) => name),
    joins: () => joins,
    request: () => requests[0],
    requestCount: () => requests.length,
  };
}

// Runs an attempt to completion, answering the warning (if any) with `answer`.
async function attempt(options, answer) {
  const run = start(options);
  await flush();

  if (run.requestCount() > 0) {
    if (answer === 'confirm') {
      run.request().onConfirm();
    } else if (answer === 'cancel') {
      run.request().onCancel();
    }
  }

  run.result = await run.promise;
  return run;
}

beforeEach(() => {
  __resetGuardedJoinsForTests();
});

describe('blockedParticipantIds', () => {
  it('returns only participants the current user has blocked', () => {
    assert.deepEqual(
      blockedParticipantIds([HOST, BLOCKED_A, FRIEND], [BLOCKED_A, BLOCKED_B]),
      [BLOCKED_A]
    );
  });

  it('ignores blocked users who are not in this session', () => {
    assert.deepEqual(blockedParticipantIds([HOST, FRIEND], [BLOCKED_A]), []);
  });

  it('covers a blocked host, who is a participant like anyone else', () => {
    assert.deepEqual(blockedParticipantIds([BLOCKED_A, ME], [BLOCKED_A]), [BLOCKED_A]);
  });

  it('deduplicates and keeps roster order', () => {
    assert.deepEqual(
      blockedParticipantIds([BLOCKED_B, HOST, BLOCKED_A, BLOCKED_B], [BLOCKED_A, BLOCKED_B]),
      [BLOCKED_B, BLOCKED_A]
    );
  });

  it('is empty for missing or malformed input rather than throwing', () => {
    assert.deepEqual(blockedParticipantIds(undefined, [BLOCKED_A]), []);
    assert.deepEqual(blockedParticipantIds([HOST], undefined), []);
    assert.deepEqual(blockedParticipantIds([HOST, null, 7], ['', null]), []);
  });
});

describe('guarded join — the ordinary paths', () => {
  it('joins once when no participant is blocked, warning about nothing', async () => {
    const run = await attempt({ participants: [HOST, FRIEND], blocked: [BLOCKED_A] });

    assert.equal(run.requestCount(), 0, 'no warning shown');
    assert.equal(run.joins(), 1, 'join ran straight through');
    assert.deepEqual(run.eventNames(), [], 'the ordinary path tracks nothing new');
    assert.deepEqual(run.result, { status: 'joined', warned: false, blockedCount: 0 });
  });

  it('joins once when the user has blocked nobody at all', async () => {
    const run = await attempt({ participants: [HOST, FRIEND], blocked: [] });

    assert.equal(run.requestCount(), 0);
    assert.equal(run.joins(), 1);
  });

  it('warns and withholds the join until the user answers', async () => {
    const run = start({ participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A] });
    await flush();

    assert.equal(run.requestCount(), 1);
    assert.equal(run.joins(), 0, 'join is withheld until the user answers');
    assert.deepEqual(run.eventNames(), ['blocked_session_warning_shown']);

    run.request().onCancel();
    await run.promise;
  });

  it('uses the approved copy and button labels', async () => {
    const run = start({ participants: [BLOCKED_A], blocked: [BLOCKED_A] });
    await flush();
    const request = run.request();

    assert.equal(request.title, 'Someone you’ve blocked is participating in this study session.');
    assert.equal(
      request.body,
      'Blocking prevents direct communication, but shared study sessions may still contain blocked users.\n\nWould you still like to join?'
    );
    assert.equal(request.cancelLabel, 'Cancel');
    assert.equal(request.confirmLabel, 'Join Anyway');
    // The exported constants are what the adapter renders.
    assert.equal(request.title, BLOCKED_WARNING_TITLE);
    assert.equal(request.body, BLOCKED_WARNING_BODY);
    assert.equal(request.cancelLabel, BLOCKED_WARNING_CANCEL_LABEL);
    assert.equal(request.confirmLabel, BLOCKED_WARNING_CONFIRM_LABEL);

    request.onCancel();
    await run.promise;
  });

  it('Cancel dismisses without joining', async () => {
    const run = await attempt({ participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A] }, 'cancel');

    assert.equal(run.joins(), 0, 'no join attempt was made');
    assert.deepEqual(run.eventNames(), ['blocked_session_warning_shown', 'blocked_session_cancel']);
    assert.equal(run.result.status, 'cancelled');
  });

  it('Join Anyway continues into the existing join flow', async () => {
    const run = await attempt({ participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A] }, 'confirm');

    assert.equal(run.joins(), 1, 'the ordinary join ran, unchanged');
    assert.deepEqual(run.eventNames(), [
      'blocked_session_warning_shown',
      'blocked_session_join_anyway',
    ]);
    assert.deepEqual(run.result, { status: 'joined', warned: true, blockedCount: 1 });
  });

  it('shows a single warning when several participants are blocked', async () => {
    const run = await attempt(
      {
        participants: [HOST, BLOCKED_A, FRIEND, BLOCKED_B],
        blocked: [BLOCKED_A, BLOCKED_B],
      },
      'confirm'
    );

    assert.equal(run.requestCount(), 1, 'one warning, not one per blocked participant');
    assert.deepEqual(run.eventNames(), [
      'blocked_session_warning_shown',
      'blocked_session_join_anyway',
    ]);
    assert.equal(run.events[0][1].blockedCount, 2);
    assert.equal(run.joins(), 1, 'a single confirmation covers the whole session');
  });

  it('settles once — a late second answer changes nothing', async () => {
    // Android can fire a button press and the dialog's onDismiss; only the
    // first answer may count, or a cancel could still end in a join.
    const cancelFirst = start({ participants: [BLOCKED_A], blocked: [BLOCKED_A] });
    await flush();
    cancelFirst.request().onCancel();
    cancelFirst.request().onConfirm();
    await cancelFirst.promise;

    assert.equal(cancelFirst.joins(), 0, 'a cancel cannot be overturned into a join');
    assert.deepEqual(cancelFirst.eventNames(), [
      'blocked_session_warning_shown',
      'blocked_session_cancel',
    ]);

    __resetGuardedJoinsForTests();
    const confirmFirst = start({ participants: [BLOCKED_A], blocked: [BLOCKED_A] });
    await flush();
    confirmFirst.request().onConfirm();
    confirmFirst.request().onConfirm();
    await confirmFirst.promise;

    assert.equal(confirmFirst.joins(), 1, 'the join is not attempted twice');
  });
});

describe('guarded join — fresh data', () => {
  it('re-reads the roster at join time, catching a participant who arrived after load', async () => {
    // The screen loaded with a clean room; BLOCKED_A joined in the meantime.
    const staleRoster = [HOST, FRIEND];
    const currentRoster = [HOST, FRIEND, BLOCKED_A];

    assert.deepEqual(
      blockedParticipantIds(staleRoster, [BLOCKED_A]),
      [],
      'the cached roster would have shown no warning'
    );

    const run = await attempt({ participants: currentRoster, blocked: [BLOCKED_A] }, 'cancel');

    assert.equal(run.calls.participants, 1, 'the roster was fetched, not assumed');
    assert.equal(run.requestCount(), 1, 'the late arrival still triggers the warning');
    assert.equal(run.joins(), 0);
  });

  it('re-reads the block list at join time', async () => {
    const run = await attempt({ participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A] }, 'cancel');

    assert.equal(run.calls.blocked, 1, 'the block list was fetched, not taken from screen state');
  });
});

describe('guarded join — fails closed', () => {
  it('does not join when the block query fails', async () => {
    const run = await attempt({
      participants: [HOST, FRIEND],
      blocked: () => Promise.reject(new Error('permission-denied')),
    });

    assert.equal(run.joins(), 0, 'a failed block query is not "nobody is blocked"');
    assert.equal(run.requestCount(), 0);
    assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
    assert.equal(run.result.status, 'verification-failed');
  });

  it('does not join when the participant query fails', async () => {
    const run = await attempt({
      participants: () => Promise.reject(new Error('unavailable')),
      blocked: [BLOCKED_A],
    });

    assert.equal(run.joins(), 0);
    assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
    assert.equal(run.result.status, 'verification-failed');
  });

  it('does not join when the session roster is unavailable (deleted session)', async () => {
    const run = await attempt({ participants: null, blocked: [] });

    assert.equal(run.joins(), 0, 'a null roster is unverifiable, not empty');
    assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
  });

  it('does not join when the block list is unavailable', async () => {
    const run = await attempt({ participants: [HOST], blocked: () => undefined });

    assert.equal(run.joins(), 0, 'missing block data is not an authoritative empty list');
    assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
  });

  it('does not join, or reveal anything, when the session id is missing', async () => {
    const run = await attempt({ sessionId: '', participants: [HOST], blocked: [] });

    assert.equal(run.joins(), 0);
    assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
  });

  it('never counts a verification failure as a Cancel', async () => {
    const failures = [
      { participants: () => Promise.reject(new Error('x')), blocked: [BLOCKED_A] },
      { participants: [HOST], blocked: () => Promise.reject(new Error('x')) },
      { participants: null, blocked: [] },
      { participants: [HOST], blocked: null },
    ];

    for (const options of failures) {
      __resetGuardedJoinsForTests();
      const run = await attempt(options);
      assert.deepEqual(run.eventNames(), [], 'no outcome event of any kind');
    }
  });

  // Verification is all-or-nothing. Filtering bad entries out would be the
  // dangerous behavior: a roster of [uid, null] would sanitize to [uid], and a
  // block list of [uid, null] would sanitize into a confident answer drawn from
  // a document we could not fully parse.
  describe('malformed data invalidates the whole check', () => {
    const MALFORMED = [
      ['missing participantIds', { participants: () => undefined, blocked: [BLOCKED_A] }],
      ['participantIds is not an array', { participants: () => 'nope', blocked: [BLOCKED_A] }],
      ['participantIds = [validUid, null]', { participants: [HOST, null], blocked: [BLOCKED_A] }],
      ['participantIds = [validUid, ""]', { participants: [HOST, ''], blocked: [BLOCKED_A] }],
      ['participantIds contains a non-string', { participants: [HOST, 7], blocked: [BLOCKED_A] }],
      ['missing blocked ids', { participants: [HOST], blocked: () => undefined }],
      ['blocked ids are not an array', { participants: [HOST], blocked: () => ({}) }],
      ['blocked ids = [validUid, null]', { participants: [HOST], blocked: [BLOCKED_A, null] }],
      ['blocked ids = [validUid, ""]', { participants: [HOST], blocked: [BLOCKED_A, ''] }],
      ['blocked ids contain a non-string', { participants: [HOST], blocked: [BLOCKED_A, 7] }],
    ];

    for (const [label, options] of MALFORMED) {
      it(`fails closed: ${label}`, async () => {
        const run = await attempt(options);

        assert.equal(run.joins(), 0, 'no join');
        assert.equal(run.requestCount(), 0, 'no warning');
        assert.deepEqual(run.eventNames(), [], 'no outcome event');
        assert.deepEqual(
          run.errors,
          [BLOCKED_WARNING_VERIFICATION_ERROR],
          'the retryable verification failure'
        );
        assert.equal(run.result.status, 'verification-failed');
      });
    }

    it('fails closed even when the malformed entry sits beside a blocked participant', async () => {
      // Filtering would have produced a clean [BLOCKED_A] roster here and gone
      // on to warn — a confident answer from a document we could not parse.
      const run = await attempt({ participants: [BLOCKED_A, null], blocked: [BLOCKED_A] });

      assert.equal(run.requestCount(), 0, 'no warning from unverified data');
      assert.equal(run.joins(), 0);
      assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
    });

    it('fails closed when a malformed block entry would have hidden a real block', async () => {
      // [BLOCKED_A, null] filtered to [BLOCKED_A] happens to be right; the
      // point is we cannot know that, so we refuse rather than guess.
      const run = await attempt({ participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A, null] });

      assert.equal(run.joins(), 0, 'never join on a block list we could not parse');
      assert.deepEqual(run.errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
    });

    it('still accepts well-formed empty lists as verified', async () => {
      const run = await attempt({ participants: [], blocked: [] });

      assert.equal(run.joins(), 1, 'an empty roster is verified, not malformed');
      assert.deepEqual(run.errors, []);
    });

    it('releases the guard after a malformed-data failure', async () => {
      await attempt({ participants: [HOST, null], blocked: [] });
      assert.equal(isGuardedJoinInFlight(SESSION), false);

      const retry = await attempt({ participants: [HOST], blocked: [] });
      assert.equal(retry.joins(), 1, 'a retry after a bad read works');
    });
  });

  it('says nothing about blocks in the verification error', () => {
    const message = BLOCKED_WARNING_VERIFICATION_ERROR.toLowerCase();

    assert.equal(message.includes('block'), false, 'the error must not mention blocking');
    assert.equal(
      BLOCKED_WARNING_VERIFICATION_ERROR,
      'We couldn’t verify the session participants. Please try again.'
    );
  });

  it('fails closed rather than joining when the dialog cannot be presented', async () => {
    const events = [];
    const errors = [];
    let joins = 0;

    const result = await requestGuardedSessionJoin({
      sessionId: SESSION,
      fetchParticipantIds: async () => [BLOCKED_A],
      fetchBlockedUserIds: async () => [BLOCKED_A],
      confirm: () => {
        throw new Error('no window to attach to');
      },
      join: () => {
        joins += 1;
      },
      onVerificationError: (message) => errors.push(message),
      track: (event) => events.push(event),
    });

    assert.equal(joins, 0);
    assert.equal(result.status, 'verification-failed');
    assert.deepEqual(errors, [BLOCKED_WARNING_VERIFICATION_ERROR]);
    assert.deepEqual(events, ['blocked_session_warning_shown'], 'asked, never answered');
    assert.equal(isGuardedJoinInFlight(SESSION), false, 'the guard was still released');
  });
});

describe('guarded join — in-flight guard', () => {
  it('ignores rapid repeat taps: one alert, one outcome, one join', async () => {
    const options = { participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A] };

    // Three taps in the same tick, before any await settles.
    const first = start(options);
    const second = start(options);
    const third = start(options);

    await flush();

    assert.equal(first.requestCount(), 1, 'exactly one alert opened');
    assert.equal(second.requestCount(), 0);
    assert.equal(third.requestCount(), 0);

    first.request().onConfirm();

    const [firstResult, secondResult, thirdResult] = await Promise.all([
      first.promise,
      second.promise,
      third.promise,
    ]);

    assert.equal(firstResult.status, 'joined');
    assert.equal(secondResult.status, 'ignored');
    assert.equal(thirdResult.status, 'ignored');
    assert.equal(first.joins(), 1, 'one join attempt');
    assert.equal(second.joins() + third.joins(), 0);
    assert.deepEqual(
      first.eventNames(),
      ['blocked_session_warning_shown', 'blocked_session_join_anyway'],
      'one shown event and one outcome event'
    );
    assert.deepEqual(second.eventNames(), []);
    assert.deepEqual(third.eventNames(), []);
  });

  it('ignores a repeat tap while the fetches are still in flight', async () => {
    const options = { participants: [HOST, FRIEND], blocked: [] };
    const first = start(options);
    const second = start(options);

    const [firstResult, secondResult] = await Promise.all([first.promise, second.promise]);

    assert.equal(firstResult.status, 'joined');
    assert.equal(secondResult.status, 'ignored');
    assert.equal(second.calls.participants, 0, 'the duplicate did not even read');
  });

  it('does not block a different session', async () => {
    const first = start({ participants: [BLOCKED_A], blocked: [BLOCKED_A] });
    const other = start({
      sessionId: 'session-2',
      participants: [HOST],
      blocked: [BLOCKED_A],
    });

    await flush();
    first.request().onCancel();
    await Promise.all([first.promise, other.promise]);

    assert.equal(other.joins(), 1, 'an unrelated session joined normally');
  });

  it('releases the guard after Cancel', async () => {
    const options = { participants: [HOST, BLOCKED_A], blocked: [BLOCKED_A] };
    await attempt(options, 'cancel');

    assert.equal(isGuardedJoinInFlight(SESSION), false);

    const retry = await attempt(options, 'confirm');
    assert.equal(retry.joins(), 1, 'the user can try again');
  });

  it('releases the guard after a verification failure', async () => {
    await attempt({ participants: () => Promise.reject(new Error('x')), blocked: [] });

    assert.equal(isGuardedJoinInFlight(SESSION), false);

    const retry = await attempt({ participants: [HOST], blocked: [] });
    assert.equal(retry.joins(), 1, 'a retry after a transient failure works');
  });

  it('releases the guard after a completed join', async () => {
    const run = await attempt({ participants: [HOST], blocked: [] });

    assert.equal(run.joins(), 1);
    assert.equal(isGuardedJoinInFlight(SESSION), false);

    const again = await attempt({ participants: [HOST], blocked: [] });
    assert.equal(again.joins(), 1, 'a second deliberate tap is allowed');
  });

  it('releases the guard when the join itself throws', async () => {
    await assert.rejects(
      start({
        participants: [HOST],
        blocked: [],
        join: () => Promise.reject(new Error('session full')),
      }).promise,
      /session full/
    );

    assert.equal(isGuardedJoinInFlight(SESSION), false, 'not stuck after a failed join');

    const retry = await attempt({ participants: [HOST], blocked: [] });
    assert.equal(retry.joins(), 1);
  });
});

describe('guarded join — what it must never reveal', () => {
  it('never reads anything about who blocked the current user', async () => {
    let reverseLookups = 0;

    const result = await requestGuardedSessionJoin({
      sessionId: SESSION,
      fetchParticipantIds: async () => [HOST, BLOCKED_A],
      fetchBlockedUserIds: async () => [],
      // Not part of the contract; present only to prove the core never reaches
      // for a reverse-direction source even when one is handed to it.
      fetchBlockedByUserIds: async () => {
        reverseLookups += 1;
        return [HOST];
      },
      confirm: () => assert.fail('a reverse block must not produce a warning'),
      join: () => {},
      onVerificationError: () => assert.fail('a reverse block is not a failure'),
    });

    assert.equal(reverseLookups, 0, 'no reverse-direction query was made');
    assert.equal(result.status, 'joined');
  });

  it('treats a user who blocked me as an ordinary participant', async () => {
    // HOST blocked ME. My outbound list is empty, so from here the room is
    // indistinguishable from one with no blocks at all.
    const run = await attempt({ participants: [HOST, FRIEND], blocked: [] });

    assert.equal(run.requestCount(), 0, 'no warning');
    assert.deepEqual(run.eventNames(), [], 'nothing recorded that could hint at it');
    assert.equal(run.joins(), 1, 'the join is not impeded');
  });

  it('never leaks who was blocked into analytics', async () => {
    const run = await attempt(
      { participants: [HOST, BLOCKED_A, BLOCKED_B], blocked: [BLOCKED_A, BLOCKED_B] },
      'confirm'
    );

    assert.equal(run.events.length, 2);
    for (const [, properties] of run.events) {
      assert.deepEqual(Object.keys(properties).sort(), ['blockedCount', 'sessionId']);
      assert.equal(properties.blockedCount, 2);
      assert.equal(properties.sessionId, SESSION);
    }
  });

  it('never puts a uid in the dialog copy', async () => {
    const run = start({ participants: [BLOCKED_A], blocked: [BLOCKED_A] });
    await flush();
    const request = run.request();

    for (const text of [request.title, request.body]) {
      assert.equal(text.includes(BLOCKED_A), false);
      assert.equal(text.includes(HOST), false);
    }

    request.onCancel();
    await run.promise;
  });
});

// The core above is only worth anything if every screen actually goes through
// it. These read the sources: a new surface that calls joinSession() directly
// fails here rather than shipping unguarded.
describe('join surface routing', () => {
  const SURFACES = [
    'app/session/[sessionId].tsx',
    'app/(tabs)/index.tsx',
    'app/(tabs)/sessions.tsx',
  ];

  const read = (relativePath) => readFileSync(joinPath(REPO_ROOT, relativePath), 'utf8');

  function collectFiles(dir, found = []) {
    for (const entry of readdirSync(dir)) {
      const full = joinPath(dir, entry);
      if (statSync(full).isDirectory()) {
        collectFiles(full, found);
      } else if (/\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
    return found;
  }

  it('knows about every file that calls joinSession()', () => {
    const callers = collectFiles(joinPath(REPO_ROOT, 'app'))
      .filter((file) => /\bjoinSession\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(REPO_ROOT.length))
      .sort();

    assert.deepEqual(
      callers,
      [...SURFACES].sort(),
      'a new join surface appeared — route it through requestGuardedSessionJoin and list it here'
    );
  });

  for (const surface of SURFACES) {
    describe(surface, () => {
      it('imports the guarded join path', () => {
        const source = read(surface);

        assert.match(source, /from '@\/lib\/guarded-session-join'/);
        assert.match(source, /requestGuardedSessionJoin/);
        assert.match(source, /confirmBlockedJoinWithAlert/);
      });

      it('reaches joinSession() only through the guard', () => {
        const source = read(surface);

        const guardedCalls = source.match(/requestGuardedSessionJoin\s*\(/g) ?? [];
        const rawCalls = source.match(/\bjoinSession\s*\(/g) ?? [];
        assert.equal(guardedCalls.length, 1, 'exactly one guarded entry point');
        assert.equal(rawCalls.length, 1, 'exactly one raw join call');

        // The single raw call must live inside performJoin, which is what the
        // guard invokes — and only after the check has passed.
        const performJoinAt = source.indexOf('async function performJoin');
        assert.notEqual(performJoinAt, -1, 'the surface-specific join is named performJoin');
        assert.ok(
          source.indexOf('joinSession(', performJoinAt) > performJoinAt,
          'joinSession() is called inside performJoin'
        );
        assert.match(source, /join: (performJoin|\(\) => performJoin\()/);
      });

      it('fails closed with the shared retryable error', () => {
        assert.match(read(surface), /onVerificationError:/);
      });

      it('does not build its own copy of the warning dialog', () => {
        const source = read(surface);

        assert.equal(source.includes('Join Anyway'), false, 'the copy lives in one place');
        assert.equal(source.includes('you’ve blocked'), false);
      });
    });
  }
});
