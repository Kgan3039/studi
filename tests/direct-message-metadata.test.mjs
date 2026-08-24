import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'mocha';

import metadataModule from '../functions/direct-message-metadata.js';

const { deriveDirectMessageMetadata, deriveDirectMessageUpdateMetadata } = metadataModule;
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

  it('derives a content-free create preview if a fast unsend wins the trigger race', () => {
    const createdAt = timestamp(200);
    assert.deepEqual(
      deriveDirectMessageMetadata(
        { senderId: 'alice', text: '', createdAt, unsentAt: timestamp(300) },
        'message-b'
      ),
      {
        lastMessagePreview: 'Message unsent',
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

describe('direct-message edit and unsend metadata', () => {
  const original = {
    senderId: 'alice',
    text: 'Meet at College Library',
    createdAt: timestamp(200),
  };

  it('updates the preview when the latest message is edited', () => {
    assert.deepEqual(
      deriveDirectMessageUpdateMetadata(
        { ...original, text: 'Meet at Memorial Library', editedAt: timestamp(300) },
        'message-a',
        'message-a'
      ),
      { lastMessagePreview: 'Meet at Memorial Library' }
    );
  });

  it('uses a content-free preview when the latest message is unsent', () => {
    assert.deepEqual(
      deriveDirectMessageUpdateMetadata(
        { ...original, text: '', unsentAt: timestamp(300) },
        'message-a',
        'message-a'
      ),
      { lastMessagePreview: 'Message unsent' }
    );
  });

  it('does not change previews for older messages or unedited current messages', () => {
    assert.equal(
      deriveDirectMessageUpdateMetadata(
        { ...original, text: 'edited', editedAt: timestamp(300) },
        'message-a',
        'message-b'
      ),
      null
    );
    assert.equal(
      deriveDirectMessageUpdateMetadata(
        original,
        'message-a',
        'message-a'
      ),
      null
    );
  });

  it('rejects malformed current message state', () => {
    assert.equal(
      deriveDirectMessageUpdateMetadata(
        { ...original, senderId: null, text: '', unsentAt: timestamp(300) },
        'message-a',
        'message-a'
      ),
      null
    );
    assert.equal(
      deriveDirectMessageUpdateMetadata(
        { ...original, createdAt: null, text: 'edited', editedAt: timestamp(300) },
        'message-a',
        'message-a'
      ),
      null
    );
  });
});

describe('direct-message lifecycle trigger wiring', () => {
  const functionSource = readFileSync('functions/index.js', 'utf8');
  const createTrigger = functionSource.slice(
    functionSource.indexOf('exports.onDirectMessageCreated'),
    functionSource.indexOf('exports.onDirectMessageUpdated')
  );
  const updateTrigger = functionSource.slice(
    functionSource.indexOf('exports.onDirectMessageUpdated'),
    functionSource.indexOf('exports.onSessionMessageCreated')
  );

  it('re-reads current message state before deriving create metadata or notifying', () => {
    assert.match(createTrigger, /transaction\.get\(event\.data\.ref\)/);
    assert.match(createTrigger, /currentMessage\?\.unsentAt/);
    assert.match(createTrigger, /body: currentState\.notificationText/);
  });

  it('derives edit/unsend previews from current state without rewriting previews for reactions', () => {
    assert.match(updateTrigger, /transaction\.get\(event\.data\.after\.ref\)/);
    assert.match(updateTrigger, /shouldRefreshPreview/);
    assert.match(updateTrigger, /deriveDirectMessageUpdateMetadata/);
    assert.match(updateTrigger, /formatMessageUpdateBody/);
    assert.match(updateTrigger, /notifyUser/);
  });
});
