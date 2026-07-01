import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function DebugMapPinsWebFallback() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[TypeScale.title, { color: palette.text }]}>Native map pin debugger</Text>
        <Text style={[TypeScale.body, { color: palette.icon }]}>
          This debug route is only available in the native app. Open it in Expo Go or an iOS dev
          build at /debug-map-pins.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: Space.lg,
  },
  card: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.sm,
    padding: Space.lg,
  },
});
