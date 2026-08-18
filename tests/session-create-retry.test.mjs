import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import retryModule from '../lib/session-create-retry.js';

const {
  CreateSessionValidationError,
  SAFE_CREATE_SESSION_ERROR,
  SAFE_EDIT_SESSION_AUTH_ERROR,
  SAFE_EDIT_SESSION_ERROR,
  SAFE_EDIT_SESSION_NETWORK_ERROR,
  SAFE_SESSION_MODERATION_ERROR,
  createWithStaleVerificationRetry,
  getCreateSessionErrorMessage,
  getEditSessionErrorMessage,
} = retryModule;

const permissionDenied = { code: 'permission-denied' };

function createUser({ uid = 'aliceUid', claims = [false, true], refreshError, onRefresh }) {
  let claimRead = 0;
  let refreshCount = 0;

  return {
    uid,
    emailVerified: true,
    async getIdToken(forceRefresh) {
      assert.equal(forceRefresh, true);
      refreshCount += 1;
      onRefresh?.();
      if (refreshError) {
        throw refreshError;
      }
      return 'token';
    },
    async getIdTokenResult() {
      const claim = claims[Math.min(claimRead, claims.length - 1)];
      claimRead += 1;
      return { claims: { email_verified: claim } };
    },
    getRefreshCount() {
      return refreshCount;
    },
  };
}

function runRetry({ attempt, currentUser }) {
  return createWithStaleVerificationRetry({
    attempt,
    expectedUid: 'aliceUid',
    getCurrentUser: () => currentUser.value,
    isPermissionDenied: (error) => error?.code === 'permission-denied',
  });
}

