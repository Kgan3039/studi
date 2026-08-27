import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionRow } from '@/components/ui/ActionRow';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Sheet } from '@/components/ui/Sheet';
import { Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MessageActionController } from '@/hooks/use-message-actions';
import type { MessageReply } from '@/lib/firestore';
import {
  isMessageDoubleTap,
  isMessageUnsent,
  type MessageActionRecord,
} from '@/lib/message-actions';

type MessageSelectionTargetProps = {
  accessibilityLabel: string;
  bubbleStyle: StyleProp<ViewStyle>;
  children: ReactNode;
  gestureResetKey?: string | number | boolean;
  reaction?: ReactNode;
  onDoublePress?: () => void;
  onOpenActions: () => void;
  onSwipeToReply?: () => void;
  replySwipeThreshold?: number;
  onToggleSelection: () => void;
  rowStyle: StyleProp<ViewStyle>;
  selected: boolean;
  selecting: boolean;
};

/** Makes the full message row tappable while multi-select is active. */
export function MessageSelectionTarget({
  accessibilityLabel,
  bubbleStyle,
  children,
  gestureResetKey,
  onDoublePress,
  onOpenActions,
  onSwipeToReply,
  onToggleSelection,
  reaction,
  replySwipeThreshold = 70,
  rowStyle,
  selected,
  selecting,
}: MessageSelectionTargetProps) {
  const lastTapAtRef = useRef(0);
  const longPressTriggeredRef = useRef(false);
  const swipeToReplyRef = useRef(onSwipeToReply);
  const swipeToReplyThresholdRef = useRef(replySwipeThreshold);
  swipeToReplyRef.current = onSwipeToReply;
  swipeToReplyThresholdRef.current = replySwipeThreshold;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !!swipeToReplyRef.current
          && gestureState.dx > 12
          && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2,
        onPanResponderRelease: (_, gestureState) => {
          if (
            swipeToReplyRef.current
            && gestureState.dx > swipeToReplyThresholdRef.current
          ) {
            longPressTriggeredRef.current = true;
            lastTapAtRef.current = 0;
            swipeToReplyRef.current();
          }
        },
      }),
    []
  );

  useEffect(() => {
    // A like/unlike leaves the row mounted. Clear gesture state only when that
    // message state changes so the next long press reaches the options sheet.
    longPressTriggeredRef.current = false;
    lastTapAtRef.current = 0;
  }, [gestureResetKey]);

  function handlePress() {
    // Long press and swipe-to-reply can still emit a terminal press event.
    // Consume that one event, then immediately restore the target so a later
    // long press always opens message options.
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }

    if (!onDoublePress) {
      return;
    }

    const now = Date.now();
    if (isMessageDoubleTap(lastTapAtRef.current, now)) {
      lastTapAtRef.current = 0;
      onDoublePress();
      return;
    }
    lastTapAtRef.current = now;
  }

  function handleLongPress() {
    longPressTriggeredRef.current = true;
    lastTapAtRef.current = 0;
    onOpenActions();
  }

  if (selecting) {
    return (
      <Pressable
        accessibilityActions={[
          { name: 'activate', label: selected ? 'Deselect message' : 'Select message' },
        ]}
        accessibilityHint="Double tap to select or deselect this message."
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onAccessibilityAction={onToggleSelection}
        onPress={onToggleSelection}
        style={({ pressed }) => [rowStyle, pressed && styles.selectionTargetPressed]}>
        <MessageSelectionMarker selected={selected} />
        <View style={bubbleStyle}>{children}</View>
      </Pressable>
    );
  }

  return (
    <View style={rowStyle}>
      <View
        {...panResponder.panHandlers}
        style={[styles.gestureTarget, bubbleStyle, !!reaction && styles.gestureTargetWithReaction]}>
        <Pressable
        accessibilityActions={[
          { name: 'activate', label: 'Open message actions' },
          ...(onDoublePress ? [{ name: 'magicTap' as const, label: 'Like message' }] : []),
        ]}
        accessibilityHint={`Use the Actions rotor item or long press for message actions. Double tap quickly to like.${
          onSwipeToReply ? ' Swipe right to reply.' : ''
        }`}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        delayLongPress={350}
        onAccessibilityAction={(event) =>
          event.nativeEvent.actionName === 'magicTap' && onDoublePress
            ? onDoublePress()
            : onOpenActions()
        }
        onLongPress={handleLongPress}
        onPress={handlePress}
        onPressIn={() => {
          longPressTriggeredRef.current = false;
        }}
        style={styles.messagePressTarget}>
          {children}
        </Pressable>
        {reaction}
      </View>
    </View>
  );
}

