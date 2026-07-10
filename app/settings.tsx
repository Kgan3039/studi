import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
    STUDI_CONTACT_EMAIL,
    STUDI_PRIVACY_POLICY_URL,
    STUDI_SUPPORT_URL,
} from '@/constants/app-info';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { deleteCurrentUserAccount, logOut, subscribeToAuthState } from '@/lib/auth';
import {
    DEFAULT_NOTIFICATION_PREFS,
    getNotificationPrefs,
    getUserProfile,
    saveNotificationPref,
    type NotificationPrefKey,
    type NotificationPrefs,
    type UserProfile,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

// Every row is a live control (design spec §3.13) — labels here, persistence
// in users/{uid}/private/settings. The notify() pipeline (later PR) reads them.
const NOTIFICATION_ROWS: {
  key: NotificationPrefKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'sessionReminders',
    label: 'Session reminders',
    description: 'Before study sessions you joined start.',
  },
  {
    key: 'sessionActivity',
    label: 'Session activity',
    description: 'Joins, changes, and cancellations for your sessions.',
  },
  {
    key: 'dmMessages',
    label: 'Direct messages',
    description: 'New messages sent directly to you.',
  },
  {
    key: 'groupMessages',
    label: 'Group messages',
    description: 'New messages in session group chats.',
  },
  {
    key: 'friendRequests',
    label: 'Friend requests',
    description: 'New requests and accepted requests.',
  },
];

