import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'ghost';

export type ButtonProps = {
  label: string;
  icon?: IconSymbolName;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Pill button (handoff §2): fully rounded, min 44pt touch target on md/lg.
 * - primary: accent crimson — board CTAs (Join, Post session)
 * - secondary: surfaceAlt fill + hairline border
 * - success: success-tint chip ("✓ Going")
 * - ghost: text-only quiet action
 */
export function Button({
  label,
  icon,
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
  const successText = isDark ? '#8FBF9F' : Brand.success;

  const colors: Record<ButtonVariant, { bg: string; text: string; border?: string }> = {
    primary: { bg: palette.tint, text: '#FFFFFF' },
    secondary: { bg: 'transparent', text: palette.text, border: palette.outline },
    success: { bg: `${Brand.success}14`, text: successText, border: `${Brand.success}55` },
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
        sizes[size],
        {
          backgroundColor: pressed && variant === 'primary' ? Brand.accentPressed : bg,
          borderColor: border,
          borderWidth: border ? StyleSheet.hairlineWidth * 2 : 0,
          opacity: blocked ? 0.5 : pressed && variant !== 'primary' ? 0.7 : 1,
        },
        // transform must be a valid array when present; omit the key entirely
        // when unpressed (transform: undefined crashes RN's style processor).
        pressed && { transform: [{ scale: 0.98 }] },
        fullWidth && styles.fullWidth,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={text} />
      ) : (
        <View style={styles.content}>
          {icon ? <IconSymbol color={text} name={icon} size={size === 'sm' ? 16 : 18} /> : null}
          <Text
            style={[size === 'lg' ? styles.lgText : TypeScale.label, { color: text }]}
            numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const sizes = StyleSheet.create({
  lg: {
    minHeight: 50,
    paddingHorizontal: Space.xl,
  },
  md: {
    minHeight: 44,
    paddingHorizontal: Space.lg + 4,
  },
  sm: {
    minHeight: 36,
    paddingHorizontal: Space.lg,
  },
});

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: Radius.lg,
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  lgText: {
    fontFamily: TypeScale.label.fontFamily,
    fontSize: 15,
    lineHeight: 20,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
