import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type InputProps = Omit<TextInputProps, 'style'> & {
  /** Uppercase eyebrow label above the field (handoff §2 Input). */
  label?: string;
  error?: string;
  helper?: string;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Labeled text field (handoff §2): 12pt uppercase eyebrow label, 48pt input,
 * stronger border on focus. Errors render below in accent. Secure fields get
 * a built-in show/hide toggle (hidden by default, iOS-style eye icon).
 */
export function Input({
  label,
  error,
  helper,
  containerStyle,
  secureTextEntry,
  ...inputProps
}: InputProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={[TypeScale.label, { color: palette.text }]}>{label}</Text>
      ) : null}
      <View>
        <TextInput
          placeholderTextColor={placeholderColor}
          {...inputProps}
          secureTextEntry={secureTextEntry && !passwordVisible}
          onFocus={(event) => {
            setFocused(true);
            inputProps.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
          style={[
            styles.input,
            secureTextEntry ? styles.secureInput : null,
            {
              backgroundColor: palette.surfaceMuted,
              borderColor: error ? palette.tint : focused ? palette.outline : palette.border,
              color: palette.text,
            },
          ]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            hitSlop={8}
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={styles.secureToggle}>
            <IconSymbol
              name={passwordVisible ? 'eye.slash' : 'eye'}
              size={20}
              color={palette.icon}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[TypeScale.caption, { color: palette.tint }]}>{error}</Text>
      ) : helper ? (
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Space.sm - 2,
  },
  input: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    fontFamily: FontFamily.body,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Space.lg,
  },
  secureInput: {
    paddingRight: Space.lg + 28,
  },
  secureToggle: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: Space.md,
    top: 0,
    width: 28,
  },
});
