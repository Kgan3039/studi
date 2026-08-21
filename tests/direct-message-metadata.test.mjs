import assert from 'node:assert/strict';
import { describe, it } from 'mocha';

import metadataModule from '../functions/direct-message-metadata.js';

const { deriveDirectMessageMetadata } = metadataModule;
const timestamp = (millis, nanoseconds = (millis % 1000) * 1_000_000) => ({
  seconds: Math.floor(millis / 1000),
  nanoseconds,
  toMillis: () => millis,
});

describe('direct-message metadata derivation', () => {
  it('derives bounded metadata from the persisted message', () => {
    const createdAt = timestamp(200);
    assert.deepEqual(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: `  ${'x'.repeat(220)}  `, createdAt },
        'message-b'
      ),
      {
        lastMessagePreview: 'x'.repeat(200),
        lastMessageAt: createdAt,
        lastMessageId: 'message-b',
        updatedAt: createdAt,
      }
    );
  });

  it('does not let a delayed older trigger overwrite newer metadata', () => {
    assert.equal(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: 'older', createdAt: timestamp(100) },
        'message-a',
        timestamp(200)
      ),
      null
    );
    assert.equal(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: 'older same millisecond', createdAt: timestamp(1000, 100) },
        'message-a',
        timestamp(1000, 200)
      ),
      null
    );
  });

  it('uses message id as a deterministic tie-breaker for equal timestamps', () => {
    const createdAt = timestamp(1000, 200);
    assert.equal(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: 'lower id', createdAt },
        'message-a',
        createdAt,
        'message-b'
      ),
      null
    );
    assert.deepEqual(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: 'higher id', createdAt },
        'message-c',
        createdAt,
        'message-b'
      ),
      {
        lastMessagePreview: 'higher id',
        lastMessageAt: createdAt,
        lastMessageId: 'message-c',
        updatedAt: createdAt,
      }
    );
    assert.equal(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: 'retry', createdAt },
        'message-b',
        createdAt,
        'message-b'
      ),
      null
    );
  });

  it('rejects malformed trigger payloads', () => {
    assert.equal(deriveDirectMessageMetadata(
      { senderId: 'alice', text: '', createdAt: timestamp(1) }, 'message-a'), null);
    assert.equal(deriveDirectMessageMetadata(
      { senderId: '', text: 'hello', createdAt: timestamp(1) }, 'message-a'), null);
    assert.equal(deriveDirectMessageMetadata({ senderId: 'alice', text: 'hello' }, 'message-a'), null);
    assert.equal(deriveDirectMessageMetadata(
      { senderId: 'alice', text: 'hello', createdAt: timestamp(1) }, ''), null);
  });
});
