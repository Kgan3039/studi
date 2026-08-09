import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * App-level back control for regular stack screens. Using the router directly
 * avoids relying on the native header event, which can be unreliable after a
 * tab-to-stack transition on some devices.
 */
export function HeaderBackButton() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  function handlePress() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  }

  return (
    <Pressable
      accessibilityLabel="Back"
      accessibilityRole="button"
      hitSlop={8}
      onPress={handlePress}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <IconSymbol color={palette.text} name="chevron.left" size={21} />
      <Text style={[TypeScale.label, styles.label, { color: palette.text }]}>Back</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs,
    minHeight: 44,
    minWidth: 72,
    paddingRight: Space.sm,
  },
  label: {
    fontFamily: FontFamily.bodySemiBold,
  },
});
