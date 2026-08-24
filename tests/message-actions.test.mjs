import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'mocha';

import messageActions from '../lib/message-actions.js';

const {
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_UNSEND_WINDOW_MS,
  buildSelectedMessageCopy,
  canEditMessage,
  canUnsendMessage,
  hasMessageTextChanged,
} = messageActions;
const timestamp = (millis) => ({ toMillis: () => millis });
const message = (overrides = {}) => ({
  createdAt: timestamp(1_000),
  messageId: 'message-a',
  pending: false,
  senderId: 'alice',
  text: 'Original message',
  ...overrides,
});

describe('message action windows', () => {
  it('allows only the sender to edit for 15 minutes', () => {
    assert.equal(canEditMessage(message(), 'alice', 1_000 + MESSAGE_EDIT_WINDOW_MS), true);
    assert.equal(canEditMessage(message(), 'alice', 1_001 + MESSAGE_EDIT_WINDOW_MS), false);
    assert.equal(canEditMessage(message(), 'bob', 2_000), false);
  });

  it('allows only the sender to unsend for 2 minutes', () => {
    assert.equal(canUnsendMessage(message(), 'alice', 1_000 + MESSAGE_UNSEND_WINDOW_MS), true);
    assert.equal(canUnsendMessage(message(), 'alice', 1_001 + MESSAGE_UNSEND_WINDOW_MS), false);
    assert.equal(canUnsendMessage(message(), 'bob', 2_000), false);
  });

  it('never edits or unsends pending and already-unsent messages', () => {
    assert.equal(canEditMessage(message({ pending: true }), 'alice', 2_000), false);
    assert.equal(canUnsendMessage(message({ pending: true }), 'alice', 2_000), false);
    assert.equal(canEditMessage(message({ unsentAt: timestamp(1_500) }), 'alice', 2_000), false);
    assert.equal(canUnsendMessage(message({ unsentAt: timestamp(1_500) }), 'alice', 2_000), false);
  });
});

describe('message edit confirmation', () => {
  it('requires a non-empty, meaningful text change', () => {
    assert.equal(hasMessageTextChanged('Same text', ' Same text '), false);
    assert.equal(hasMessageTextChanged('Same text', '   '), false);
    assert.equal(hasMessageTextChanged('Same text', 'Changed text'), true);
  });
});

describe('multi-message copy', () => {
  it('copies selected messages chronologically and skips unsent content', () => {
    const messages = [
      message({ messageId: 'new', text: 'Second', createdAt: timestamp(3_000) }),
      message({ messageId: 'old', text: 'First', createdAt: timestamp(2_000) }),
      message({
        messageId: 'unsent',
        text: '',
        createdAt: timestamp(2_500),
        unsentAt: timestamp(2_600),
      }),
      message({ messageId: 'not-selected', text: 'Ignore me', createdAt: timestamp(1_000) }),
    ];

    assert.equal(
      buildSelectedMessageCopy(messages, new Set(['new', 'old', 'unsent'])),
      'First\nSecond'
    );
  });
});

describe('message action production wiring', () => {
  const directChat = readFileSync('app/conversation/[conversationId].tsx', 'utf8');
  const sessionChat = readFileSync('app/session-chat/[sessionId].tsx', 'utf8');
  const firestore = readFileSync('lib/firestore.ts', 'utf8');

  for (const [name, source] of [
    ['direct chat', directChat],
    ['session chat', sessionChat],
  ]) {
    it(`wires long-press, selection, edit history, and action overlays into ${name}`, () => {
      assert.match(source, /useMessageActions\(/);
      assert.match(source, /onLongPress=/);
      assert.match(source, /<MessageSelectionBar/);
      assert.match(source, /<MessageEditedIndicator/);
      assert.match(source, /<MessageActionOverlays/);
    });
  }

  it('uses owner-scoped markers instead of mutating shared docs for delete-for-self', () => {
    assert.match(firestore, /users[\s\S]*messageHides[\s\S]*messages/);
    assert.match(firestore, /hideChatMessagesForUser/);
    assert.doesNotMatch(
      firestore.slice(
        firestore.indexOf('export async function hideChatMessagesForUser'),
        firestore.indexOf('function messageTimestampMillis')
      ),
      /deleteDoc\(/
    );
  });
});
