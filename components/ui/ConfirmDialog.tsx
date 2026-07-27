import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { Colors, Elevation, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  /** One sentence on what happens. Say the consequence, not the mechanics. */
  body?: string;
  /** Verb-first, e.g. "Remove", "Block". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation for actions that are hard to undo (removing a buddy, blocking).
 * Shares the Sheet's presentation — fade in over a darkened screen — so every
 * pop-up in Studi arrives the same way. See docs/design-system.md § Overlays.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            Elevation.e3,
            { backgroundColor: palette.background, borderColor: palette.border },
          ]}>
          <Text style={[TypeScale.h2, { color: palette.text }]}>{title}</Text>
          {body ? (
            <Text style={[TypeScale.body, { color: palette.icon }]}>{body}</Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              style={styles.action}
            />
            <Button
              label={confirmLabel}
              loading={loading}
              onPress={onConfirm}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(18, 24, 21, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: Space.xl,
  },
  dialog: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    gap: Space.sm,
    maxWidth: 420,
    padding: Space.lg + 4,
    width: '100%',
  },
  actions: {
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.md,
  },
  action: {
    flex: 1,
  },
});
