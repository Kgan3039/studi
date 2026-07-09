import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StepDots } from '@/components/ui/StepDots';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { signUp } from '@/lib/auth';

export default function SignUpScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  async function handleSignUp() {
    try {
      setIsBusy(true);
      track('sign_up_started');
      await signUp(email, password, firstName, lastName);
      router.replace('/verify-email');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to continue right now.';
      Alert.alert('Sign Up Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + Space.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={() => router.back()}>
          <Text style={[styles.back, { color: palette.icon }]}>‹</Text>
        </Pressable>
        <StepDots total={4} filled={1} />
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}>
        <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Step 1 of 4</Text>
        <Text style={[styles.question, { color: palette.text }]}>
          Start with your UW email.
        </Text>
        <Text style={[TypeScale.body, styles.subtext, { color: palette.icon }]}>
          We’ll send a verification link to confirm you’re a UW–Madison student.
        </Text>

        <View style={styles.fields}>
          <View style={styles.inlineRow}>
            <Input
              label="First name"
              autoCapitalize="words"
              editable={!isBusy}
              onChangeText={setFirstName}
              placeholder="Alex"
              value={firstName}
              containerStyle={styles.flexField}
            />
            <Input
              label="Last name"
              autoCapitalize="words"
              editable={!isBusy}
              onChangeText={setLastName}
              placeholder="Rivera"
              value={lastName}
              containerStyle={styles.flexField}
            />
          </View>
          <Input
            label="UW email"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            spellCheck={false}
            editable={!isBusy}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="netid@wisc.edu"
            value={email}
          />
          <Input
            label="Password"
            autoCapitalize="none"
            editable={!isBusy}
            helper="At least 8 characters."
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            value={password}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Space.lg) + Space.sm }]}>
        <Button
          label="Create account"
          size="lg"
          fullWidth
          loading={isBusy}
          onPress={handleSignUp}
        />
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => router.replace('/sign-in')}
          style={styles.textLink}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>
            Have an account? Sign in
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: Space.md,
    paddingHorizontal: Space.xl,
  },
  back: {
    fontFamily: FontFamily.body,
    fontSize: 24,
    lineHeight: 26,
  },
  headerSpacer: {
    width: 24,
  },
  content: {
    paddingBottom: Space.xl,
    paddingHorizontal: Space.xl,
  },
  question: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 32,
    lineHeight: 36,
    marginTop: Space.xs,
  },
  subtext: {
    marginTop: Space.sm,
  },
  fields: {
    gap: Space.lg,
    marginTop: Space.xl,
  },
  inlineRow: {
    flexDirection: 'row',
    gap: Space.md,
  },
  flexField: {
    flex: 1,
  },
  footer: {
    gap: Space.sm,
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
  },
  textLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
});
