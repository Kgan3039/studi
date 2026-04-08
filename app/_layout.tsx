import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="complete-profile" options={{ title: 'Complete Profile' }} />
        <Stack.Screen name="create-session" options={{ title: 'Create Session' }} />
        <Stack.Screen name="matches" options={{ title: 'Matched Students' }} />
        <Stack.Screen name="session/[sessionId]" options={{ title: 'Session Details' }} />
        <Stack.Screen name="sessions" options={{ title: 'Available Sessions' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
