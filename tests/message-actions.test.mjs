import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'mocha';

import messageActions from '../lib/message-actions.js';

const {
  MESSAGE_DOUBLE_TAP_WINDOW_MS,
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_UNSEND_WINDOW_MS,
  buildSelectedMessageCopy,
  canEditMessage,
  canUnsendMessage,
  hasMessageTextChanged,
  hiddenMessageHydrationState,
  isMessageDoubleTap,
  normalizeMessageLikedByIds,
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

describe('message reactions', () => {
  it('recognizes only a quick second tap', () => {
    assert.equal(isMessageDoubleTap(1_000, 1_000 + MESSAGE_DOUBLE_TAP_WINDOW_MS), true);
    assert.equal(isMessageDoubleTap(1_000, 1_001 + MESSAGE_DOUBLE_TAP_WINDOW_MS), false);
    assert.equal(isMessageDoubleTap(0, 100), false);
    assert.equal(isMessageDoubleTap(2_000, 1_900), false);
  });

  it('normalizes, deduplicates, and bounds stored reaction user ids', () => {
    assert.deepEqual(
      normalizeMessageLikedByIds(['alice', '', 'alice', null, 'bob']),
      ['alice', 'bob']
    );
    assert.equal(
      normalizeMessageLikedByIds(Array.from({ length: 25 }, (_, index) => `user${index}`)).length,
      20
    );
    assert.deepEqual(normalizeMessageLikedByIds('alice'), []);
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

describe('hidden-message hydration scope', () => {
  it('is ready only when the authoritative snapshot matches the current scope', () => {
    assert.deepEqual(hiddenMessageHydrationState('alice:direct:one', null, null), {
      error: false,
      ready: false,
    });
    assert.deepEqual(
      hiddenMessageHydrationState('alice:direct:one', 'alice:direct:one', null),
      { error: false, ready: true }
    );
  });

  it('fails closed across user/thread changes and exposes only current-scope failures', () => {
    assert.deepEqual(
      hiddenMessageHydrationState(
        'bob:direct:two',
        'alice:direct:one',
        'alice:direct:one'
      ),
      { error: false, ready: false }
    );
    assert.deepEqual(
      hiddenMessageHydrationState('bob:direct:two', null, 'bob:direct:two'),
      { error: true, ready: false }
    );
  });

  it('does not block a screen before an authenticated thread scope exists', () => {
    assert.deepEqual(hiddenMessageHydrationState(null, null, null), {
      error: false,
      ready: true,
    });
  });
});

describe('message action production wiring', () => {
  const directChat = readFileSync('app/conversation/[conversationId].tsx', 'utf8');
  const messagesScreen = readFileSync('app/(tabs)/messages.tsx', 'utf8');
  const messageActionsHook = readFileSync('hooks/use-message-actions.ts', 'utf8');
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
      assert.match(source, /<MessageReactionBadge/);
      assert.match(source, /onDoublePress=/);
      assert.match(source, /isActive/);
      assert.match(source, /<MessageEditedIndicator/);
      assert.match(source, /<MessageActionOverlays/);
      assert.doesNotMatch(source, />Report message<\/Text>/);
    });
  }

  it('uses the full message row as the active multi-selection target', () => {
    assert.match(messageActionsUi, /if \(selecting\)[\s\S]*onPress=\{onToggleSelection\}/);
    assert.match(messageActionsUi, /<MessageSelectionMarker selected=\{selected\} \/>/);
    assert.match(messageActionsUi, /onLongPress=\{handleLongPress\}/);
  });

  it('keeps reports private to the action sheet and unavailable for your own messages', () => {
    assert.match(messageActionsUi, /label="Report"/);
    assert.match(messageActionsUi, /controller\.canReportActive/);
    assert.match(messageActionsHook, /activeMessage\.senderId !== currentUserId/);
    assert.match(messageActionsHook, /onReportMessage\(message\)/);
  });

  it('keeps the shared action model and private reporting in session chat', () => {
    for (const label of ['Copy', 'Reply', 'Report', 'Delete']) {
      assert.match(messageActionsUi, new RegExp(`label="${label}"`));
    }
    assert.match(messageActionsUi, /'Like'/);
    assert.match(messageActionsUi, /'Unlike'/);
    assert.doesNotMatch(messageActionsUi, /label="Select"/);
    assert.doesNotMatch(messageActionsUi, /isSessionChat/);
    assert.match(sessionChat, /onReportMessage:/);
    assert.match(sessionChat, /contentType: 'session_message'/);
    assert.match(sessionChat, /contentId: message\.messageId/);
  });

  it('lets a session chat menu open its group and member profiles', () => {
    assert.match(messagesScreen, /label="View group"/);
    assert.match(messagesScreen, /getSessionById\(groupMembersSessionId\)/);
    assert.match(messagesScreen, /accessibilityLabel=\{`View \$\{memberName\}'s profile`\}/);
    assert.match(messagesScreen, /router\.push\(`\/user\/\$\{userId\}`\)/);
  });

  it('wires reply snapshots and mobile reply gestures through both chat types', () => {
    for (const source of [messageActionsUi, directChat, sessionChat, firestore]) {
      assert.match(source, /replyTo|MessageReply|onSwipeToReply|PanResponder/);
    }
    assert.match(messageActionsUi, /label="Reply"/);
    assert.match(messageActionsUi, /activeMessageLikedByCurrentUser/);
    assert.match(messageActionsUi, /label=\{controller\.activeMessageLikedByCurrentUser \? 'Unlike' : 'Like'\}/);
    assert.match(messageActionsUi, /delayLongPress=\{350\}/);
    assert.match(messageActionsUi, /replySwipeThreshold = 70/);
    assert.match(messageActionsUi, /gestureState\.dx > swipeToReplyThresholdRef\.current/);
    assert.match(
      messageActionsUi,
      /style=\{\[styles\.gestureTarget, bubbleStyle, !!reaction && styles\.gestureTargetWithReaction\]\}/
    );
      assert.match(messageActionsUi, /style=\{styles\.messagePressTarget\}/);
      assert.match(messageActionsUi, /gestureResetKey/);
    assert.match(
      messageActionsUi,
      /if \(longPressTriggeredRef\.current\) \{\s*longPressTriggeredRef\.current = false;\s*return;/
    );
    assert.doesNotMatch(messageActionsUi, /showLikeAnimation|likeAnimation|Animated\.|likeScale|likeOpacity/);
    assert.match(directChat, /canDoubleTapLikeMessage/);
    assert.match(sessionChat, /canDoubleTapLikeMessage/);
    assert.match(directChat, /gestureResetKey=\{isLikedByCurrentUser\}/);
    assert.match(sessionChat, /gestureResetKey=\{isLikedByCurrentUser\}/);
    assert.match(directChat, /replySwipeThreshold=\{isCurrentUser \? 32 : 70\}/);
    assert.match(sessionChat, /replySwipeThreshold=\{isCurrentUser \? 32 : 70\}/);
    assert.match(directChat, /MessageReplyCount/);
    assert.match(sessionChat, /MessageReplyCount/);
    assert.match(directChat, /MessageReplyComposer/);
    assert.match(sessionChat, /MessageReplyComposer/);
    assert.match(directChat, /MessageReplyThreadSheet/);
    assert.match(sessionChat, /MessageReplyThreadSheet/);
  });

  it('keeps the clean core actions visible after a reaction and keeps badges outside message text', () => {
    assert.match(
      messageActionsUi,
      /label=\{controller\.activeMessageLikedByCurrentUser \? 'Unlike' : 'Like'\}/
    );
    for (const label of ['Reply', 'Copy', 'Report', 'Delete']) {
      assert.match(messageActionsUi, new RegExp(`label="${label}"`));
    }
    assert.doesNotMatch(messageActionsUi, /label="Edit"/);
    assert.doesNotMatch(messageActionsUi, /label="Unsend"/);
    assert.match(messageActionsUi, /side: 'left' \| 'right'/);
    assert.match(messageActionsUi, /gestureTargetWithReaction:[\s\S]*marginTop: Space\.md/);
    assert.match(messageActionsUi, /replyReference:[\s\S]*paddingBottom: Space\.md \+ Space\.xs/);
    assert.match(messageActionsUi, /threadMessage:[\s\S]*minWidth: 88/);
    assert.match(directChat, /side=\{isCurrentUser \? 'right' : 'left'\}/);
    assert.match(sessionChat, /side=\{isCurrentUser \? 'right' : 'left'\}/);
    assert.doesNotMatch(directChat, /message\.likedByIds\.length > 0 && styles\.bubbleWithReaction/);
    assert.doesNotMatch(sessionChat, /message\.likedByIds\.length > 0 && styles\.bubbleWithReaction/);
  });

  it('renders reply references as a muted source bubble only when its source is not adjacent', () => {
    assert.match(messageActionsUi, /sourceIsCurrentUser: boolean/);
    assert.match(messageActionsUi, /isDirectReply = false/);
    assert.match(messageActionsUi, /!isDirectReply \? \(/);
    assert.match(messageActionsUi, /styles\.replyReferenceStem/);
    assert.match(messageActionsUi, /styles\.replyReferenceStemOther/);
    assert.match(messageActionsUi, /styles\.replyReferenceStemOwn/);
    assert.match(messageActionsUi, /replyGhostText/);
    assert.doesNotMatch(messageActionsUi, /replyConnector/);
    assert.match(directChat, /isDirectReply=\{isReplyDirectlyBelowSource\}/);
    assert.match(sessionChat, /isDirectReply=\{isReplyDirectlyBelowSource\}/);
    assert.match(directChat, /message\.replyTo\?\.messageId === previousMessage\?\.messageId/);
    assert.match(sessionChat, /message\.replyTo\?\.messageId === chronPrev\?\.messageId/);
    assert.match(directChat, /const hasDirectReplyBelow/);
    assert.match(sessionChat, /const hasDirectReplyBelow/);
    assert.match(directChat, /replyCount > 0 && !hasDirectReplyBelow/);
    assert.match(sessionChat, /replyCount > 0 && !hasDirectReplyBelow/);
    assert.match(directChat, /messageGroup:\s*\{\s*alignSelf: 'stretch',[\s\S]*width: '100%'/);
    assert.match(sessionChat, /messageGroup:\s*\{\s*alignSelf: 'stretch',[\s\S]*width: '100%'/);
    assert.match(messageActionsUi, /replyReference:[\s\S]*width: '100%'/);
    assert.match(messageActionsUi, /const replyGuideColor/);
    assert.match(messageActionsUi, /width: Space\.xxl \+ Space\.sm/);
    assert.match(messageActionsUi, /!isDirectReply && !sourceIsCurrentUser && styles\.replyReferenceStemBelow/);
    assert.match(messageActionsUi, /isDirectReply && styles\.replyReferenceStemInline/);
    assert.match(messageActionsUi, /!isDirectReply && sourceIsCurrentUser && styles\.replyReferenceStemDistantOwn/);
    assert.match(messageActionsUi, /replyReferenceInlineOther:[\s\S]*marginTop: -\(Space\.xxl \+ Space\.xs\)/);
    assert.match(messageActionsUi, /replyReferenceStemInline:[\s\S]*top: 0/);
    assert.match(messageActionsUi, /replyReferenceStemDistantOwn:[\s\S]*top: Space\.sm/);
    assert.match(messageActionsUi, /count > 1 \? <IconSymbol color=\{palette\.tint\} name="chevron\.right" size=\{12\} \/> : null/);
    assert.match(messageActionsUi, /replyCountText:\s*\{\s*fontFamily: FontFamily\.bodySemiBold,\s*fontSize: 13/);
    assert.doesNotMatch(
      messageActionsUi,
      /<IconSymbol color=\{palette\.tint\} name="arrow\.uturn\.backward" size=\{15\} \/>/
    );
  });

  it('exposes the shared action sheet through an explicit accessibility action', () => {
    assert.match(messageActionsUi, /name: 'activate', label: 'Open message actions'/);
    assert.match(messageActionsUi, /onAccessibilityAction=/);
    assert.match(messageActionsUi, /onOpenActions\(\)/);
  });

  it('keeps message options reachable while a reaction write is pending', () => {
    assert.doesNotMatch(
      messageActionsHook,
      /function openMessageActions\(message: MessageActionRecord\) \{\s*if \(message\.pending\)/
    );
    assert.match(messageActionsHook, /const canDeleteActive = !!activeMessage && !isMessageUnsent\(activeMessage\)/);
    assert.doesNotMatch(
      messageActionsHook,
      /function canReplyToMessage\(message: MessageActionRecord\)[\s\S]*!message\.pending/
    );
    assert.doesNotMatch(
      messageActionsHook,
      /function canReactToMessage\(message: MessageActionRecord\)[\s\S]*!message\.pending/
    );
    assert.match(messageActionsUi, /controller\.canDeleteActive/);
  });

  it('uses atomic, message-bound shared reactions and a stronger active-message backdrop', () => {
    assert.match(firestore, /likedByIds: liked \? arrayUnion\(userId\) : arrayRemove\(userId\)/);
    assert.match(firestore, /stageBoundRateLimit\(batch, userId, "updateMessage", messageRef\.path\)/);
    assert.match(firestore, /await batch\.commit\(\)/);
    assert.match(messageActionsUi, /scrimTone="strong"/);
    assert.match(messageActionsUi, /title="Liked By"/);
    assert.match(sessionChat, /\.flatMap\(\(message\) => \[message\.senderId, \.\.\.message\.likedByIds\]\)/);
    assert.match(
      sessionChat,
      /likedByIds: message\.likedByIds\.filter\(\(userId\) => !blockedIds\.has\(userId\)\)/
    );
  });

  it('fails closed until hidden-message hydration resolves on both chat screens', () => {
    assert.match(messageActionsHook, /hiddenMessagesReady/);
    assert.match(messageActionsHook, /failedHiddenMessagesScopeKey/);
    assert.match(messageActionsHook, /hiddenMessageHydrationState/);
    assert.match(messageActionsHook, /retryHiddenMessages/);
    for (const source of [directChat, sessionChat]) {
      assert.match(source, /messageActions\.hiddenMessagesReady/);
      assert.match(source, /messageActions\.hiddenMessagesError/);
      assert.match(source, /messageActions\.retryHiddenMessages/);
    }
  });

  it('captures authoritative original text when reporting an edited message', () => {
    assert.match(firestore, /originalMessageText/);
    assert.match(firestore, /typeof message\.originalText === "string"/);
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
