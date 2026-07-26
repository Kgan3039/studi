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
  // Selection is crimson everywhere else in the app (filters, primary action),
  // so a course chip selects the same way rather than inventing an ink fill.
  const backgroundColor = selected ? palette.tint : palette.mutedSurface;
  const borderColor = selected ? palette.tint : palette.border;
  const resolvedTextColor = selected ? '#FFFFFF' : textColor;

  const content = (
    <Text
      style={[TypeScale.code, textSizes[size], styles.label, { color: resolvedTextColor }]}
      numberOfLines={1}>
      {code}
    </Text>
  );

  const chipStyle = [
    styles.chip,
    chipSizes[size],
    { backgroundColor, borderColor, borderLeftColor: selected ? palette.tint : tint },
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
  sm: { minHeight: 24, paddingHorizontal: Space.sm, paddingVertical: Space.xs },
  md: { minHeight: 30, paddingHorizontal: Space.sm + 2, paddingVertical: Space.xs + 1 },
  lg: { minHeight: 36, paddingHorizontal: Space.md, paddingVertical: Space.sm },
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
    // Column flex defaults to top-aligned content; without this the code sits
    // against the chip's top edge instead of centering in the box.
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    // The dept accent bar eats into the leading edge, so the label is nudged
    // back by the same amount to stay optically centered.
    borderLeftWidth: 3,
  },
  label: {
    marginLeft: -2,
  },
  pressed: {
    opacity: 0.7,
  },
});
