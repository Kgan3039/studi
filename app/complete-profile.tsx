import { useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  clearPendingAccountCreation,
  completeAccountCreation,
  getPendingAccountCreationEmail,
} from '@/lib/auth';

export default function CompleteProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const email = getPendingAccountCreationEmail();

  async function handleCompleteProfile() {
    try {
      setIsBusy(true);
      await completeAccountCreation(firstName, lastName);
      router.replace('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create your account right now.';
      Alert.alert('Profile Setup Error', message);
    } finally {
      setIsBusy(false);
    }
  }

  function handleBack() {
    clearPendingAccountCreation();
    router.replace('/');
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.surface }]}>
        <Image
          contentFit="contain"
          source={require('../assets/images/studi-wordmark.png')}
          style={styles.heroLogo}
        />
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>New account</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Finish your profile
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Add your name so Studi can show you in matches, sessions, and attendee lists.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Account setup</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
            <ThemedText type="defaultSemiBold">Step 1</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Tell us what to call you</ThemedText>
        <ThemedText style={styles.helperText}>
          We&apos;re creating an account for {email || 'your UW email'} and this name will appear
          across matches and study sessions.
        </ThemedText>

        <View style={styles.inlineRow}>
          <TextInput
            autoCapitalize="words"
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={firstName}
          />

          <TextInput
            autoCapitalize="words"
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={lastName}
          />
        </View>

        <Pressable
          disabled={isBusy}
          onPress={handleCompleteProfile}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isBusy ? 0.7 : 1 }]}>
          {isBusy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
              Create Account
            </ThemedText>
          )}
        </Pressable>

        <Pressable onPress={handleBack} style={[styles.secondaryButton, { borderColor: palette.outline }]}>
          <ThemedText type="defaultSemiBold">Back to Sign In</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>What happens next</ThemedText>
        <ThemedText type="subtitle">After this, you can:</ThemedText>
        <ThemedText style={styles.helperText}>
          Pick classes, save availability, browse sessions, and start exploring the rest of the
          app from your signed-in dashboard and Profile tab.
        </ThemedText>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    alignItems: 'center',
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  heroLogo: {
    height: 100,
    width: 300,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: {
    marginBottom: 4,
  },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    shadowColor: '#082431',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  helperText: {
    lineHeight: 30,
    opacity: 0.82,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  flexInput: {
    flex: 1,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
});
