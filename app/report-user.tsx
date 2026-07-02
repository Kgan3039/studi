import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { reportUser } from '@/lib/firestore';
import type { User } from 'firebase/auth';

const REPORT_REASONS = ['Spam', 'Harassment', 'Unsafe behavior', 'Impersonation', 'Other'];

export default function ReportUserScreen() {
  const router = useRouter();
  const { reportedUserId, reportedUserName, context } = useLocalSearchParams<{
    context?: string;
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

  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;

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
      track('report_submitted', { reason: selectedReason, context: context || 'general' });
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Space.xxl, paddingTop: Space.lg },
        ]}>
        <View style={styles.header}>
          <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Safety</Text>
          <Text style={[styles.headerTitle, { color: palette.text }]}>Help keep Studi safe</Text>
          <Text style={[TypeScale.body, { color: palette.icon }]}>
            Tell us what happened. Reports are private and reviewed by the Studi team.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Reporting</Text>
            <Text style={[TypeScale.heading, { color: palette.text }]}>
              {reportedUserName || 'This user'}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Reason</Text>
            <View style={styles.chipRow}>
              {REPORT_REASONS.map((reason) => {
                const isSelected = selectedReason === reason;

                return (
                  <Pressable
                    key={reason}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelectedReason(reason)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                        borderColor: isSelected ? palette.tint : palette.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}>
                    <Text style={[TypeScale.label, { color: isSelected ? '#FFFFFF' : palette.text }]}>
                      {reason}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Details (optional)</Text>
            <TextInput
              maxLength={1000}
              multiline
              onChangeText={setDetails}
              placeholder="Add any context that would help explain what happened"
              placeholderTextColor={placeholderColor}
              style={[
                styles.input,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.border,
                  color: palette.text,
                },
              ]}
              value={details}
            />
          </View>

          <Button
            fullWidth
            label="Submit Report"
            loading={isSubmitting}
            onPress={handleSubmitReport}
            size="lg"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Space.xl,
    padding: Space.lg + 4,
  },
  header: {
    gap: Space.xs,
  },
  headerTitle: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 29,
  },
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.lg,
    padding: Space.lg + 4,
  },
  fieldGroup: {
    gap: Space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm + 2,
  },
  chip: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm - 2,
  },
  input: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 120,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    textAlignVertical: 'top',
  },
});
