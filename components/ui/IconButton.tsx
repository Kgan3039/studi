import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type IconButtonProps = {
  accessibilityLabel: string;
  icon: IconSymbolName;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
  tone?: 'default' | 'accent';
  style?: StyleProp<ViewStyle>;
};

/** A consistent 44pt utility action for headers and list rows. */
export function IconButton({
  accessibilityLabel,
  icon,
  onPress,
  disabled = false,
  loading = false,
  selected = false,
  tone = 'default',
  style,
}: IconButtonProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const blocked = disabled || loading;
  const emphasized = selected || tone === 'accent';
  const foreground = emphasized ? palette.tint : palette.text;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, selected }}
      disabled={blocked}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        selected && {
          backgroundColor: palette.hero,
        },
        { opacity: blocked ? 0.45 : pressed ? 0.55 : 1 },
        pressed && !blocked ? { transform: [{ scale: 0.94 }] } : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={palette.tint} size="small" />
      ) : (
        <IconSymbol color={foreground} name={icon} size={21} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: Radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
});
