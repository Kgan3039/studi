import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, deptColorFor, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type CourseChipProps = {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Dept-colored course label with a restrained edge accent and mono code.
 * Unknown departments fall back to the foreground tint. Selected state adds
 * a foreground ring (board: ring-2 ring-foreground).
 */
export function CourseChip({ code, size = 'md', selected = false, onPress, style }: CourseChipProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const dept = deptColorFor(code);
  // Dark mode: dept hues are too dark for tinted text; use the lightened
  // foreground with the dept dot carrying the color.
  const tint = dept ?? palette.text;
  const textColor = isDark ? palette.text : tint;
  const backgroundColor = selected
    ? isDark
      ? palette.text
      : palette.primaryText
    : palette.mutedSurface;
  const borderColor = selected ? palette.primaryText : palette.border;
  const resolvedTextColor = selected ? palette.background : textColor;

  const content = (
    <Text
      style={[TypeScale.code, textSizes[size], { color: resolvedTextColor }]}
      numberOfLines={1}>
      {code}
    </Text>
  );

  const chipStyle = [
    styles.chip,
    chipSizes[size],
    { backgroundColor, borderColor, borderLeftColor: selected ? palette.primaryText : tint },
    selected && { borderColor: palette.primaryText },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [...chipStyle, pressed && styles.pressed]}>
        {content}
      </Pressable>
    );
  }

  return <View style={chipStyle}>{content}</View>;
}

const chipSizes = StyleSheet.create({
  sm: { minHeight: 24, paddingHorizontal: Space.sm + 2 },
  md: { minHeight: 32, paddingHorizontal: Space.md },
  lg: { minHeight: 40, paddingHorizontal: Space.lg },
});

const textSizes = StyleSheet.create({
  sm: { fontSize: 11, lineHeight: 14 },
  md: { fontSize: 13, lineHeight: 16 },
  lg: { fontSize: 15, lineHeight: 18 },
});

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  pressed: {
    opacity: 0.7,
  },
});
