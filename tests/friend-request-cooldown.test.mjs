import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import control from '../lib/friend-request-control.js';
import errors from '../lib/friend-request-errors.js';

const {
  FRIEND_REQUEST_COOLDOWN_MS,
  __resetFriendRequestControlForTests,
  canAttemptFriendRequest,
  getFriendRequestCooldownSeconds,
  runFriendRequestSend,
  subscribeToFriendRequestCooldown,
} = control;
const {
  FRIEND_REQUEST_ERROR_COPY,
  FRIEND_REQUEST_ERROR_TITLE,
  FriendRequestAuthError,
  FriendRequestCooldownError,
  mapFriendRequestError,
  showFriendRequestFailure,
} = errors;

const ALICE = 'aliceUid';
const BOB = 'bobUid';

beforeEach(() => __resetFriendRequestControlForTests());

describe('friend-request cooldown control', () => {
  it('starts an absolute ten-second cooldown only after a successful send', async () => {
    let now = 1_000;
    const result = await runFriendRequestSend({
      userId: ALICE,
      now: () => now,
      send: async () => {},
    });
    assert.equal(result.status, 'sent');
    assert.equal(getFriendRequestCooldownSeconds(ALICE, now), 10);
    assert.equal(canAttemptFriendRequest(ALICE, now), false);
  });

  it('does not start cooldown when the send fails', async () => {
    await assert.rejects(
      runFriendRequestSend({
        userId: ALICE,
        now: () => 1_000,
        send: async () => { throw new Error('offline'); },
      }),
      /offline/
    );
    assert.equal(getFriendRequestCooldownSeconds(ALICE, 1_000), 0);
    assert.equal(canAttemptFriendRequest(ALICE, 1_000), true);
  });

  it('enables exactly at expiry and recalculates after a background-sized time jump', async () => {
    let now = 5_000;
    await runFriendRequestSend({ userId: ALICE, now: () => now, send: async () => {} });
    now += FRIEND_REQUEST_COOLDOWN_MS - 1;
    assert.equal(getFriendRequestCooldownSeconds(ALICE, now), 1);
    assert.equal(canAttemptFriendRequest(ALICE, now), false);
    now += 1;
    assert.equal(getFriendRequestCooldownSeconds(ALICE, now), 0);
    assert.equal(canAttemptFriendRequest(ALICE, now), true);
  });

  it('claims the in-flight guard synchronously so rapid taps send once', async () => {
    let release;
    let sends = 0;
    const send = () => {
      sends += 1;
      return new Promise((resolve) => { release = resolve; });
    };
    const first = runFriendRequestSend({ userId: ALICE, send });
    const second = await runFriendRequestSend({ userId: ALICE, send });
    assert.equal(second.status, 'ignored');
    assert.equal(sends, 1);
    release();
    assert.equal((await first).status, 'sent');
  });

  it('keys deadlines by authenticated uid', async () => {
    await runFriendRequestSend({ userId: ALICE, now: () => 10_000, send: async () => {} });
    assert.equal(canAttemptFriendRequest(ALICE, 10_000), false);
    assert.equal(canAttemptFriendRequest(BOB, 10_000), true);
  });

  it('preserves a uid deadline across subscriber unmount and remount', async () => {
    let notifications = 0;
    const unsubscribe = subscribeToFriendRequestCooldown(ALICE, () => { notifications += 1; });
    await runFriendRequestSend({ userId: ALICE, now: () => 20_000, send: async () => {} });
    assert.equal(notifications, 1);
    unsubscribe();
    const remounted = [];
    const unsubscribeAgain = subscribeToFriendRequestCooldown(
      ALICE,
      () => remounted.push(getFriendRequestCooldownSeconds(ALICE, 20_000))
    );
    remounted.push(getFriendRequestCooldownSeconds(ALICE, 20_000));
    assert.deepEqual(remounted, [10]);
    unsubscribeAgain();
  });
});

