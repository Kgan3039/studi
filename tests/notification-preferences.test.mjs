import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'mocha';

const require = createRequire(import.meta.url);
const { loadPushPreference, preferenceAllowsPush } = require('../functions/notification-preferences.js');

describe('notification preference decisions', () => {
  it('defaults missing documents and keys to enabled', () => {
    assert.equal(preferenceAllowsPush(undefined, 'dm_message'), true);
    assert.equal(preferenceAllowsPush({ notificationPrefs: {} }, 'dm_message'), true);
  });

  it('honors an explicit disabled preference', () => {
    assert.equal(
      preferenceAllowsPush({ notificationPrefs: { dmMessages: false } }, 'dm_message'),
      false
    );
  });

  it('suppresses push on a real settings read failure', async () => {
    let observed = false;
    const enabled = await loadPushPreference({
      notificationType: 'dm_message',
      readSettings: async () => {
        throw Object.assign(new Error('private backend detail'), { code: 'unavailable' });
      },
      onReadError: () => {
        observed = true;
      },
    });
    assert.equal(enabled, false);
    assert.equal(observed, true);
  });
});
