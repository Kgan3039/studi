import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Button } from './Button';

export type EmptyStateProps = {
  /** ≤5 words (design-direction.md §10 copy rules). */
  headline: string;
  /** One sentence, ideally with a live number. */
  body?: string;
  /** Verb. Renders the single primary action. */
  actionLabel?: string;
  onAction?: () => void;
  /** Replaces the default seat-dot motif once illustrations exist. */
  illustration?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * The one empty-state system (design-direction.md §10): never a dead end —
 * every empty state points at Sessions or Create.
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
      {illustration ?? (
        <View style={styles.dots}>
          <View style={[styles.dot, { backgroundColor: palette.tint }]} />
          <View style={[styles.dot, { backgroundColor: Brand.sunflower400 }]} />
          <View style={[styles.dot, { borderWidth: 1.5, borderColor: palette.outline }]} />
        </View>
      )}
      <Text style={[TypeScale.heading, styles.headline, { color: palette.text }]}>{headline}</Text>
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
    paddingVertical: Space.xxl,
    paddingHorizontal: Space.xl,
    gap: Space.sm,
  },
  dots: {
    flexDirection: 'row',
    gap: Space.sm,
    marginBottom: Space.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  headline: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  action: {
    marginTop: Space.md,
    alignSelf: 'center',
  },
});
