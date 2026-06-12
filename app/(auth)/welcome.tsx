import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function WelcomeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: palette.background,
          paddingTop: insets.top + Space.xl,
          paddingBottom: Math.max(insets.bottom, Space.lg) + Space.lg,
        },
      ]}>
      <View style={styles.hero}>
        <Text style={[styles.wordmark, { color: palette.tint }]}>Studi</Text>
        <Text style={[styles.headline, { color: palette.text }]}>
          Study together.{'\n'}Show up. Get it.
        </Text>
        <Text style={[TypeScale.body, styles.body, { color: palette.icon }]}>
          Find, join, and host study sessions for every class on your schedule.
        </Text>
        <AvatarStack
          names={['Sam', 'Jordan', 'Maya', 'Kai', 'Ava']}
          max={5}
          size="md"
          style={styles.avatars}
        />
      </View>

      <View style={styles.footer}>
        <Button
          label="Continue with UW email"
          size="lg"
          fullWidth
          onPress={() => router.push('/sign-up')}
        />
        <Button
          label="I already have an account"
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => router.push('/sign-in')}
        />
        <Text style={[TypeScale.caption, styles.microcopy, { color: palette.icon }]}>
          UW–Madison students only. Verified by @wisc.edu
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: Space.xl,
  },
  hero: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    gap: Space.lg,
  },
  wordmark: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 30,
    lineHeight: 36,
  },
  headline: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 38,
    lineHeight: 42,
    textAlign: 'center',
  },
  body: {
    maxWidth: 260,
    textAlign: 'center',
  },
  avatars: {
    marginTop: Space.md,
  },
  footer: {
    gap: Space.sm,
  },
  microcopy: {
    marginTop: Space.sm,
    textAlign: 'center',
  },
});
