import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { reportUser } from '@/lib/firestore';
import type { User } from 'firebase/auth';

const REPORT_REASONS = ['Spam', 'Harassment', 'Unsafe behavior', 'Impersonation', 'Other'];

export default function ReportUserScreen() {
  const router = useRouter();
  const { reportedUserEmail, reportedUserId, reportedUserName, context } = useLocalSearchParams<{
    context?: string;
    reportedUserEmail?: string;
    reportedUserId?: string;
    reportedUserName?: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  async function handleSubmitReport() {
    if (!currentUser || !reportedUserId) {
      Alert.alert('Report Error', 'You need to be signed in to submit a report.');
      return;
    }

    try {
      setIsSubmitting(true);
      await reportUser(currentUser.uid, reportedUserId, selectedReason, details, context || 'general');
      Alert.alert('Report Submitted', 'Thanks for flagging this. The report was saved.');
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit report right now.';
      Alert.alert('Report Error', message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Safety</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Report User
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Let us know if something felt unsafe or inappropriate so the app can stay useful and respectful.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Reporting</ThemedText>
        <ThemedText type="subtitle">{reportedUserName || reportedUserEmail || 'This user'}</ThemedText>
        {reportedUserEmail ? <ThemedText style={styles.mutedText}>{reportedUserEmail}</ThemedText> : null}
        <View style={styles.chipRow}>
          {REPORT_REASONS.map((reason) => {
            const isSelected = selectedReason === reason;

            return (
              <Pressable
                key={reason}
                onPress={() => setSelectedReason(reason)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                    borderColor: isSelected ? palette.tint : palette.outline,
                  },
                ]}>
                <ThemedText
                  type="defaultSemiBold"
                  lightColor={isSelected ? '#ffffff' : undefined}
                  darkColor={isSelected ? '#ffffff' : undefined}>
                  {reason}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          multiline
          onChangeText={setDetails}
          placeholder="Add any context that would help explain what happened"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[styles.input, { borderColor: palette.outline, color: palette.text }]}
          value={details}
        />
        <Pressable
          disabled={isSubmitting}
          onPress={handleSubmitReport}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isSubmitting ? 0.6 : 1 }]}>
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            Submit Report
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroTitle: { marginBottom: 4 },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  mutedText: {
    opacity: 0.78,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 140,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
});
