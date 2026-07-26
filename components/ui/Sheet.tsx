import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Elevation, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Short line under the title. Keep it concrete — what this sheet edits. */
  subtitle?: string;
  /** Optional control beside the close button, e.g. "Mark all read". */
  headerAction?: ReactNode;
  /** Pinned under the scroll area, e.g. a save button. */
  footer?: ReactNode;
  /** Fires once the panel has finished dismissing (iOS Modal onDismiss). */
  onDismissed?: () => void;
  /** Renders children directly instead of inside a ScrollView. */
  scroll?: boolean;
  children: ReactNode;
};

/**
 * The one editing surface in Studi. It fades in over the screen and darkens
 * what's behind it — the same behaviour as the notification panel — so opening
 * an editor never looks like navigating somewhere new. Dismissal is always
 * available three ways: the close button, the scrim, and the back gesture.
 */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  headerAction,
  footer,
  onDismissed,
  scroll = true,
  children,
}: SheetProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="fade"
      onDismiss={onDismissed}
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}>
        {/* Declared first so it sits behind the panel: taps outside land on the
            scrim, taps inside it do not. */}
        <Pressable
          accessibilityLabel={`Close ${title.toLowerCase()}`}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.panel,
            Elevation.e3,
            {
              backgroundColor: palette.background,
              borderColor: palette.border,
              marginTop: insets.top + Space.md,
              maxHeight: '82%',
            },
          ]}>
          <View style={[styles.header, { borderBottomColor: palette.border }]}>
            <View style={styles.headerCopy}>
              <Text style={[TypeScale.h2, { color: palette.text }]} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerAction}
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: palette.surfaceMuted,
                  opacity: pressed ? 0.6 : 1,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                },
              ]}>
              <IconSymbol name="xmark" size={17} color={palette.text} />
            </Pressable>
          </View>

          {scroll ? (
            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          ) : (
            children
          )}

          {footer ? (
            <View
              style={[
                styles.footer,
                {
                  borderTopColor: palette.border,
                  paddingBottom: Math.max(insets.bottom, Space.md),
                },
              ]}>
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(18, 24, 21, 0.22)',
    flex: 1,
    justifyContent: 'flex-start',
  },
  panel: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    marginHorizontal: Space.md,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    paddingBottom: Space.md,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  body: {
    gap: Space.lg,
    paddingBottom: Space.lg,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
});
