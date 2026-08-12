import { type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { useOverlayEntrance } from '@/components/ui/overlay-motion';
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
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content between the body and the actions — e.g. a re-auth field.
   *  Most confirmations don't need this; reach for it only when the decision
   *  itself requires input, not as a shortcut around a proper Sheet. */
  children?: ReactNode;
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
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { panelStyle, scrimStyle } = useOverlayEntrance(visible);

  return (
    <Modal
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={visible}>
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
        <Pressable
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            Elevation.e3,
            panelStyle,
            { backgroundColor: palette.background, borderColor: palette.border },
          ]}>
          <Text style={[TypeScale.h2, { color: palette.text }]}>{title}</Text>
          {body ? (
            <Text style={[TypeScale.body, { color: palette.icon }]}>{body}</Text>
          ) : null}
          {children}
          <View style={styles.actions}>
            <Button
              label={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              style={styles.cancelAction}
            />
            {/* The confirm label names the action, so it gets the room it needs
                and cancel takes only what it uses — splitting the row evenly
                truncated labels like "Report and block". */}
            <Button
              label={confirmLabel}
              loading={loading}
              disabled={confirmDisabled}
              onPress={onConfirm}
              style={styles.confirmAction}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: Space.xl,
  },
  scrim: {
    backgroundColor: 'rgba(18, 24, 21, 0.32)',
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
  cancelAction: {
    flexShrink: 0,
  },
  confirmAction: {
    flex: 1,
  },
});
