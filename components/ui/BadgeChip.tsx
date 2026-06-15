import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Handoff Pill tones (§2) plus legacy Direction D aliases:
 * sunflower → filling, lake → info, moss → success, red → now.
 */
export type BadgeTone =
  | 'now'
  | 'filling'
  | 'quiet'
  | 'info'
  | 'success'
  | 'neutral'
  | 'sunflower'
  | 'lake'
  | 'moss'
  | 'red';

export type BadgeChipProps = {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
};

const ALIASES: Partial<Record<BadgeTone, BadgeTone>> = {
  sunflower: 'filling',
  lake: 'info',
  moss: 'success',
  red: 'now',
};

/**
 * Status pill (handoff §2): uppercase 11pt bold, tracked. `now` is the solid
 * crimson pill ("Happening now"); every other tone is a 10–15% tint fill.
 */
export function BadgeChip({ label, tone = 'neutral', style }: BadgeChipProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const resolved = ALIASES[tone] ?? tone;

  const toneText: Record<string, string> = {
    now: '#FFFFFF',
    filling: isDark ? '#D9A45C' : '#7A4F0F',
    quiet: isDark ? '#7FB3B5' : '#1F5C5E',
    info: isDark ? '#8FA8C9' : Brand.info,
    success: isDark ? '#8FBF9F' : Brand.success,
    neutral: palette.icon,
  };
  const toneFill: Record<string, string> = {
    now: palette.tint,
    filling: `${Brand.warning}26`,
    quiet: '#1F5C5E1A',
    info: `${Brand.info}1A`,
    success: `${Brand.success}1F`,
    neutral: isDark ? palette.surfaceMuted : 'rgba(31, 27, 22, 0.08)',
  };

  return (
    <View style={[styles.chip, { backgroundColor: toneFill[resolved] }, style]}>
      {resolved === 'now' ? <View style={styles.nowDot} /> : null}
      <Text style={[TypeScale.eyebrow, styles.label, { color: toneText[resolved] }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs + 2,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm + 2,
    paddingVertical: Space.xs,
  },
  label: {
    letterSpacing: 0.88,
  },
  nowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
});
