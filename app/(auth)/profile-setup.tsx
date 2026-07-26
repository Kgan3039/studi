import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StepDots } from '@/components/ui/StepDots';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { invalidateProfileCache, updateUserDisplayName } from '@/lib/firestore';
import type { User } from 'firebase/auth';

function splitDisplayName(displayName: string | null | undefined) {
  const normalized = displayName?.trim() ?? '';

  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName, ...rest] = normalized.split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

export default function ProfileSetupScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [hasPrefilled, setHasPrefilled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      if (!user) {
        router.replace('/welcome');
      }
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!currentUser || hasPrefilled) {
      return;
    }

    const { firstName: savedFirst, lastName: savedLast } = splitDisplayName(
      currentUser.displayName
    );
    setFirstName(savedFirst);
    setLastName(savedLast);
    setHasPrefilled(true);
  }, [currentUser, hasPrefilled]);

  const previewName = `${firstName.trim()} ${lastName.trim()}`.trim() || 'Studi';

  async function handleEnterStudi() {
    if (!currentUser) {
      return;
    }

    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();

    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Name Error', 'Please enter both your first and last name.');
      return;
    }

    try {
      setIsSaving(true);
      await updateUserDisplayName(currentUser.uid, displayName);
      invalidateProfileCache(currentUser.uid);
      track('profile_completed');
      track('onboarding_complete');
      router.replace('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save your name right now.';
      Alert.alert('Name Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + Space.sm }]}>
        <View style={styles.headerSpacer} />
        <StepDots total={4} filled={4} />
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          hitSlop={8}
          onPress={() => router.replace('/')}>
          <Text style={[TypeScale.label, { color: palette.icon }]}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}>
        <Text style={[styles.question, { color: palette.text }]}>One last thing.</Text>
        <Text style={[TypeScale.body, styles.subtext, { color: palette.icon }]}>
          This is how classmates will see you at the table.
        </Text>

        <View style={styles.avatarBlock}>
          <Avatar name={previewName} size="xl" />
        </View>

        <View style={styles.fields}>
          <Input
            label="First name"
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setFirstName}
            placeholder="Alex"
            value={firstName}
          />
          <Input
            label="Last name"
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setLastName}
            placeholder="Rivera"
            value={lastName}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Space.lg) + Space.sm }]}>
        <Button
          label="Enter Studi"
          size="lg"
          fullWidth
          loading={isSaving}
          onPress={handleEnterStudi}
        />
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
  headerSpacer: {
    width: 28,
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
  avatarBlock: {
    alignItems: 'center',
    marginVertical: Space.xl + Space.sm,
  },
  fields: {
    gap: Space.lg,
  },
  footer: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
  },
});