describe('session creation stale-verification retry', () => {
  it('forces once, retries once, and creates exactly one session', async () => {
    const sessions = new Set();
    let attempts = 0;
    const user = createUser({});
    const currentUser = { value: user };

    const sessionId = await runRetry({
      currentUser,
      attempt: async () => {
        attempts += 1;
        if (attempts === 1) {
          assert.equal(sessions.size, 0);
          throw permissionDenied;
        }
        sessions.add('session-1');
        return 'session-1';
      },
    });

    assert.equal(sessionId, 'session-1');
    assert.equal(attempts, 2);
    assert.equal(user.getRefreshCount(), 1);
    assert.deepEqual([...sessions], ['session-1']);
  });

  it('does not retry an unrelated error', async () => {
    let attempts = 0;
    const unrelated = { code: 'unavailable' };
    const currentUser = { value: createUser({}) };

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw unrelated;
        },
      }),
      (error) => error === unrelated
    );
    assert.equal(attempts, 1);
  });

  it('does not retry permission denial when the current claim is already verified', async () => {
    let attempts = 0;
    const user = createUser({ claims: [true] });
    const currentUser = { value: user };

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw permissionDenied;
        },
      }),
      (error) => error === permissionDenied
    );
    assert.equal(attempts, 1);
    assert.equal(user.getRefreshCount(), 0);
  });

  it('does not retry when the refreshed claim remains false', async () => {
    let attempts = 0;
    const user = createUser({ claims: [false, false] });
    const currentUser = { value: user };

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw permissionDenied;
        },
      }),
      (error) => error === permissionDenied
    );
    assert.equal(attempts, 1);
    assert.equal(user.getRefreshCount(), 1);
  });

  it('fails closed without retrying when token refresh rejects', async () => {
    let attempts = 0;
    const user = createUser({ claims: [false], refreshError: new Error('auth detail') });
    const currentUser = { value: user };

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw permissionDenied;
        },
      }),
      (error) => error === permissionDenied
    );
    assert.equal(attempts, 1);
  });

  it('aborts if the authenticated UID changes during refresh', async () => {
    let attempts = 0;
    const currentUser = { value: null };
    const user = createUser({
      claims: [false, true],
      onRefresh: () => {
        currentUser.value = createUser({ uid: 'bobUid', claims: [true] });
      },
    });
    currentUser.value = user;

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw permissionDenied;
        },
      }),
      (error) => error === permissionDenied
    );
    assert.equal(attempts, 1);
  });

  it('aborts if the authenticated UID changes during refreshed-claim inspection', async () => {
    let attempts = 0;
    let claimReads = 0;
    const currentUser = { value: null };
    const user = createUser({ claims: [false, true] });
    const originalGetIdTokenResult = user.getIdTokenResult;
    user.getIdTokenResult = async () => {
      const result = await originalGetIdTokenResult();
      claimReads += 1;
      if (claimReads === 2) {
        currentUser.value = createUser({ uid: 'bobUid', claims: [true] });
      }
      return result;
    };
    currentUser.value = user;

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw permissionDenied;
        },
      }),
      (error) => error === permissionDenied
    );
    assert.equal(attempts, 1);
  });

  it('never performs more than one retry', async () => {
    let attempts = 0;
    const currentUser = { value: createUser({}) };

    await assert.rejects(
      runRetry({
        currentUser,
        attempt: async () => {
          attempts += 1;
          throw permissionDenied;
        },
      }),
      (error) => error === permissionDenied
    );
    assert.equal(attempts, 2);
  });

  it('maps only explicit validation errors to their message', () => {
    const validation = new CreateSessionValidationError('Choose between 2 and 20 seats.');

    assert.equal(getCreateSessionErrorMessage(validation), validation.message);
    assert.equal(getCreateSessionErrorMessage(new Error('backend detail')), SAFE_CREATE_SESSION_ERROR);
    assert.equal(getCreateSessionErrorMessage(permissionDenied), SAFE_CREATE_SESSION_ERROR);
    assert.equal(
      getCreateSessionErrorMessage({ name: 'ObjectionableContentError', message: 'raw' }),
      SAFE_SESSION_MODERATION_ERROR
    );
  });

  it('keeps controlled edit validation messages', () => {
    const validation = new CreateSessionValidationError('Add a title before saving the session.');

    assert.equal(getEditSessionErrorMessage(validation), validation.message);
  });

  it('maps edit authentication and verification failures to fixed copy', () => {
    for (const code of [
      'unauthenticated',
      'auth/user-disabled',
      'auth/user-token-expired',
      'auth/invalid-user-token',
    ]) {
      assert.equal(getEditSessionErrorMessage({ code }), SAFE_EDIT_SESSION_AUTH_ERROR);
    }
  });

  it('maps edit network failures to fixed retry copy', () => {
    for (const code of ['unavailable', 'deadline-exceeded', 'auth/network-request-failed']) {
      assert.equal(getEditSessionErrorMessage({ code }), SAFE_EDIT_SESSION_NETWORK_ERROR);
    }
  });

  it('never exposes arbitrary edit backend messages', () => {
    assert.equal(
      getEditSessionErrorMessage({ code: 'permission-denied', message: 'rules line 711' }),
      SAFE_EDIT_SESSION_ERROR
    );
    assert.equal(getEditSessionErrorMessage(new Error('private backend detail')), SAFE_EDIT_SESSION_ERROR);
    assert.equal(
      getEditSessionErrorMessage({ name: 'ObjectionableContentError', message: 'raw' }),
      SAFE_SESSION_MODERATION_ERROR
    );
    assert.equal(getEditSessionErrorMessage({ code: 'internal', message: 'stack trace' }), SAFE_EDIT_SESSION_ERROR);
  });

  it('is used by session persistence and the create-session error UI', async () => {
    const firestoreSource = await readFile(new URL('../lib/firestore.ts', import.meta.url), 'utf8');
    const screenSource = await readFile(new URL('../app/create-session.tsx', import.meta.url), 'utf8');

    assert.match(firestoreSource, /return createWithStaleVerificationRetry\(\{/);
    assert.match(screenSource, /const message = getCreateSessionErrorMessage\(error\)/);
    assert.equal((screenSource.match(/getEditSessionErrorMessage\(error\)/g) ?? []).length, 2);
    assert.doesNotMatch(screenSource, /isEditMode[\s\S]{0,300}error\.message/);
  });
});
