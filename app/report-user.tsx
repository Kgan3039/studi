import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FilterChip } from '@/components/ui/FilterChip';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
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
  const [confirmSubmit, setConfirmSubmit] = useState(false);

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
      setConfirmSubmit(false);
      Alert.alert('Report submitted', 'Thanks for flagging this. Our team will review it.');
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
        <ScreenTransition style={styles.transition}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: palette.text }]}>Help keep Studi safe</Text>
          <Text style={[TypeScale.body, { color: palette.icon }]}>
            Tell us what happened. Reports are private and reviewed by the Studi team.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.label, { color: palette.icon }]}>Reporting</Text>
            <Text style={[styles.subjectName, { color: palette.text }]}>
              {reportedUserName || 'this user'}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>What happened?</Text>
            <View style={styles.chipRow}>
              {REPORT_REASONS.map((reason) => {
                const isSelected = selectedReason === reason;

                return (
                  <FilterChip
                    key={reason}
                    label={reason}
                    onPress={() => setSelectedReason(reason)}
                    selected={isSelected}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>Add details</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>Optional</Text>
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
            label="Submit report"
            loading={isSubmitting}
            onPress={() => setConfirmSubmit(true)}
            size="lg"
          />
        </View>
        </ScreenTransition>
      </ScrollView>

      <ConfirmDialog
        visible={confirmSubmit}
        title="Send this report?"
        body={`We'll review your ${selectedReason.toLowerCase()} report about ${
          reportedUserName || 'this student'
        }. They won't be told who reported them.`}
        confirmLabel="Send report"
        loading={isSubmitting}
        onConfirm={handleSubmitReport}
        onCancel={() => setConfirmSubmit(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: Space.lg + 4,
  },
  transition: {
    gap: Space.xl,
  },
  header: {
    gap: Space.xs,
  },
  headerTitle: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 29,
  },
  form: {
    gap: Space.lg,
  },
  fieldGroup: {
    gap: Space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm + 2,
  },
  subjectName: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 29,
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
