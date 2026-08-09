import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import verificationState from '../lib/verified-auth-state.js';

const { createVerifiedAuthStateSubscriber, getRootAuthAccess } = verificationState;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createAuthSource() {
  let listener = null;
  let currentUser = null;
  let unsubscribeCount = 0;

  return {
    emit(user) {
      currentUser = user;
      listener?.(user);
    },
    getCurrentUser() {
      return currentUser;
    },
    getUnsubscribeCount() {
      return unsubscribeCount;
    },
    subscribe(nextListener) {
      listener = nextListener;
      return () => {
        unsubscribeCount += 1;
        listener = null;
      };
    },
  };
}

function createUser({ uid = 'aliceUid', localVerified = true, tokenClaims = [true], refresh }) {
  let tokenRead = 0;
  let refreshCount = 0;

  return {
    uid,
    emailVerified: localVerified,
    async getIdToken(forceRefresh) {
      assert.equal(forceRefresh, true);
      refreshCount += 1;
      if (refresh) {
        await refresh();
      }
      return 'token';
    },
    async getIdTokenResult() {
      const claim = tokenClaims[Math.min(tokenRead, tokenClaims.length - 1)];
      tokenRead += 1;
      return { claims: { email_verified: claim } };
    },
    getRefreshCount() {
      return refreshCount;
    },
  };
}

function subscribe(source, received) {
  return createVerifiedAuthStateSubscriber({
    subscribeToAuthState: source.subscribe,
    getCurrentUser: source.getCurrentUser,
  })((user, state) => received.push([user?.uid ?? null, state]));
}

describe('verified auth state', () => {
  it('keeps initial restoration distinct from post-restoration claim checking', () => {
    assert.deepEqual(getRootAuthAccess({ authRestored: false, authState: 'checking' }), {
      mountNavigator: false,
      allowProtectedRoutes: false,
    });
    assert.deepEqual(getRootAuthAccess({ authRestored: true, authState: 'checking' }), {
      mountNavigator: true,
      allowProtectedRoutes: false,
    });
    assert.deepEqual(getRootAuthAccess({ authRestored: true, authState: 'signed-in' }), {
      mountNavigator: true,
      allowProtectedRoutes: true,
    });
  });

  it('forces one refresh for a stale claim and then reports verified', async () => {
    const source = createAuthSource();
    const user = createUser({ tokenClaims: [false, true] });
    const received = [];
    subscribe(source, received);

    source.emit(user);
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'pending'], ['aliceUid', 'verified']]);
    assert.equal(user.getRefreshCount(), 1);
  });

  it('reports a genuinely unverified local user without reading or refreshing a token', async () => {
    const source = createAuthSource();
    const user = createUser({ localVerified: false, tokenClaims: [true] });
    const received = [];
    subscribe(source, received);

    source.emit(user);
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'unverified']]);
    assert.equal(user.getRefreshCount(), 0);
  });

  it('reports unverified when the refreshed claim remains false', async () => {
    const source = createAuthSource();
    const user = createUser({ tokenClaims: [false, false] });
    const received = [];
    subscribe(source, received);

    source.emit(user);
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'pending'], ['aliceUid', 'unverified']]);
    assert.equal(user.getRefreshCount(), 1);
  });

  it('fails closed when forced refresh rejects', async () => {
    const source = createAuthSource();
    const user = createUser({
      tokenClaims: [false],
      refresh: async () => {
        throw new Error('network detail');
      },
    });
    const received = [];
    subscribe(source, received);

    source.emit(user);
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'pending'], ['aliceUid', 'unverified']]);
  });

  it('does not let a stale result overwrite sign-out', async () => {
    const tokenRead = deferred();
    const source = createAuthSource();
    const user = createUser({ tokenClaims: [true] });
    user.getIdTokenResult = () => tokenRead.promise;
    const received = [];
    subscribe(source, received);

    source.emit(user);
    source.emit(null);
    tokenRead.resolve({ claims: { email_verified: true } });
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'pending'], [null, 'unverified']]);
  });

  it('does not let a stale user overwrite a newer UID', async () => {
    const oldTokenRead = deferred();
    const source = createAuthSource();
    const oldUser = createUser({ uid: 'aliceUid', tokenClaims: [true] });
    oldUser.getIdTokenResult = () => oldTokenRead.promise;
    const newUser = createUser({ uid: 'bobUid', tokenClaims: [true] });
    const received = [];
    subscribe(source, received);

    source.emit(oldUser);
    source.emit(newUser);
    await flushAsync();
    oldTokenRead.resolve({ claims: { email_verified: true } });
    await flushAsync();

    assert.deepEqual(received, [
      ['aliceUid', 'pending'],
      ['bobUid', 'pending'],
      ['bobUid', 'verified'],
    ]);
  });

  it('suppresses pending work after unsubscribe', async () => {
    const tokenRead = deferred();
    const source = createAuthSource();
    const user = createUser({ tokenClaims: [true] });
    user.getIdTokenResult = () => tokenRead.promise;
    const received = [];
    const unsubscribe = subscribe(source, received);

    source.emit(user);
    unsubscribe();
    tokenRead.resolve({ claims: { email_verified: true } });
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'pending']]);
    assert.equal(source.getUnsubscribeCount(), 1);
  });

  it('does not force-refresh an already verified token', async () => {
    const source = createAuthSource();
    const user = createUser({ tokenClaims: [true] });
    const received = [];
    subscribe(source, received);

    source.emit(user);
    await flushAsync();

    assert.deepEqual(received, [['aliceUid', 'pending'], ['aliceUid', 'verified']]);
    assert.equal(user.getRefreshCount(), 0);
  });

  it('does not stack forced refreshes when the refresh emits another auth event', async () => {
    const source = createAuthSource();
    let user;
    user = createUser({
      tokenClaims: [false, true, true],
      refresh: async () => source.emit(user),
    });
    const received = [];
    subscribe(source, received);

    source.emit(user);
    await flushAsync();

    assert.equal(user.getRefreshCount(), 1);
    assert.deepEqual(received.at(-1), ['aliceUid', 'verified']);
  });

  it('is wired so claim checking keeps the root navigator mounted and protected routes closed', async () => {
    const rootSource = await readFile(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
    const authSource = await readFile(new URL('../lib/auth.ts', import.meta.url), 'utf8');

    assert.match(authSource, /createVerifiedAuthStateSubscriber<User>/);
    assert.match(rootSource, /setAuthRestored\(true\)/);
    assert.match(rootSource, /getRootAuthAccess\(\{ authRestored, authState \}\)/);
    assert.match(rootSource, /const ready =[^\n]+authAccess\.mountNavigator/);
    assert.match(rootSource, /const isSignedIn = authAccess\.allowProtectedRoutes/);
    assert.match(rootSource, /<Stack\.Screen name="verify-email"/);
    assert.doesNotMatch(rootSource, /authState !== 'pending'/);
  });
});
