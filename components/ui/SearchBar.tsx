import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, FontFamily, Radius, Space } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type SearchBarProps = Omit<
  TextInputProps,
  'onChangeText' | 'placeholder' | 'style' | 'value'
> & {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel?: string;
  clearAccessibilityLabel?: string;
  showSearchIcon?: boolean;
  onClear?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
};

export function SearchBar({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel = 'Search',
  clearAccessibilityLabel = 'Clear search',
  showSearchIcon = true,
  onClear,
  containerStyle,
  editable = true,
  ...inputProps
}: SearchBarProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const canClear = editable && value.length > 0;

  function handleClear() {
    onChangeText('');
    onClear?.();
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: palette.mutedSurface,
          borderColor: palette.border,
          opacity: editable ? 1 : 0.6,
        },
        containerStyle,
      ]}>
      {showSearchIcon ? (
        <IconSymbol name="magnifyingglass" size={20} color={palette.secondaryText} />
      ) : null}
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.secondaryText}
        returnKeyType="search"
        value={value}
        {...inputProps}
        style={[styles.input, { color: palette.primaryText }]}
      />
      {canClear ? (
        <Pressable
          accessibilityLabel={clearAccessibilityLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleClear}
          style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}>
          <IconSymbol name="xmark.circle.fill" size={20} color={palette.secondaryText} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    width: '100%',
  },
  input: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: 15,
    lineHeight: 20,
    minWidth: 0,
    paddingVertical: Space.sm,
  },
  clear: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
});
