import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

import blockModule from '../lib/idempotent-block.js';
import guardModule from '../lib/report-submit-guard.js';

const { createBlockIdempotently } = blockModule;
const { createReportSubmitGuard } = guardModule;

describe('report and block safety helpers', () => {
  it('completes an ordinary block without a verification read', async () => {
    let reads = 0;
    await createBlockIdempotently({
      blockerUserId: 'alice', blockedUserId: 'bob',
      writeBlock: async () => {},
      readBlock: async () => { reads += 1; return null; },
    });
    assert.equal(reads, 0);
  });

  it('recovers a successful block whose write response was lost', async () => {
    let writes = 0;
    await createBlockIdempotently({
      blockerUserId: 'alice',
      blockedUserId: 'bob',
      writeBlock: async () => {
        writes += 1;
        throw new Error('response lost');
      },
      readBlock: async () => ({ blockerUserId: 'alice', blockedUserId: 'bob' }),
    });
    assert.equal(writes, 1);
  });

  it('does not treat a missing or mismatched block as success', async () => {
    const original = new Error('write denied');
    await assert.rejects(
      createBlockIdempotently({
        blockerUserId: 'alice',
        blockedUserId: 'bob',
        writeBlock: async () => { throw original; },
        readBlock: async () => ({ blockerUserId: 'alice', blockedUserId: 'mallory' }),
      }),
      (error) => error === original
    );
  });

  it('treats an already-existing owned block as an idempotent success', async () => {
    await createBlockIdempotently({
      blockerUserId: 'alice', blockedUserId: 'bob',
      writeBlock: async () => { throw new Error('already exists'); },
      readBlock: async () => ({ blockerUserId: 'alice', blockedUserId: 'bob' }),
    });
  });

  it('acquires synchronously once and permits retry only before persistence', () => {
    const guard = createReportSubmitGuard();
    assert.equal(guard.acquire(), true);
    assert.equal(guard.acquire(), false);
    guard.releaseAfterFailure();
    assert.equal(guard.acquire(), true);
    guard.markSubmitted();
    guard.releaseAfterFailure();
    assert.equal(guard.acquire(), false);
  });
});
