import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Button } from './Button';

export type EmptyStateIcon = 'dot' | 'seat' | 'chat' | 'calendar' | 'spot';

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

/** Local UI-only shapes echoing the board's empty-state icons. */
function IconShape({ icon, tint, outline }: { icon: EmptyStateIcon; tint: string; outline: string }) {
  switch (icon) {
    case 'seat':
      // Open seat: dashed circle with a seat dot at the center.
      return (
        <View style={[shapes.seatRing, { borderColor: tint }]}>
          <View style={[shapes.seatDot, { backgroundColor: tint }]} />
        </View>
      );
    case 'chat':
      // Speech bubble: outlined rounded square, tucked corner, message lines.
      return (
        <View style={[shapes.chatBubble, { borderColor: tint }]}>
          <View style={[shapes.chatLine, { backgroundColor: outline }]} />
          <View style={[shapes.chatLine, shapes.chatLineShort, { backgroundColor: outline }]} />
        </View>
      );
    case 'calendar':
      // Schedule: three bars at rising emphasis.
      return (
        <View style={shapes.barStack}>
          <View style={[shapes.bar, { backgroundColor: `${tint}4D` }]} />
          <View style={[shapes.bar, shapes.barShort, { backgroundColor: `${tint}99` }]} />
          <View style={[shapes.bar, { backgroundColor: tint }]} />
        </View>
      );
    case 'spot':
      // Map pin: rotated teardrop.
      return <View style={[shapes.pin, { borderColor: tint }]} />;
    default:
      return <View style={[shapes.dot, { backgroundColor: tint }]} />;
  }
}

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
      <View
        style={[
          styles.disc,
          { backgroundColor: palette.surfaceMuted, borderColor: palette.border },
        ]}>
        {illustration ?? <IconShape icon={icon} tint={palette.tint} outline={palette.outline} />}
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

const shapes = StyleSheet.create({
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  seatRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  chatBubble: {
    width: 28,
    height: 24,
    borderRadius: 8,
    borderBottomLeftRadius: 2,
    borderWidth: 2,
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 5,
  },
  chatLine: {
    height: 2,
    borderRadius: 1,
    width: '100%',
  },
  chatLineShort: {
    width: '60%',
  },
  barStack: {
    gap: 4,
    alignItems: 'flex-start',
  },
  bar: {
    width: 26,
    height: 4,
    borderRadius: 2,
  },
  barShort: {
    width: 17,
  },
  pin: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 11,
    borderBottomRightRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
});

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
