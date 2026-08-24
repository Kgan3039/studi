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
  toggleSelectedMessageId,
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

describe('multi-message selection', () => {
  it('adds independent messages without replacing the existing selection', () => {
    const firstSelection = toggleSelectedMessageId(new Set(), 'message-a');
    const secondSelection = toggleSelectedMessageId(firstSelection, 'message-b');

    assert.deepEqual([...firstSelection], ['message-a']);
    assert.deepEqual([...secondSelection], ['message-a', 'message-b']);
  });

  it('deselects only the tapped message', () => {
    const selected = new Set(['message-a', 'message-b']);
    const nextSelection = toggleSelectedMessageId(selected, 'message-a');

    assert.deepEqual([...selected], ['message-a', 'message-b']);
    assert.deepEqual([...nextSelection], ['message-b']);
  });
});

describe('message action production wiring', () => {
  const directChat = readFileSync('app/conversation/[conversationId].tsx', 'utf8');
  const messageActionsUi = readFileSync('components/ui/MessageActions.tsx', 'utf8');
  const sessionChat = readFileSync('app/session-chat/[sessionId].tsx', 'utf8');
  const firestore = readFileSync('lib/firestore.ts', 'utf8');

  for (const [name, source] of [
    ['direct chat', directChat],
    ['session chat', sessionChat],
  ]) {
    it(`wires long-press, selection, edit history, and action overlays into ${name}`, () => {
      assert.match(source, /useMessageActions\(/);
      assert.match(source, /<MessageSelectionBar/);
      assert.match(source, /<MessageSelectionTarget/);
      assert.match(source, /<MessageEditedIndicator/);
      assert.match(source, /<MessageActionOverlays/);
    });
  }

  it('uses the full message row as the active multi-selection target', () => {
    assert.match(messageActionsUi, /if \(selecting\)[\s\S]*onPress=\{onToggleSelection\}/);
    assert.match(messageActionsUi, /<MessageSelectionMarker selected=\{selected\} \/>/);
    assert.match(messageActionsUi, /onLongPress=\{onOpenActions\}/);
  });

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
