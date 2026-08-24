import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it } from 'mocha';

const require = createRequire(import.meta.url);
const {
  classifyMessageUpdate,
  formatMessageUpdateBody,
  isMessageUpdateStillCurrent,
  possessive,
} = require('../functions/message-lifecycle.js');

const baseMessage = {
  senderId: 'aliceUid',
  text: 'Meet at the library',
};

describe('message lifecycle classification', () => {
  it('recognizes one added like and ignores removals or malformed bulk additions', () => {
    assert.deepEqual(
      classifyMessageUpdate(baseMessage, { ...baseMessage, likedByIds: ['bobUid'] }),
      { actorId: 'bobUid', kind: 'liked', messageSenderId: 'aliceUid' }
    );
    assert.equal(
      classifyMessageUpdate(
        { ...baseMessage, likedByIds: ['bobUid'] },
        { ...baseMessage, likedByIds: [] }
      ),
      null
    );
    assert.equal(
      classifyMessageUpdate(baseMessage, {
        ...baseMessage,
        likedByIds: ['bobUid', 'caraUid'],
      }),
      null
    );
  });

  it('recognizes edits and unsends without including message content', () => {
    assert.deepEqual(
      classifyMessageUpdate(baseMessage, {
        ...baseMessage,
        text: 'Updated location',
        editedAt: { seconds: 2 },
      }),
      { actorId: 'aliceUid', kind: 'edited', messageSenderId: 'aliceUid' }
    );
    assert.deepEqual(
      classifyMessageUpdate(baseMessage, {
        senderId: 'aliceUid',
        text: '',
        unsentAt: { seconds: 2 },
      }),
      { actorId: 'aliceUid', kind: 'unsent', messageSenderId: 'aliceUid' }
    );
  });

  it('suppresses stale like/edit events after unlike or unsend wins the race', () => {
    const liked = { actorId: 'bobUid', kind: 'liked', messageSenderId: 'aliceUid' };
    const edited = { actorId: 'aliceUid', kind: 'edited', messageSenderId: 'aliceUid' };
    assert.equal(isMessageUpdateStillCurrent(liked, baseMessage), false);
    assert.equal(
      isMessageUpdateStillCurrent(liked, { ...baseMessage, likedByIds: ['bobUid'] }),
      true
    );
    assert.equal(
      isMessageUpdateStillCurrent(edited, {
        senderId: 'aliceUid', text: '', editedAt: { seconds: 2 }, unsentAt: { seconds: 3 },
      }),
      false
    );
  });
});

describe('message lifecycle notification wording', () => {
  const liked = { actorId: 'bobUid', kind: 'liked', messageSenderId: 'aliceUid' };

  it('uses recipient-specific group-like wording', () => {
    assert.equal(
      formatMessageUpdateBody({
        actorName: 'Bob', messageSenderName: 'Alice', recipientId: 'aliceUid', update: liked,
      }),
      'Bob liked your message.'
    );
    assert.equal(
      formatMessageUpdateBody({
        actorName: 'Bob', messageSenderName: 'Alice', recipientId: 'caraUid', update: liked,
      }),
      "Bob liked Alice's message."
    );
  });

  it('uses content-free edit and unsend wording', () => {
    assert.equal(
      formatMessageUpdateBody({
        actorName: 'Alice', recipientId: 'bobUid',
        update: { actorId: 'aliceUid', kind: 'edited', messageSenderId: 'aliceUid' },
      }),
      'Alice edited their message.'
    );
    assert.equal(
      formatMessageUpdateBody({
        actorName: 'Alice', recipientId: 'bobUid',
        update: { actorId: 'aliceUid', kind: 'unsent', messageSenderId: 'aliceUid' },
      }),
      'Alice unsent a message.'
    );
    assert.equal(possessive('James'), "James'");
  });
});

describe('message lifecycle production wiring', () => {
  const functionsIndex = readFileSync('functions/index.js', 'utf8');

  it('notifies both direct and session updates through the shared safe formatter', () => {
    assert.match(functionsIndex, /exports\.onDirectMessageUpdated = onDocumentUpdated/);
    assert.match(functionsIndex, /exports\.onSessionMessageUpdated = onDocumentUpdated/);
    assert.match(functionsIndex, /formatMessageUpdateBody/);
    assert.match(functionsIndex, /messageLifecycleNotificationId/);
  });

  it('filters lifecycle recipients against both the actor and message sender', () => {
    assert.match(functionsIndex, /\[update\.actorId, update\.messageSenderId\]/);
    assert.match(functionsIndex, /getUnblockedRecipients/);
  });
});
