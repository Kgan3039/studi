import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionRow } from '@/components/ui/ActionRow';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Sheet } from '@/components/ui/Sheet';
import { Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MessageActionController } from '@/hooks/use-message-actions';
import type { MessageActionRecord } from '@/lib/message-actions';

export function MessageActionOverlays({
  controller,
}: {
  controller: MessageActionController;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const deleteCount = controller.pendingDelete?.messageIds.length ?? 0;

  return (
    <>
      <Sheet
        onClose={controller.closeMessageActions}
        scroll={false}
        subtitle="Choose what to do with this message."
        title="Message Actions"
        visible={!!controller.activeMessage}>
        <View
          style={[
            styles.actionList,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          {controller.canCopyActive ? (
            <ActionRow
              icon="doc.on.doc"
              label="Copy"
              onPress={controller.copyActiveMessage}
              showChevron={false}
            />
          ) : null}
          {controller.canEditActive ? (
            <ActionRow
              description="Available for 15 minutes after sending."
              icon="square.and.pencil"
              label="Edit"
              onPress={controller.beginEditingActiveMessage}
              showChevron={false}
            />
          ) : null}
          {controller.canUnsendActive ? (
            <ActionRow
              description="Removes it for everyone within 2 minutes."
              icon="arrow.uturn.backward"
              label="Unsend"
              onPress={controller.requestUnsendActiveMessage}
              showChevron={false}
            />
          ) : null}
          <ActionRow
            description="Removes it only from your view."
            destructive
            icon="trash.fill"
            label="Delete"
            onPress={controller.requestDeleteActiveMessage}
            showChevron={false}
          />
          <ActionRow
            divided={false}
            description="Choose multiple messages to copy or delete."
            icon="checkmark.circle"
            label="Select"
            onPress={controller.beginSelectingActiveMessage}
            showChevron={false}
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
        subtitle="The original stays available from the Edited indicator."
        title="Edit Message"
        visible={!!controller.editingMessage}>
        <TextInput
          autoFocus
          maxLength={2000}
          multiline
          onChangeText={controller.setEditDraft}
          placeholder="Edit your message"
          placeholderTextColor={palette.icon}
          style={[
            styles.editInput,
            {
              backgroundColor: palette.surface,
              borderColor: palette.outline,
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
        subtitle="This is the message before its first edit."
        title="Original Message"
        visible={!!controller.originalMessage}>
        <View
          style={[
            styles.originalCard,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <Text style={[styles.originalText, { color: palette.text }]}>
            {controller.originalMessage?.originalText}
          </Text>
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
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    margin: Space.lg,
    overflow: 'hidden',
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
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: Space.lg,
  },
  originalText: {
    fontFamily: FontFamily.body,
    fontSize: 16,
    lineHeight: 23,
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
});
