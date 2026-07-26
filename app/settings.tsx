import { type Href, useFocusEffect, useRouter } from 'expo-router';
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
import { ActionRow } from '@/components/ui/ActionRow';
import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
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
  icon: 'calendar' | 'message.fill' | 'person.2.fill';
}[] = [
  {
    key: 'sessionReminders',
    label: 'Session reminders',
    description: 'Before study sessions you joined start.',
    icon: 'calendar',
  },
  {
    key: 'sessionActivity',
    label: 'Session activity',
    description: 'Joins, changes, and cancellations for your sessions.',
    icon: 'calendar',
  },
  {
    key: 'dmMessages',
    label: 'Direct messages',
    description: 'New messages sent directly to you.',
    icon: 'message.fill',
  },
  {
    key: 'groupMessages',
    label: 'Group messages',
    description: 'New messages in session group chats.',
    icon: 'message.fill',
  },
  {
    key: 'friendRequests',
    label: 'Friend requests',
    description: 'New requests and accepted requests.',
    icon: 'person.2.fill',
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

  // Fires on every focus, not just mount — coming back from Edit profile
  // counts as a fresh view.
  useFocusEffect(
    useCallback(() => {
      track('settings_viewed');
    }, [])
  );

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
  const academicLine = [profile?.year, profile?.major].filter(Boolean).join(', ');

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}>
      <ScreenTransition style={styles.transition}>
      {/* Account (design spec §3.13 grouped list). */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Account" />
        <View style={[styles.groupList, { borderColor: palette.border }]}>
          <ActionRow
            icon="envelope.fill"
            label="UW email"
            showChevron={false}
            value={currentUser?.email ?? 'Unavailable'}
          />
          <ActionRow
            icon="book.closed"
            label="Year and major"
            showChevron={false}
            value={academicLine || 'Not set'}
          />
          <ActionRow
            icon="lock.shield.fill"
            label="Student status"
            showChevron={false}
            value="Verified"
          />
          <ActionRow
            divided={false}
            icon="square.and.pencil"
            label="Edit profile"
            onPress={() => router.push('/(tabs)/profile')}
          />
        </View>
      </View>

      {/* Notifications — real switches, optimistic saves (design spec §3.13). */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Notifications" />
        <View style={[styles.groupList, { borderColor: palette.border }]}>
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
              <ActionRow
                accessory={
                  <Switch
                    accessibilityLabel={row.label}
                    disabled={prefsState !== 'ready'}
                    ios_backgroundColor={palette.surfaceMuted}
                    onValueChange={(enabled) => handleTogglePref(row.key, enabled)}
                    thumbColor="#FFFFFF"
                    trackColor={{ false: palette.surfaceMuted, true: palette.tint }}
                    value={prefs[row.key]}
                  />
                }
                description={row.description}
                divided={index < NOTIFICATION_ROWS.length - 1}
                icon={row.icon}
                key={row.key}
                label={row.label}
                showChevron={false}
              />
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
        <View style={[styles.groupList, { borderColor: palette.border }]}>
          <ExternalLink href={STUDI_PRIVACY_POLICY_URL as Href & string} asChild>
            <ActionRow icon="hand.raised.fill" label="Privacy policy" />
          </ExternalLink>
          <ExternalLink href={STUDI_SUPPORT_URL as Href & string} asChild>
            <ActionRow icon="questionmark.circle.fill" label="Support" />
          </ExternalLink>
          <ExternalLink href={buildMailtoHref(STUDI_CONTACT_EMAIL, 'Studi Contact')} asChild>
            <ActionRow
              divided={false}
              icon="envelope.fill"
              label="Contact"
              value={STUDI_CONTACT_EMAIL}
            />
          </ExternalLink>
        </View>
      </View>

      {/* Account actions (moved from Profile). */}
      <View style={styles.accountActions}>
        <Button
          icon="rectangle.portrait.and.arrow.right"
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
          <View style={styles.deleteContent}>
            <IconSymbol color={palette.destructive} name="trash.fill" size={17} />
            <Text style={[TypeScale.label, { color: palette.destructive }]}>Delete account</Text>
          </View>
        </Pressable>
      </View>
      </ScreenTransition>

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
  transition: {
    gap: Space.xl,
  },
  section: {
    gap: Space.md,
  },
  groupList: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
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
  deleteContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
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
