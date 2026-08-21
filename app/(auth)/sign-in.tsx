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
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { requestPasswordReset, signIn } from '@/lib/auth';
import { getUserFacingErrorMessage } from '@/lib/user-facing-errors';

export default function SignInScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  async function handleSignIn() {
    try {
      setIsBusy(true);
      const user = await signIn(email, password);
      track('sign_in_completed');
      router.replace(user.emailVerified ? '/' : '/verify-email');
    } catch (error) {
      Alert.alert('Sign In Error', getUserFacingErrorMessage(error, 'auth'));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleForgotPassword() {
    try {
      setIsBusy(true);
      await requestPasswordReset(email);
      Alert.alert(
        'Check Your Email',
        'If an account exists for that address, a password reset link is on its way.'
      );
    } catch (error) {
      Alert.alert('Reset Error', getUserFacingErrorMessage(error, 'passwordReset'));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + Space.sm }]}>
        <IconButton
          accessibilityLabel="Back"
          icon="chevron.left"
          onPress={() => router.back()}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}>
        <Text style={[styles.question, { color: palette.text }]}>Welcome back.</Text>
        <Text style={[TypeScale.body, styles.subtext, { color: palette.icon }]}>
          Sign in with your @wisc.edu email and password.
        </Text>

        <View style={styles.fields}>
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
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            value={password}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={handleForgotPassword}
          style={styles.textLink}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>Forgot password?</Text>
        </Pressable>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Space.lg) + Space.sm }]}>
        <Button label="Sign in" size="lg" fullWidth loading={isBusy} onPress={handleSignIn} />
        <Pressable
          accessibilityRole="button"
          disabled={isBusy}
          onPress={() => router.replace('/sign-up')}
          style={styles.textLink}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>
            New to Studi? Create an account
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
    flexDirection: 'row',
    paddingBottom: Space.md,
    paddingHorizontal: Space.xl,
  },
  content: {
    paddingBottom: Space.xl,
    paddingHorizontal: Space.xl,
  },
  question: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 32,
    lineHeight: 36,
  },
  subtext: {
    marginTop: Space.sm,
  },
  fields: {
    gap: Space.lg,
    marginTop: Space.xl,
  },
  footer: {
    gap: Space.sm,
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
  },
  textLink: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space.md,
    minHeight: 32,
  },
});
