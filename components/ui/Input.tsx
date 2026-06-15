import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

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
 * stronger border on focus. Errors render below in accent.
 */
export function Input({ label, error, helper, containerStyle, ...inputProps }: InputProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [focused, setFocused] = useState(false);

  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={placeholderColor}
        {...inputProps}
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
          {
            backgroundColor: palette.surfaceMuted,
            borderColor: error ? palette.tint : focused ? palette.outline : palette.border,
            color: palette.text,
          },
        ]}
      />
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
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: Space.lg,
  },
});
