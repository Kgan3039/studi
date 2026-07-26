import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type FilterChipProps = {
  label: string;
  selected?: boolean;
  icon?: IconSymbolName;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

/** A compact, optional filter. Use SegmentedControl for mutually exclusive scope choices. */
export function FilterChip({ label, selected = false, icon, onPress, style }: FilterChipProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const foreground = selected ? '#FFFFFF' : palette.icon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: palette.tint, borderColor: palette.tint }
          : { backgroundColor: 'transparent', borderColor: palette.outline },
        { opacity: pressed ? 0.65 : 1 },
        style,
      ]}>
      <View style={styles.content}>
        {icon ? <IconSymbol color={foreground} name={icon} size={16} /> : null}
        <Text style={[TypeScale.label, { color: foreground }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: Space.md,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
});
