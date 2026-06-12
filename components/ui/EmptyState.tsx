import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Button } from './Button';

export type EmptyStateProps = {
  headline: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Replaces the default icon disc (e.g. a glyph or illustration). */
  illustration?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Empty state (handoff §2): icon disc + serif italic headline + one-sentence
 * body + pill CTA. Required on every list; never a dead end.
 */
export function EmptyState({
  headline,
  body,
  actionLabel,
  onAction,
  illustration,
  style,
}: EmptyStateProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.disc,
          { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
        ]}>
        {illustration ?? <View style={[styles.dot, { backgroundColor: palette.tint }]} />}
      </View>
      <Text style={[styles.headline, { color: palette.text }]}>{headline}</Text>
      {body ? (
        <Text style={[TypeScale.body, styles.body, { color: palette.icon }]}>{body}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: Space.xxl + 8,
    paddingHorizontal: Space.xl,
    gap: Space.sm,
  },
  disc: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  headline: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
    maxWidth: 260,
  },
  body: {
    textAlign: 'center',
    maxWidth: 280,
  },
  action: {
    marginTop: Space.md,
    alignSelf: 'center',
  },
});