export function MessageActionOverlays({
  controller,
  userNameForId = () => 'Student',
}: {
  controller: MessageActionController;
  userNameForId?: (userId: string) => string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const deleteCount = controller.pendingDelete?.messageIds.length ?? 0;
  const likedByIds = controller.reactionMessage?.likedByIds ?? [];

  return (
    <>
      <Sheet
        onClose={controller.closeMessageActions}
        scroll={false}
        scrimTone="strong"
        title="Message options"
        visible={!!controller.activeMessage}>
        <View
          style={[
            styles.actionList,
            { borderColor: palette.border, backgroundColor: palette.surfaceMuted },
          ]}>
          {controller.activeMessage && controller.canReactToMessage(controller.activeMessage) ? (
            <ActionRow
              icon="hand.thumbsup.fill"
              label={controller.activeMessageLikedByCurrentUser ? 'Unlike' : 'Like'}
              onPress={() => {
                const message = controller.activeMessage;
                controller.closeMessageActions();
                if (message) {
                  void controller.toggleMessageLike(message);
                }
              }}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
          {controller.canReplyActive ? (
            <ActionRow
              icon="arrow.uturn.backward"
              label="Reply"
              onPress={controller.beginReplyingActiveMessage}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
          {controller.canCopyActive ? (
            <ActionRow
              icon="doc.on.doc"
              label="Copy"
              onPress={controller.copyActiveMessage}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
          {controller.canReportActive ? (
            <ActionRow
              destructive
              icon="exclamationmark.triangle"
              label="Report"
              onPress={controller.reportActiveMessage}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
          {controller.canDeleteActive ? (
            <ActionRow
              destructive
              icon="trash.fill"
              label="Delete"
              onPress={controller.requestDeleteActiveMessage}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
        </View>
      </Sheet>

      <Sheet
        footer={
          <View style={styles.editActions}>
            <Button
              disabled={controller.isWorking}
              label="Cancel"
              onPress={controller.closeEditor}
              variant="secondary"
            />
            <Button
              disabled={!controller.canConfirmEdit}
              label="Confirm Edit"
              loading={controller.isWorking}
              onPress={controller.confirmEdit}
              style={styles.confirmEdit}
            />
          </View>
        }
        onClose={controller.closeEditor}
        title="Edit message"
        visible={!!controller.editingMessage}>
        <TextInput
          autoCapitalize="sentences"
          autoFocus
          maxLength={2000}
          multiline
          onChangeText={controller.setEditDraft}
          placeholder="Edit your message"
          placeholderTextColor={palette.icon}
          style={[
            styles.editInput,
            {
              backgroundColor: palette.surfaceMuted,
              borderColor: palette.border,
              color: palette.text,
            },
          ]}
          value={controller.editDraft}
        />
        {!controller.canConfirmEdit ? (
          <Text style={[TypeScale.caption, { color: palette.icon }]}>Make a change to confirm.</Text>
        ) : null}
      </Sheet>

      <Sheet
        onClose={() => controller.setOriginalMessageId(null)}
        title="Before edit"
        visible={!!controller.originalMessage}>
        <View
          style={[
            styles.originalCard,
            { backgroundColor: palette.surfaceMuted, borderColor: palette.tint },
          ]}>
          <Text style={[styles.originalText, { color: palette.text }]}>
            {controller.originalMessage?.originalText}
          </Text>
        </View>
      </Sheet>

      <Sheet
        onClose={controller.closeMessageLikes}
        subtitle={
          likedByIds.length === 1
            ? '1 person liked this message.'
            : `${likedByIds.length} people liked this message.`
        }
        title="Liked By"
        visible={!!controller.reactionMessage}>
        <View
          style={[
            styles.likesList,
            { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
          ]}>
          {likedByIds.map((userId, index) => {
            const name = userNameForId(userId) || 'Student';
            return (
              <View
                key={userId}
                style={[
                  styles.likeRow,
                  index < likedByIds.length - 1 && {
                    borderBottomColor: palette.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}>
                <Avatar name={name} size="sm" verified />
                <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>
                  {userId === controller.currentUserId ? 'You' : name}
                </Text>
              </View>
            );
          })}
        </View>
      </Sheet>

      <ConfirmDialog
        body="This removes the message for everyone. People may already have seen it or its notification."
        confirmLabel="Unsend"
        loading={controller.isWorking}
        onCancel={() => {
          if (!controller.isWorking) controller.setConfirmUnsendMessageId(null);
        }}
        onConfirm={controller.confirmUnsend}
        title="Unsend this message?"
        visible={!!controller.unsendMessage}
      />

      <ConfirmDialog
        body={
          deleteCount === 1
            ? 'This removes the message only from your devices. Everyone else will still see it.'
            : `This removes ${deleteCount} messages only from your devices. Everyone else will still see them.`
        }
        confirmLabel={deleteCount === 1 ? 'Delete for Me' : `Delete ${deleteCount}`}
        loading={controller.isWorking}
        onCancel={() => {
          if (!controller.isWorking) controller.setPendingDelete(null);
        }}
        onConfirm={controller.confirmDeleteForSelf}
        title={deleteCount === 1 ? 'Delete this message?' : `Delete ${deleteCount} messages?`}
        visible={!!controller.pendingDelete}
      />
    </>
  );
}

export function MessageReplyPreview({
  isDirectReply = false,
  replyTo,
  sourceIsCurrentUser,
}: {
  isDirectReply?: boolean;
  replyTo?: MessageReply;
  sourceIsCurrentUser: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const replyGuideColor =
    colorScheme === 'dark' ? 'rgba(255, 255, 255, 0.20)' : 'rgba(79, 72, 63, 0.30)';
  if (!replyTo) {
    return null;
  }

  return (
    <View
      style={[
        styles.replyReference,
        isDirectReply &&
          (sourceIsCurrentUser ? styles.replyReferenceInlineOwn : styles.replyReferenceInlineOther),
      ]}>
      {!isDirectReply ? (
        <View
          style={[
            styles.replyPreview,
            sourceIsCurrentUser ? styles.replyPreviewRight : styles.replyPreviewLeft,
            { backgroundColor: palette.surfaceMuted, borderColor: palette.outline },
          ]}>
          <Text style={[styles.replyGhostText, { color: palette.icon }]} numberOfLines={1}>
            {replyTo.text}
          </Text>
        </View>
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.replyReferenceStem,
          !isDirectReply && !sourceIsCurrentUser && styles.replyReferenceStemBelow,
          // Quotes from someone else lead left-to-right. Own-message replies
          // use the full C-shaped guide on the left of the thread.
          sourceIsCurrentUser
            ? styles.replyReferenceStemOwn
            : styles.replyReferenceStemOther,
          isDirectReply && styles.replyReferenceStemInline,
          !isDirectReply && sourceIsCurrentUser && styles.replyReferenceStemDistantOwn,
          { borderColor: replyGuideColor },
        ]}
      />
    </View>
  );
}

export function MessageReplyComposer({
  onCancel,
  replyTo,
  senderName,
}: {
  onCancel: () => void;
  replyTo: MessageReply | null;
  senderName: string;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  if (!replyTo) {
    return null;
  }

  return (
    <View style={[styles.replyComposer, { borderColor: palette.border }]}>
      <View style={[styles.replyAccent, { backgroundColor: palette.tint }]} />
      <View style={styles.replyComposerCopy}>
        <Text style={[styles.replySender, { color: palette.tint }]} numberOfLines={1}>
          Replying to {senderName}
        </Text>
        <Text style={[styles.replyQuote, { color: palette.icon }]} numberOfLines={1}>
          {replyTo.text}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Cancel reply"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onCancel}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <IconSymbol color={palette.icon} name="xmark" size={18} />
      </Pressable>
    </View>
  );
}

export function MessageReplyCount({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  if (count < 1) {
    return null;
  }

  return (
    <Pressable
      accessibilityLabel={`View ${count} ${count === 1 ? 'reply' : 'replies'}`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.replyCount, { opacity: pressed ? 0.58 : 1 }]}>
      <Text style={[styles.replyCountText, { color: palette.tint }]}>
        {count} {count === 1 ? 'Reply' : 'Replies'}
      </Text>
      {count > 1 ? <IconSymbol color={palette.tint} name="chevron.right" size={12} /> : null}
    </Pressable>
  );
}

export function MessageReplyThreadSheet({
  currentUserId,
  message,
  onClose,
  replies,
  senderNameForId,
  visible,
}: {
  currentUserId?: string;
  message: MessageActionRecord | null;
  onClose: () => void;
  replies: MessageActionRecord[];
  senderNameForId: (userId: string) => string;
  visible: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  if (!message) {
    return null;
  }

  const renderMessage = (threadMessage: MessageActionRecord, isOriginal = false) => {
    const isCurrentUser = threadMessage.senderId === currentUserId;
    const isUnsent = isMessageUnsent(threadMessage);
    return (
      <View
        key={threadMessage.messageId}
        style={[
          styles.threadMessage,
          {
            alignSelf: isCurrentUser ? 'flex-end' : 'flex-start',
            backgroundColor: isCurrentUser ? palette.tint : palette.surfaceMuted,
          },
        ]}>
        <Text style={[styles.threadSender, { color: isCurrentUser ? '#FFFFFF' : palette.tint }]}>
          {isOriginal ? 'Original message' : senderNameForId(threadMessage.senderId)}
        </Text>
        <Text style={[styles.threadText, { color: isCurrentUser ? '#FFFFFF' : palette.text }]}>
          {isUnsent ? 'Message unsent' : threadMessage.text}
        </Text>
      </View>
    );
  };

  return (
    <Sheet
      onClose={onClose}
      subtitle={`Replies to ${senderNameForId(message.senderId)}`}
      title={`${replies.length} ${replies.length === 1 ? 'Reply' : 'Replies'}`}
      visible={visible}>
      <View style={styles.threadMessages}>
        {renderMessage(message, true)}
        {replies.map((reply) => renderMessage(reply))}
      </View>
    </Sheet>
  );
}

export function MessageEditedIndicator({
  message,
  onPress,
}: {
  message: MessageActionRecord;
  onPress: () => void;
}) {
  if (!message.editedAt || !message.originalText || message.unsentAt) {
    return null;
  }

  return (
    <Button
      icon="square.and.pencil"
      label="Edited"
      onPress={onPress}
      size="sm"
      style={styles.editedButton}
      variant="ghost"
    />
  );
}

export function MessageReactionBadge({
  currentUserId,
  likedByIds,
  onLongPress,
  onPress,
  side,
  selecting,
}: {
  currentUserId?: string;
  likedByIds: string[];
  onLongPress?: () => void;
  onPress: () => void;
  side: 'left' | 'right';
  selecting: boolean;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  if (likedByIds.length === 0) {
    return null;
  }

  const likedByCurrentUser = !!currentUserId && likedByIds.includes(currentUserId);
  const foreground = likedByCurrentUser ? '#FFFFFF' : palette.tint;

  function handlePress(event: GestureResponderEvent) {
    event.stopPropagation();
    onPress();
  }

  return (
    <Pressable
      accessibilityLabel={
        likedByIds.length === 1
          ? 'Liked by 1 person. Show who liked this message.'
          : `Liked by ${likedByIds.length} people. Show who liked this message.`
      }
      accessibilityRole="button"
      disabled={selecting}
      hitSlop={8}
      onLongPress={onLongPress}
      onPress={handlePress}
      pointerEvents={selecting ? 'none' : 'auto'}
      style={({ pressed }) => [
        styles.reactionBadge,
        side === 'right' ? styles.reactionBadgeRight : styles.reactionBadgeLeft,
        {
          backgroundColor: likedByCurrentUser ? palette.tint : palette.surface,
          borderColor: likedByCurrentUser ? palette.tint : palette.outline,
          opacity: pressed ? 0.68 : 1,
        },
      ]}>
      <IconSymbol color={foreground} name="hand.thumbsup.fill" size={13} />
      {likedByIds.length > 1 ? (
        <Text style={[styles.reactionCount, { color: foreground }]}>{likedByIds.length}</Text>
      ) : null}
    </Pressable>
  );
}

export function MessageSelectionBar({
  controller,
}: {
  controller: MessageActionController;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const count = controller.selectedMessageIds.size;

  return (
    <View
      style={[
        styles.selectionBar,
        {
          borderTopColor: palette.border,
          paddingBottom: Math.max(insets.bottom, Space.md),
        },
      ]}>
      <View style={styles.selectionSummary}>
        <View style={[styles.selectionCount, { backgroundColor: palette.tint }]}>
          <Text style={styles.selectionCountText}>{count}</Text>
        </View>
        <Text style={[TypeScale.label, { color: palette.text }]}>
          {count === 1 ? 'Message Selected' : 'Messages Selected'}
        </Text>
      </View>
      <View style={styles.selectionActions}>
        <Button
          disabled={!controller.selectedCopy}
          icon="doc.on.doc"
          label="Copy"
          onPress={controller.copySelectedMessages}
          size="sm"
          variant="secondary"
        />
        <Button
          disabled={count === 0}
          icon="trash.fill"
          label="Delete"
          onPress={controller.requestDeleteSelectedMessages}
          size="sm"
          variant="secondary"
        />
        <Button label="Done" onPress={controller.finishSelecting} size="sm" />
      </View>
    </View>
  );
}

export function MessageSelectionMarker({ selected }: { selected: boolean }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  return (
    <View
      style={[
        styles.selectionMarker,
        {
          backgroundColor: selected ? palette.tint : 'transparent',
          borderColor: selected ? palette.tint : palette.outline,
        },
      ]}>
      {selected ? <IconSymbol color="#FFFFFF" name="checkmark" size={14} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionList: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  actionRow: {
    backgroundColor: 'transparent',
    paddingHorizontal: Space.md,
  },
  gestureTarget: {
    position: 'relative',
  },
  gestureTargetWithReaction: {
    marginTop: Space.md,
  },
  messagePressTarget: {
    alignSelf: 'stretch',
  },
  editActions: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  confirmEdit: {
    flex: 1,
  },
  editInput: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 16,
    lineHeight: 23,
    maxHeight: 220,
    minHeight: 112,
    padding: Space.md,
    textAlignVertical: 'top',
  },
  originalCard: {
    borderLeftWidth: 3,
    borderRadius: Radius.lg,
    padding: Space.lg,
  },
  originalText: {
    fontFamily: FontFamily.body,
    fontSize: 16,
    lineHeight: 23,
  },
  replyPreview: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    maxWidth: '100%',
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
  },
  replyReference: {
    alignSelf: 'stretch',
    paddingBottom: Space.md + Space.xs,
    position: 'relative',
    width: '100%',
  },
  replyReferenceInlineOther: {
    height: Space.xxl + Space.lg + Space.xs,
    marginBottom: -(Space.lg + Space.xs),
    marginTop: -(Space.xxl + Space.xs),
    paddingBottom: 0,
  },
  replyReferenceInlineOwn: {
    height: Space.xxl + Space.lg + Space.xs,
    marginBottom: -(Space.lg + Space.xs),
    marginTop: -(Space.xxl + Space.xs),
    paddingBottom: 0,
  },
  replyPreviewLeft: {
    alignSelf: 'flex-start',
  },
  replyPreviewRight: {
    alignSelf: 'flex-end',
  },
  replyReferenceStem: {
    left: Space.md,
    position: 'absolute',
    width: Space.xxl + Space.sm,
  },
  replyReferenceStemBelow: {
    bottom: 0,
  },
  replyReferenceStemInline: {
    // The guide overlays the natural gap between two adjacent bubbles instead
    // of reserving vertical room. Its arms sit near each bubble's midpoint.
    height: Space.xxl + Space.lg + Space.xs,
    top: 0,
  },
  replyReferenceStemDistantOwn: {
    // A quoted self-reply has a source bubble, so the guide is drawn from the
    // quoted bubble's midpoint to the new bubble's midpoint without touching either.
    height: Space.xxl + Space.lg + Space.xs,
    top: Space.sm,
  },
  replyReferenceStemOther: {
    borderBottomWidth: 2,
    borderBottomLeftRadius: Space.lg,
    borderLeftWidth: 2,
    height: Space.md,
  },
  replyReferenceStemOwn: {
    borderBottomLeftRadius: Space.lg,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: Space.lg,
    borderTopWidth: 2,
    height: Space.lg,
  },
  replyComposer: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Space.sm,
    marginBottom: Space.xs,
    paddingBottom: Space.xs,
    paddingLeft: Space.sm,
    paddingTop: Space.xs,
  },
  replyAccent: {
    borderRadius: Radius.pill,
    width: 3,
  },
  replyComposerCopy: {
    flex: 1,
    minWidth: 0,
  },
  replySender: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  replyQuote: {
    fontFamily: FontFamily.body,
    fontSize: 12,
    lineHeight: 16,
  },
  replyGhostText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 13,
    lineHeight: 17,
  },
  replyCount: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minHeight: 22,
    paddingVertical: 2,
    position: 'relative',
  },
  replyCountText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  threadMessages: {
    gap: Space.md,
  },
  threadMessage: {
    borderRadius: Radius.lg,
    maxWidth: '88%',
    minWidth: 88,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  threadSender: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 11,
    lineHeight: 14,
    marginBottom: Space.xs,
  },
  threadText: {
    fontFamily: FontFamily.body,
    fontSize: 16,
    lineHeight: 21,
  },
  likesList: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  likeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 56,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  editedButton: {
    minHeight: 24,
    paddingHorizontal: Space.xs,
  },
  selectionBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
  },
  selectionSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  selectionCount: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 26,
    justifyContent: 'center',
    minWidth: 26,
    paddingHorizontal: Space.xs,
  },
  selectionCountText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  selectionActions: {
    flexDirection: 'row',
    gap: Space.xs,
  },
  selectionMarker: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  selectionTargetPressed: {
    opacity: 0.65,
  },
  reactionBadge: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'center',
    minHeight: 24,
    minWidth: 28,
    paddingHorizontal: 6,
    position: 'absolute',
    top: -Space.md,
    zIndex: 2,
  },
  reactionBadgeLeft: {
    right: -Space.sm,
  },
  reactionBadgeRight: {
    left: -Space.sm,
  },
  reactionCount: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 10,
    lineHeight: 13,
  },
});
