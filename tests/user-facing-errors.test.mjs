import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

import errorModule from '../lib/user-facing-errors.js';

const { getUserFacingErrorMessage } = errorModule;

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
});
