import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Close control for modally-presented task screens (create, report, rate).
 * Those flows are "finish or leave" — an explicit ✕ reads as abandoning the
 * task, which a back chevron does not, and it stays reachable for anyone who
 * can't use the sheet's swipe-down gesture.
 */
export function HeaderCloseButton() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <Pressable
      accessibilityLabel="Close"
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => {
        if (router.canGoBack()) {
          router.back();
        }
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.surfaceMuted, opacity: pressed ? 0.6 : 1 },
      ]}>
      <IconSymbol name="xmark" size={17} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
});
