import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FilterChip } from '@/components/ui/FilterChip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useOverlayEntrance } from '@/components/ui/overlay-motion';
import { Brand, Colors, Elevation, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { blockUser, reportUser } from '@/lib/firestore';
import { getUserFacingErrorMessage } from '@/lib/user-facing-errors';
import { rememberReportedUser } from '@/lib/reported-users';
import { createReportSubmitGuard } from '@/lib/report-submit-guard';
import type { User } from 'firebase/auth';

const REPORT_REASONS = ['Spam', 'Harassment', 'Unsafe behavior', 'Impersonation', 'Other'];

export default function ReportUserScreen() {
  const router = useRouter();
  const { reportedUserId, reportedUserName, context, contentType, contentId, threadId } = useLocalSearchParams<{
    context?: string;
    contentId?: string;
    contentType?: 'direct_message' | 'session_message';
    reportedUserId?: string;
    reportedUserName?: string;
    threadId?: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [blockRetryNeeded, setBlockRetryNeeded] = useState(false);
  const [isRetryingBlock, setIsRetryingBlock] = useState(false);
  const submitGuard = useRef(createReportSubmitGuard());

  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;
  // Presented as a transparentModal route, so it drives its own entrance.
  const { panelStyle, scrimStyle } = useOverlayEntrance(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  async function handleSubmitReport() {
    if (blockRetryNeeded || !submitGuard.current.acquire()) {
      return;
    }
    if (!currentUser || !reportedUserId) {
      submitGuard.current.releaseAfterFailure();
      Alert.alert('Report Error', 'You need to be signed in to submit a report.');
      return;
    }

    let reportSubmitted = false;
    try {
      setIsSubmitting(true);
      await reportUser(
        currentUser.uid,
        reportedUserId,
        selectedReason,
        details,
        context || 'general',
        contentType && contentId && threadId ? { contentType, contentId, threadId } : undefined
      );
      reportSubmitted = true;
      submitGuard.current.markSubmitted();
      track('report_submitted', { reason: selectedReason, context: context || 'general' });
      await rememberReportedUser(reportedUserId);

      // Reporting someone always blocks them too: nobody wants to keep hearing
      // from a person they just reported while the review is pending.
      let didBlock = false;
      try {
        await blockUser(currentUser.uid, reportedUserId);
        track('user_blocked', { context: 'report' });
        didBlock = true;
      } catch {
        setBlockRetryNeeded(true);
      }

      setConfirmSubmit(false);
      if (didBlock) {
        Alert.alert(
          'Report Sent',
          `Thanks for flagging this. ${reportedUserName || 'This student'} has been blocked while our team reviews it.`
        );
        router.back();
      } else {
        Alert.alert(
          'Report Sent',
          "Your report was sent, but we couldn't block this student. Use Try Blocking Again below."
        );
      }
    } catch (error) {
      if (!reportSubmitted) {
        submitGuard.current.releaseAfterFailure();
      }
      Alert.alert('Report Error', getUserFacingErrorMessage(error, 'report'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetryBlock() {
    if (!currentUser || !reportedUserId || isRetryingBlock) {
      return;
    }

    try {
      setIsRetryingBlock(true);
      await blockUser(currentUser.uid, reportedUserId);
      track('user_blocked', { context: 'report_retry' });
      setBlockRetryNeeded(false);
      Alert.alert('Student Blocked', `${reportedUserName || 'This student'} has been blocked.`);
      router.back();
    } catch {
      Alert.alert('Unable to Block', 'Unable to block this student right now. Please try again.');
    } finally {
      setIsRetryingBlock(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
      <Pressable
        accessibilityLabel="Close report"
        accessibilityRole="button"
        onPress={() => router.back()}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.panel,
          Elevation.e3,
          panelStyle,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            marginTop: insets.top + Space.md,
          },
        ]}>
        <View style={[styles.panelHeader, { borderBottomColor: palette.border }]}>
          <View style={styles.panelHeaderCopy}>
            <Text style={[TypeScale.h2, { color: palette.text }]}>Report</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              Private, and reviewed by our team
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: palette.surfaceMuted, opacity: pressed ? 0.6 : 1 },
            ]}>
            <IconSymbol name="xmark" size={17} color={palette.text} />
          </Pressable>
        </View>

        <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Space.lg) },
        ]}>
        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={[TypeScale.label, { color: palette.icon }]}>Reporting</Text>
            <Text style={[styles.subjectName, { color: palette.text }]}>
              {reportedUserName || 'this user'}
            </Text>
          </View>

          {blockRetryNeeded ? (
            <View style={styles.fieldGroup}>
              <Text style={[TypeScale.body, { color: palette.text }]}>Your report was sent.</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>Blocking did not complete.</Text>
              <Button
                label="Try Blocking Again"
                loading={isRetryingBlock}
                onPress={handleRetryBlock}
                variant="secondary"
              />
            </View>
          ) : null}

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
            disabled={blockRetryNeeded}
            fullWidth
            label="Submit report"
            loading={isSubmitting}
            onPress={() => setConfirmSubmit(true)}
            size="lg"
          />
        </View>
        </ScrollView>
      </Animated.View>

      <ConfirmDialog
        visible={confirmSubmit}
        title="Report and Block?"
        body={`${
          reportedUserName || 'This student'
        } will be blocked and our team will review your report. They won't be told who reported them.`}
        confirmLabel="Report and Block"
        loading={isSubmitting}
        onConfirm={handleSubmitReport}
        onCancel={() => setConfirmSubmit(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  scrim: {
    backgroundColor: 'rgba(18, 24, 21, 0.32)',
  },
  panel: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    marginHorizontal: Space.md,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  panelHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    paddingBottom: Space.md,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  panelHeaderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  content: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
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
