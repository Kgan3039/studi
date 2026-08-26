import { useRef, type ReactNode } from 'react';
import {
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
import { isMessageDoubleTap, type MessageActionRecord } from '@/lib/message-actions';

type MessageSelectionTargetProps = {
  accessibilityLabel: string;
  bubbleStyle: StyleProp<ViewStyle>;
  children: ReactNode;
  onDoublePress?: () => void;
  onOpenActions: () => void;
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
  onDoublePress,
  onOpenActions,
  onToggleSelection,
  rowStyle,
  selected,
  selecting,
}: MessageSelectionTargetProps) {
  const lastTapAtRef = useRef(0);
  const longPressTriggeredRef = useRef(false);

  function handlePress() {
    if (longPressTriggeredRef.current || !onDoublePress) {
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
      <Pressable
        accessibilityActions={[
          { name: 'activate', label: 'Open message actions' },
          ...(onDoublePress ? [{ name: 'magicTap' as const, label: 'Like message' }] : []),
        ]}
        accessibilityHint="Use the Actions rotor item or long press for message actions. Double tap quickly to like."
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
        style={bubbleStyle}>
        {children}
      </Pressable>
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
          {controller.canCopyActive ? (
            <ActionRow
              icon="doc.on.doc"
              label="Copy"
              onPress={controller.copyActiveMessage}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
          {controller.canEditActive ? (
            <ActionRow
              icon="square.and.pencil"
              label="Edit"
              onPress={controller.beginEditingActiveMessage}
              showChevron={false}
              style={styles.actionRow}
            />
          ) : null}
          {controller.canUnsendActive ? (
            <ActionRow
              icon="arrow.uturn.backward"
              label="Unsend"
              onPress={controller.requestUnsendActiveMessage}
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
          <ActionRow
            destructive
            icon="trash.fill"
            label="Delete"
            onPress={controller.requestDeleteActiveMessage}
            showChevron={false}
            style={styles.actionRow}
          />
          <ActionRow
            divided={false}
            icon="checkmark.circle"
            label="Select"
            onPress={controller.beginSelectingActiveMessage}
            showChevron={false}
            style={styles.actionRow}
          />
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
  onPress,
  selecting,
}: {
  currentUserId?: string;
  likedByIds: string[];
  onPress: () => void;
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
      onPress={handlePress}
      pointerEvents={selecting ? 'none' : 'auto'}
      style={({ pressed }) => [
        styles.reactionBadge,
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
    left: -8,
    minHeight: 24,
    minWidth: 28,
    paddingHorizontal: 6,
    position: 'absolute',
    top: -12,
    zIndex: 2,
  },
  reactionCount: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 10,
    lineHeight: 13,
  },
});
