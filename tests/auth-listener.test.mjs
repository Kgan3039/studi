import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import authListener from '../lib/auth-listener.js';

const { subscribeToIdTokenState } = authListener;

function createFakeIdTokenSource(initialUser) {
  let listener = null;
  let subscribedAuth = null;
  let unsubscribeCount = 0;

  return {
    emit(user) {
      listener?.(user);
    },
    getSubscribedAuth() {
      return subscribedAuth;
    },
    getUnsubscribeCount() {
      return unsubscribeCount;
    },
    onIdTokenChanged(auth, nextListener) {
      subscribedAuth = auth;
      listener = nextListener;
      nextListener(initialUser);

      return () => {
        unsubscribeCount += 1;
        listener = null;
      };
    },
  };
}

describe('auth ID-token listener', () => {
  it('delivers the initial signed-in user and verification changes after refresh', () => {
    const initialUser = { uid: 'user123', emailVerified: false };
    const refreshedUser = { uid: 'user123', emailVerified: true };
    const source = createFakeIdTokenSource(initialUser);
    const auth = { name: 'auth-instance' };
    const received = [];

    subscribeToIdTokenState(auth, source.onIdTokenChanged, (user) => received.push(user));
    source.emit(refreshedUser);

    assert.equal(source.getSubscribedAuth(), auth);
    assert.deepEqual(received, [initialUser, refreshedUser]);
  });

  it('delivers null when Firebase reports sign-out or invalidated auth state', () => {
    const source = createFakeIdTokenSource({ uid: 'user123', emailVerified: true });
    const received = [];

    subscribeToIdTokenState({}, source.onIdTokenChanged, (user) => received.push(user));
    source.emit(null);

    assert.deepEqual(received, [
      { uid: 'user123', emailVerified: true },
      null,
    ]);
  });

  it('returns the Firebase unsubscribe and stops callbacks after cleanup', () => {
    const source = createFakeIdTokenSource(null);
    const received = [];
    const unsubscribe = subscribeToIdTokenState(
      {},
      source.onIdTokenChanged,
      (user) => received.push(user)
    );

    unsubscribe();
    source.emit({ uid: 'late-user', emailVerified: true });

    assert.deepEqual(received, [null]);
    assert.equal(source.getUnsubscribeCount(), 1);
  });

  it('is the adapter used by the production auth subscription', async () => {
    const authSource = await readFile(new URL('../lib/auth.ts', import.meta.url), 'utf8');

    assert.match(authSource, /subscribeToIdTokenState\(auth, onIdTokenChanged, listener\)/);
    assert.doesNotMatch(authSource, /\bonAuthStateChanged\s*\(/);
  });
});