describe('friend-request safe errors', () => {
  it('maps cooldown, network, auth, relationship, and generic failures to fixed copy', () => {
    assert.equal(mapFriendRequestError(new FriendRequestCooldownError()), FRIEND_REQUEST_ERROR_COPY.cooldown);
    assert.equal(mapFriendRequestError(new FriendRequestAuthError()), FRIEND_REQUEST_ERROR_COPY.auth);
    assert.equal(mapFriendRequestError({ code: 'unavailable' }), FRIEND_REQUEST_ERROR_COPY.network);
    assert.equal(mapFriendRequestError({ code: 'auth/user-token-expired' }), FRIEND_REQUEST_ERROR_COPY.auth);
    assert.equal(mapFriendRequestError({ code: 'already-exists' }), FRIEND_REQUEST_ERROR_COPY.relationship);
    assert.equal(mapFriendRequestError({ code: 'permission-denied' }), FRIEND_REQUEST_ERROR_COPY.generic);
  });

  it('never includes an arbitrary Error.message', () => {
    const secret = 'projects/studi/private/path: PERMISSION_DENIED';
    const mapped = mapFriendRequestError(new Error(secret));
    assert.equal(mapped, FRIEND_REQUEST_ERROR_COPY.generic);
    assert.equal(mapped.includes(secret), false);
  });

  it('uses fixed native and web feedback without retrying anything', async () => {
    const native = [];
    const web = [];
    await showFriendRequestFailure({
      error: { code: 'unavailable' },
      platform: 'ios',
      showNativeAlert: (...args) => native.push(args),
      showWebAlert: () => { throw new Error('wrong adapter'); },
    });
    await showFriendRequestFailure({
      error: new FriendRequestCooldownError(),
      platform: 'web',
      showNativeAlert: () => { throw new Error('wrong adapter'); },
      showWebAlert: (message) => web.push(message),
    });
    assert.deepEqual(native, [[FRIEND_REQUEST_ERROR_TITLE, FRIEND_REQUEST_ERROR_COPY.network]]);
    assert.deepEqual(web, [
      `${FRIEND_REQUEST_ERROR_TITLE}\n\n${FRIEND_REQUEST_ERROR_COPY.cooldown}`,
    ]);
  });

  it('swallows synchronous and asynchronous feedback-adapter failures', async () => {
    await showFriendRequestFailure({
      error: new Error('hidden'),
      platform: 'ios',
      showNativeAlert: () => { throw new Error('native failed'); },
      showWebAlert: () => {},
    });
    await showFriendRequestFailure({
      error: new Error('hidden'),
      platform: 'web',
      showNativeAlert: () => {},
      showWebAlert: () => Promise.reject(new Error('web failed')),
    });
  });
});

describe('friend-request production wiring', () => {
  const surfaces = [
    'app/friends.tsx',
    'app/user/[userId].tsx',
    'app/conversation/[conversationId].tsx',
  ];

  it('routes every send surface through the synchronous shared guard and safe feedback', () => {
    for (const file of surfaces) {
      const source = readFileSync(file, 'utf8');
      assert.match(source, /canAttemptFriendRequest\(currentUser\.uid\)/, file);
      assert.match(source, /runFriendRequestSend\(\{/, file);
      assert.match(source, /presentFriendRequestFailure\(error\)/, file);
    }
  });

  it('keeps existing relationship states represented without applying cooldown to them', () => {
    const friends = readFileSync('app/friends.tsx', 'utf8');
    const profile = readFileSync('app/user/[userId].tsx', 'utf8');
    for (const status of ['friends', 'incoming', 'outgoing', 'none']) {
      assert.equal(friends.includes(`'${status}'`), true, status);
      assert.equal(profile.includes(`'${status}'`), true, status);
    }
    assert.match(profile, /loadState === 'blocked'/);
    assert.match(profile, /status === 'self'/);
  });
});
