import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

import errorModule from '../lib/user-facing-errors.js';
import authErrorModule from '../lib/auth-errors.js';

const { getUserFacingErrorMessage } = errorModule;
const { TrustedAuthError } = authErrorModule;

describe('safe user-facing errors', () => {
  it('never returns arbitrary backend messages', () => {
    const secret = 'Firestore internal path /private/users/admin';
    assert.equal(
      getUserFacingErrorMessage(new Error(secret), 'report'),
      'Unable to submit the report right now. Please try again.'
    );
    assert.equal(getUserFacingErrorMessage(secret, 'message'), 'Unable to send message right now.');
  });

  it('maps network and invalid-session codes to fixed copy', () => {
    assert.equal(
      getUserFacingErrorMessage({ code: 'unavailable', message: 'raw' }, 'settings'),
      'Check your connection and try again.'
    );
    assert.equal(
      getUserFacingErrorMessage({ code: 'auth/user-disabled', message: 'raw' }, 'auth'),
      'Please sign in with your verified UW account and try again.'
    );
  });

  it('preserves only explicitly trusted auth validation copy', () => {
    for (const message of [
      'Enter your @wisc.edu email.',
      'Please use your @wisc.edu email.',
      'Enter your password.',
      'Password must be at least 8 characters.',
      'Enter your first and last name.',
      'Incorrect email or password. If you forgot your password, use “Forgot password?” below.',
    ]) {
      assert.equal(getUserFacingErrorMessage(new TrustedAuthError(message), 'auth'), message);
    }
    assert.equal(
      getUserFacingErrorMessage({ name: 'TrustedAuthError', message: 'forged backend detail' }, 'auth'),
      'Unable to continue right now. Please try again.'
    );
  });
});
