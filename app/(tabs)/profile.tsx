import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { identifyUser, track } from '@/lib/analytics';
import {
  STUDI_CONTACT_EMAIL,
  STUDI_PRIVACY_POLICY_URL,
  STUDI_SUPPORT_URL,
} from '@/constants/app-info';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteCurrentUserAccount, logOut, subscribeToAuthState } from '@/lib/auth';
import { UW_COURSE_COUNT, searchCourses } from '@/lib/catalog';
import {
  getUserProfile,
  invalidateProfileCache,
  updateUserClasses,
  updateUserDisplayName,
} from '@/lib/firestore';
import { type Href } from 'expo-router';
import type { User } from 'firebase/auth';

function splitDisplayName(displayName: string | undefined) {
  const normalized = displayName?.trim() ?? '';

  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName, ...rest] = normalized.split(/\s+/);
  return {
    firstName,
    lastName: rest.join(' '),
  };
}

function buildMailtoHref(email: string, subject: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}` as Href & string;
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isReauthenticatingDelete, setIsReauthenticatingDelete] = useState(false);
  const [showDeleteReauthModal, setShowDeleteReauthModal] = useState(false);
  const [deleteReauthPassword, setDeleteReauthPassword] = useState('');
  const [deleteReauthEmail, setDeleteReauthEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [courseQuery, setCourseQuery] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [nameStatus, setNameStatus] = useState('Save your name so Studi looks more personal.');
  const [classesStatus, setClassesStatus] = useState('Update the classes you take.');
  const courseResults = useMemo(() => {
    if (courseQuery.trim().length < 2) {
      return [];
    }

    return searchCourses(courseQuery, classes, 14);
  }, [classes, courseQuery]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useFocusEffect(
    useCallback(() => {
    async function loadProfile() {
      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const profile = await getUserProfile(currentUser.uid);
        const savedName = splitDisplayName(profile?.displayName);
        const savedClasses = profile?.classes ?? [];
        setFirstName(savedName.firstName);
        setLastName(savedName.lastName);
        setClasses(savedClasses);
        setNameStatus(
          profile?.displayName
            ? `Saved as ${profile.displayName}.`
            : 'Add your first and last name to personalize Studi.'
        );
        setClassesStatus(
          savedClasses.length > 0
            ? `You'll see sessions for ${savedClasses.length} class${
                savedClasses.length === 1 ? '' : 'es'
              }.`
            : 'No classes saved yet.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your profile.';
        setNameStatus(message);
        setClassesStatus(message);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();

    return () => {};
  }, [currentUser])
);

  function toggleClassSelection(classCode: string) {
    setClasses((currentClasses) =>
      currentClasses.includes(classCode)
        ? currentClasses.filter((selectedClass) => selectedClass !== classCode)
        : [...currentClasses, classCode]
    );
  }

  function handleAddCourse(classCode: string) {
    setClasses((currentClasses) =>
      currentClasses.includes(classCode) ? currentClasses : [...currentClasses, classCode]
    );
    setCourseQuery('');
  }

  async function handleSaveName() {
    if (!currentUser) {
      return;
    }

    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();

    if (!firstName.trim() || !lastName.trim()) {
      setNameStatus('Enter both your first and last name.');
      Alert.alert('Name Error', 'Please enter both your first and last name.');
      return;
    }

    try {
      setIsSaving(true);
      await updateUserDisplayName(currentUser.uid, displayName);
      invalidateProfileCache(currentUser.uid);
      setNameStatus(`Saved as ${displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save your name right now.';
      setNameStatus(message);
      Alert.alert('Name Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveClasses() {
    if (!currentUser) {
      return;
    }

    try {
      setIsSaving(true);
      await updateUserClasses(currentUser.uid, classes);
      track('classes_saved', { count: classes.length });
      identifyUser(currentUser.uid, { classCount: classes.length });
      setClassesStatus(
        classes.length > 0
          ? `You'll see sessions for ${classes.length} class${classes.length === 1 ? '' : 'es'}.`
          : 'No classes saved yet.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save classes right now.';
      setClassesStatus(message);
      Alert.alert('Classes Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      setIsSaving(true);
      await logOut();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign out right now.';
      Alert.alert('Sign Out Error', message);
    } finally {
      setIsSaving(false);
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
    try {
      setIsDeletingAccount(true);
      const result = await deleteCurrentUserAccount();

      if (result.status === 'requires-recent-login') {
        setDeleteReauthPassword('');
        setDeleteReauthEmail(result.email);
        setShowDeleteReauthModal(true);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete your account right now.';
      Alert.alert('Delete Account Error', message);
    } finally {
      setIsDeletingAccount(false);
    }
  }

  function closeDeleteReauthModal() {
    if (isReauthenticatingDelete) {
      return;
    }

    setShowDeleteReauthModal(false);
    setDeleteReauthPassword('');
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

  const isBusy = isSaving || isDeletingAccount || isReauthenticatingDelete;
  const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const avatarInitials =
    (firstName.trim().slice(0, 1) + lastName.trim().slice(0, 1)).toUpperCase() ||
    (currentUser?.email ?? 'S').slice(0, 1).toUpperCase();
  const placeholderColor = colorScheme === 'dark' ? '#9F918B' : Brand.charcoal400;
  const inputColors = {
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.border,
    color: palette.text,
  };

  if (!currentUser && !isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <Text style={[TypeScale.heading, { color: palette.text }]}>
          Sign in to view your profile
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <Text style={[TypeScale.title, { color: palette.text }]}>You</Text>

      <View style={styles.identity}>
        <View
          style={[
            styles.avatar,
            { backgroundColor: colorScheme === 'dark' ? `${palette.tint}33` : Brand.red100 },
          ]}>
          <Text
            style={[
              styles.avatarInitials,
              { color: colorScheme === 'dark' ? palette.tint : Brand.red700 },
            ]}>
            {avatarInitials}
          </Text>
        </View>
        <View style={styles.identityText}>
          <Text style={[TypeScale.heading, { color: palette.text }]} numberOfLines={1}>
            {displayName || currentUser?.email || 'Student'}
          </Text>
          <BadgeChip label="✓ Verified @wisc.edu" tone="lake" />
          {displayName && currentUser?.email ? (
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {currentUser.email}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[TypeScale.heading, { color: palette.text }]}>Your classes</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{classesStatus}</Text>
        <TextInput
          autoCapitalize="characters"
          editable={!isSaving}
          onChangeText={setCourseQuery}
          placeholder={`Search ${UW_COURSE_COUNT.toLocaleString()} UW courses`}
          placeholderTextColor={placeholderColor}
          style={[styles.input, inputColors]}
          value={courseQuery}
        />
        {courseQuery.trim().length >= 2 ? (
          <View style={styles.searchResults}>
            {courseResults.length > 0 ? (
              courseResults.map((course) => (
                <Pressable
                  key={course.code}
                  disabled={isSaving}
                  onPress={() => handleAddCourse(course.code)}
                  style={({ pressed }) => [
                    styles.searchResultCard,
                    {
                      backgroundColor: palette.surfaceMuted,
                      borderColor: palette.border,
                      opacity: isSaving || pressed ? 0.6 : 1,
                    },
                  ]}>
                  <Text style={[TypeScale.code, { color: palette.text }]}>{course.code}</Text>
                  <Text style={[TypeScale.body, { color: palette.text }]} numberOfLines={1}>
                    {course.title}
                  </Text>
                  <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                    {course.subjectName} · {course.credits}
                  </Text>
                </Pressable>
              ))
            ) : (
              <Text style={[TypeScale.caption, { color: palette.icon }]}>
                No courses matched that search yet.
              </Text>
            )}
          </View>
        ) : null}
        {classes.length > 0 ? (
          <>
            <View style={styles.chipRow}>
              {classes.map((classCode) => (
                <CourseChip
                  key={classCode}
                  code={classCode}
                  selected
                  onPress={isSaving ? undefined : () => toggleClassSelection(classCode)}
                />
              ))}
            </View>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              Tap a class to remove it.
            </Text>
          </>
        ) : null}
        <Button label="Save classes" fullWidth loading={isSaving} onPress={handleSaveClasses} />
      </View>

      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[TypeScale.heading, { color: palette.text }]}>Your name</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{nameStatus}</Text>
        <View style={styles.inlineRow}>
          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={placeholderColor}
            style={[styles.input, styles.flexInput, inputColors]}
            value={firstName}
          />
          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={placeholderColor}
            style={[styles.input, styles.flexInput, inputColors]}
            value={lastName}
          />
        </View>
        <Button
          label="Save name"
          variant="secondary"
          fullWidth
          loading={isSaving}
          onPress={handleSaveName}
        />
      </View>

      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[TypeScale.heading, { color: palette.text }]}>Privacy and support</Text>
        <View style={styles.linkList}>
          <ExternalLink href={STUDI_PRIVACY_POLICY_URL as Href & string} asChild>
            <Pressable style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[TypeScale.label, { color: palette.text }]}>Privacy Policy</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>›</Text>
            </Pressable>
          </ExternalLink>
          <View style={[styles.linkDivider, { backgroundColor: palette.border }]} />
          <ExternalLink href={STUDI_SUPPORT_URL as Href & string} asChild>
            <Pressable style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[TypeScale.label, { color: palette.text }]}>Support</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>›</Text>
            </Pressable>
          </ExternalLink>
          <View style={[styles.linkDivider, { backgroundColor: palette.border }]} />
          <ExternalLink href={buildMailtoHref(STUDI_CONTACT_EMAIL, 'Studi Contact')} asChild>
            <Pressable style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[TypeScale.label, { color: palette.text }]}>Contact</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                {STUDI_CONTACT_EMAIL}
              </Text>
            </Pressable>
          </ExternalLink>
        </View>
      </View>

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
          {isDeletingAccount ? (
            <ActivityIndicator color={palette.tint} />
          ) : (
            <Text style={[TypeScale.label, { color: palette.tint }]}>Delete account</Text>
          )}
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
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isReauthenticatingDelete}
              onChangeText={setDeleteReauthPassword}
              placeholder="Password"
              placeholderTextColor={placeholderColor}
              secureTextEntry
              style={[styles.input, inputColors]}
              value={deleteReauthPassword}
            />
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
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: Space.xl,
  },
  screen: {
    flex: 1,
  },
  content: {
    gap: Space.lg,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  identity: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.lg,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  avatarInitials: {
    fontFamily: FontFamily.code,
    fontSize: 22,
    letterSpacing: 0.5,
    lineHeight: 28,
  },
  identityText: {
    flexShrink: 1,
    gap: Space.xs + 2,
  },
  card: {
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.lg + 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm + 2,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm + 2,
  },
  flexInput: {
    flex: 1,
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
  searchResults: {
    gap: Space.sm + 2,
  },
  searchResultCard: {
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.xs,
    padding: Space.md + 2,
  },
  linkList: {
    gap: 0,
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 48,
  },
  linkDivider: {
    height: StyleSheet.hairlineWidth,
  },
  accountActions: {
    gap: Space.md,
  },
  deleteLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
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
    borderTopRightRadius: Radius.accentCorner,
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
