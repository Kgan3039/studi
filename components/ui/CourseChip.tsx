import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type CourseChipProps = {
  code: string;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Course-code chip — the brand's text signature (design-direction.md §3).
 * Always Space Grotesk, tracked out, uppercase: `CS 354`.
 * Selected state uses the red-100 fill (filter chips, class pickers).
 */
export function CourseChip({ code, selected = false, onPress, style }: CourseChipProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const backgroundColor = selected
    ? isDark
      ? `${palette.tint}33`
      : Brand.red100
    : palette.surfaceMuted;
  const textColor = selected ? (isDark ? palette.tint : Brand.red700) : palette.text;

  const content = (
    <Text style={[TypeScale.code, { color: textColor }]} numberOfLines={1}>
      {code.toUpperCase()}
    </Text>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [styles.chip, { backgroundColor, opacity: pressed ? 0.7 : 1 }, style]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.chip, { backgroundColor }, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.chip,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs + 1,
  },
});
