import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type BadgeTone = 'sunflower' | 'lake' | 'moss' | 'red' | 'neutral';

export type BadgeChipProps = {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
};

/**
 * Status badge chip (design-direction.md §2 usage rules): accent colors
 * only ever appear as chips with their 10%-opacity tint as the fill.
 * sunflower = "starting soon", lake = online/info, moss = open/success.
 */
export function BadgeChip({ label, tone = 'neutral', style }: BadgeChipProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const toneColors: Record<BadgeTone, string> = {
    sunflower: isDark ? '#F0C36A' : '#A87514',
    lake: isDark ? '#7FB3CC' : Brand.lake500,
    moss: isDark ? '#7FB07F' : Brand.moss500,
    red: palette.tint,
    neutral: palette.icon,
  };
  const toneFills: Record<BadgeTone, string> = {
    sunflower: `${Brand.sunflower400}1A`,
    lake: `${Brand.lake500}1A`,
    moss: `${Brand.moss500}1A`,
    red: `${palette.tint}1A`,
    neutral: palette.surfaceMuted,
  };

  return (
    <View style={[styles.chip, { backgroundColor: toneFills[tone] }, style]}>
      <Text style={[TypeScale.label, { color: toneColors[tone] }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
  },
});
