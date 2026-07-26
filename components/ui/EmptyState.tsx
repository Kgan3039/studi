import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Button } from './Button';

export type EmptyStateIcon = 'dot' | 'seat' | 'chat' | 'calendar' | 'spot' | 'bell' | 'people';

export type EmptyStateProps = {
  headline: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Built-in line-icon variants (board EmptyTemplate motifs). */
  icon?: EmptyStateIcon;
  /** Replaces the icon entirely (e.g. a glyph or illustration). */
  illustration?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

const EMPTY_ICONS: Record<EmptyStateIcon, IconSymbolName> = {
  dot: 'circle.dashed',
  seat: 'person.2.fill',
  chat: 'message',
  calendar: 'calendar',
  spot: 'mappin.and.ellipse',
  bell: 'bell',
  people: 'person.2.fill',
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
  icon = 'dot',
  illustration,
  style,
}: EmptyStateProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.container, style]}>
      <View style={styles.icon}>
        {illustration ?? <IconSymbol name={EMPTY_ICONS[icon]} color={palette.tint} size={34} />}
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
  icon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.xs,
  },
  headline: {
    ...TypeScale.sectionTitle,
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
