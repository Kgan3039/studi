import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'ghost';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Direction D button (design-direction.md §1, §6).
 * - primary: red fill, the single primary action on a surface
 * - secondary: quiet outline
 * - success: moss 10%-tint chip ("✓ Going")
 * - ghost: text-only quiet action ("Leave")
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
}: ButtonProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const mossText = isDark ? '#7FB07F' : Brand.moss500;

  const colors: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
    primary: { bg: palette.tint, text: '#FFFFFF' },
    secondary: { bg: 'transparent', text: palette.text, border: palette.outline },
    success: { bg: `${Brand.moss500}1A`, text: mossText },
    ghost: { bg: 'transparent', text: palette.icon },
  };
  const { bg, text, border } = colors[variant];
  const blocked = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        {
          backgroundColor: pressed && variant === 'primary' ? Brand.red700 : bg,
          borderColor: border,
          borderWidth: border ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: blocked ? 0.5 : pressed && variant !== 'primary' ? 0.7 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={text} />
      ) : (
        <Text style={[TypeScale.label, { color: text }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
  },
  md: {
    minHeight: 48,
    paddingHorizontal: Space.xl,
  },
  sm: {
    minHeight: 36,
    paddingHorizontal: Space.lg,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