function buildMailtoHref(email: string, subject: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}` as Href & string;
}

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [prefsState, setPrefsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isReauthenticatingDelete, setIsReauthenticatingDelete] = useState(false);
  const [showDeleteReauthModal, setShowDeleteReauthModal] = useState(false);
  const [deleteReauthPassword, setDeleteReauthPassword] = useState('');
  const [isDeletePasswordVisible, setIsDeletePasswordVisible] = useState(false);
  const [deleteReauthEmail, setDeleteReauthEmail] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    track('settings_viewed');
  }, []);

  // One fetch per screen visit — toggles mutate local state and write through,
  // so nothing refetches on render.
  const loadSettings = useCallback(async () => {
    if (!currentUser) {
      return;
    }

    setPrefsState('loading');
    // The academic line degrades to "Not set" if the profile read fails; only
    // the preferences read decides the section's error state.
    getUserProfile(currentUser.uid)
      .then(setProfile)
      .catch(() => {});
    try {
      setPrefs(await getNotificationPrefs(currentUser.uid));
      setPrefsState('ready');
    } catch {
      setPrefsState('error');
    }
  }, [currentUser]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  async function handleTogglePref(key: NotificationPrefKey, enabled: boolean) {
    if (!currentUser) {
      return;
    }

    const previousValue = prefs[key];
    setPrefs((current) => ({ ...current, [key]: enabled }));

    try {
      await saveNotificationPref(currentUser.uid, key, enabled);
      track('notification_pref_toggled', { category: key, enabled });
    } catch {
      setPrefs((current) => ({ ...current, [key]: previousValue }));
      Alert.alert(
        'Notifications Error',
        "That preference didn't save. Check your connection and try again."
      );
    }
  }

  async function handleSignOut() {
    try {
      setIsSigningOut(true);
      await logOut();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign out right now.';
      Alert.alert('Sign Out Error', message);
    } finally {
      setIsSigningOut(false);
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your Studi profile and account data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: handleDeleteAccount,
        },
      ]
    );
  }

  async function handleDeleteAccount() {
    setDeleteReauthPassword('');
    setDeleteReauthEmail(currentUser?.email ?? '');
    setIsDeletePasswordVisible(false);
    setShowDeleteReauthModal(true);
  }

  function closeDeleteReauthModal() {
    if (isReauthenticatingDelete) {
      return;
    }

    setShowDeleteReauthModal(false);
    setDeleteReauthPassword('');
    setIsDeletePasswordVisible(false);
  }

  async function handleDeleteWithReauthPassword() {
    if (!deleteReauthPassword.trim()) {
      Alert.alert('Password Required', 'Enter your password to continue deleting your account.');
      return;
    }

    try {
      setIsReauthenticatingDelete(true);
      const result = await deleteCurrentUserAccount({ password: deleteReauthPassword });

      if (result.status === 'requires-recent-login') {
        Alert.alert(
          'Re-authentication Needed',
          'Your session is still not recent enough. Please sign out, sign back in, then try again.'
        );
        return;
      }

      setShowDeleteReauthModal(false);
      setDeleteReauthPassword('');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to verify your password right now.';
      Alert.alert('Delete Account Error', message);
    } finally {
      setIsReauthenticatingDelete(false);
    }
  }

  const isBusy = isSigningOut || isReauthenticatingDelete;
  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;
  const inputColors = {
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.border,
    color: palette.text,
  };
  const academicLine = [profile?.year, profile?.major].filter(Boolean).join(' · ');

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}>
      {/* Account (design spec §3.13 grouped list). */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Account" />
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.row}>
            <Text style={[TypeScale.body, { color: palette.text }]}>UW email</Text>
            <Text style={[TypeScale.meta, styles.rowValue, { color: palette.icon }]} numberOfLines={1}>
              {currentUser?.email ?? '—'}
            </Text>
          </View>
          <View style={[styles.rowDivider, { backgroundColor: palette.border }]} />
          <View style={styles.row}>
            <Text style={[TypeScale.body, { color: palette.text }]}>Year &amp; major</Text>
            <Text style={[TypeScale.meta, styles.rowValue, { color: palette.icon }]} numberOfLines={1}>
              {academicLine || 'Not set'}
            </Text>
          </View>
          <View style={[styles.rowDivider, { backgroundColor: palette.border }]} />
          <View style={styles.row}>
            <Text style={[TypeScale.body, { color: palette.text }]}>Status</Text>
            <View style={styles.verifiedValue}>
              <View style={[styles.verifiedDot, { backgroundColor: palette.tint }]}>
                <Text style={styles.verifiedDotMark}>✓</Text>
              </View>
              <Text style={[TypeScale.meta, { color: palette.icon }]}>Verified student</Text>
            </View>
          </View>
          <View style={[styles.rowDivider, { backgroundColor: palette.border }]} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(tabs)/profile')}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[TypeScale.bodyStrong, { color: palette.tint }]}>Edit profile</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>›</Text>
          </Pressable>
        </View>
      </View>

      {/* Notifications — real switches, optimistic saves (design spec §3.13). */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Notifications" />
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {prefsState === 'error' ? (
            <View style={styles.errorBody}>
              <Text style={[TypeScale.body, { color: palette.text }]}>
                Your notification preferences didn’t load.
              </Text>
              <Pressable accessibilityRole="button" onPress={loadSettings}>
                <Text style={[TypeScale.label, { color: palette.tint }]}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            NOTIFICATION_ROWS.map((row, index) => (
              <View key={row.key}>
                {index > 0 ? (
                  <View style={[styles.rowDivider, { backgroundColor: palette.border }]} />
                ) : null}
                <View style={styles.row}>
                  <View style={styles.rowBody}>
                    <Text style={[TypeScale.body, { color: palette.text }]}>{row.label}</Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      {row.description}
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel={row.label}
                    disabled={prefsState !== 'ready'}
                    ios_backgroundColor={palette.surfaceMuted}
                    onValueChange={(enabled) => handleTogglePref(row.key, enabled)}
                    thumbColor="#FFFFFF"
                    trackColor={{ false: palette.surfaceMuted, true: palette.tint }}
                    value={prefs[row.key]}
                  />
                </View>
              </View>
            ))
          )}
        </View>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>
          Push notifications also respect your device settings.
        </Text>
      </View>

      {/* Privacy and support (moved from Profile). */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Privacy and support" />
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ExternalLink href={STUDI_PRIVACY_POLICY_URL as Href & string} asChild>
            <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[TypeScale.body, { color: palette.text }]}>Privacy Policy</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>›</Text>
            </Pressable>
          </ExternalLink>
          <View style={[styles.rowDivider, { backgroundColor: palette.border }]} />
          <ExternalLink href={STUDI_SUPPORT_URL as Href & string} asChild>
            <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[TypeScale.body, { color: palette.text }]}>Support</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>›</Text>
            </Pressable>
          </ExternalLink>
          <View style={[styles.rowDivider, { backgroundColor: palette.border }]} />
          <ExternalLink href={buildMailtoHref(STUDI_CONTACT_EMAIL, 'Studi Contact')} asChild>
            <Pressable style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[TypeScale.body, { color: palette.text }]}>Contact</Text>
              <Text style={[TypeScale.meta, styles.rowValue, { color: palette.icon }]} numberOfLines={1}>
                {STUDI_CONTACT_EMAIL}
              </Text>
            </Pressable>
          </ExternalLink>
        </View>
      </View>

      {/* Account actions (moved from Profile). */}
      <View style={styles.accountActions}>
        <Button
          label="Sign out"
          variant="secondary"
          fullWidth
          loading={isBusy}
          onPress={handleSignOut}
        />
        <Pressable
          disabled={isBusy}
          onPress={confirmDeleteAccount}
          style={({ pressed }) => [
            styles.deleteLink,
            { opacity: isBusy || pressed ? 0.6 : 1 },
          ]}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>Delete account</Text>
        </Pressable>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={closeDeleteReauthModal}
        transparent
        visible={showDeleteReauthModal}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>Confirm with password</Text>
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              For security, please re-enter your password for {deleteReauthEmail || 'your account'}.
            </Text>
            <View>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isReauthenticatingDelete}
                onChangeText={setDeleteReauthPassword}
                placeholder="Password"
                placeholderTextColor={placeholderColor}
                secureTextEntry={!isDeletePasswordVisible}
                style={[styles.input, styles.secureInput, inputColors]}
                value={deleteReauthPassword}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isDeletePasswordVisible ? 'Hide password' : 'Show password'}
                hitSlop={8}
                onPress={() => setIsDeletePasswordVisible((visible) => !visible)}
                style={styles.secureToggle}>
                <IconSymbol
                  name={isDeletePasswordVisible ? 'eye.slash' : 'eye'}
                  size={20}
                  color={palette.icon}
                />
              </Pressable>
            </View>
            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                disabled={isReauthenticatingDelete}
                onPress={closeDeleteReauthModal}
              />
              <Button
                label="Delete account"
                loading={isReauthenticatingDelete}
                onPress={handleDeleteWithReauthPassword}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Space.xl,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  section: {
    gap: Space.md,
  },
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: Space.lg + 4,
    paddingVertical: Space.xs,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: Space.sm,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowValue: {
    flexShrink: 1,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
  },
  verifiedValue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm - 2,
  },
  verifiedDot: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  verifiedDotMark: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 9,
    lineHeight: 11,
  },
  errorBody: {
    alignItems: 'flex-start',
    gap: Space.sm,
    paddingVertical: Space.md,
  },
  accountActions: {
    gap: Space.md,
  },
  deleteLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  input: {
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  secureInput: {
    paddingRight: Space.lg + 28,
  },
  secureToggle: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: Space.md,
    top: 0,
    width: 28,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: Space.lg + 4,
  },
  modalCard: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    maxWidth: 420,
    padding: Space.lg + 4,
    width: '100%',
  },
  modalActions: {
    flexDirection: 'row',
    gap: Space.sm + 2,
    justifyContent: 'flex-end',
  },
});
