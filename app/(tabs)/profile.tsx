import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { SectionHeader } from '@/components/ui/SectionHeader';
import {
    STUDI_CONTACT_EMAIL,
    STUDI_PRIVACY_POLICY_URL,
    STUDI_SUPPORT_URL,
} from '@/constants/app-info';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { identifyUser, track } from '@/lib/analytics';
import { deleteCurrentUserAccount, logOut, subscribeToAuthState } from '@/lib/auth';
import { UW_COURSE_CATALOG, UW_COURSE_COUNT, searchCourses } from '@/lib/catalog';
import {
    getLocationRatingAggregates,
    getLocations,
    getUpcomingSessions,
    getUserProfile,
    invalidateProfileCache,
    updateUserClasses,
    updateUserDisplayName,
    type LocationRatingAggregate,
    type StudyLocation,
    type StudySession,
} from '@/lib/firestore';
import { type Href } from 'expo-router';
import type { User } from 'firebase/auth';

// How many saved-location rows the board renders (ProfileScreen ~1815).
const SAVED_LOCATIONS_SHOWN = 3;

type ProfileStat = { value: string; label: string };

type SavedLocation = { name: string; rating: number | null };

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
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isReauthenticatingDelete, setIsReauthenticatingDelete] = useState(false);
  const [showDeleteReauthModal, setShowDeleteReauthModal] = useState(false);
  const [deleteReauthPassword, setDeleteReauthPassword] = useState('');
  const [deleteReauthEmail, setDeleteReauthEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [courseQuery, setCourseQuery] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [ratingAggregates, setRatingAggregates] = useState<
    Map<string, LocationRatingAggregate>
  >(() => new Map());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nameStatus, setNameStatus] = useState('Save your name so Studi looks more personal.');
  const [classesStatus, setClassesStatus] = useState('Update the classes you take.');
  const courseResults = useMemo(() => {
    if (courseQuery.trim().length < 2) {
      return [];
    }

    return searchCourses(courseQuery, classes, 14);
  }, [classes, courseQuery]);
  // Course titles for the saved-classes rows (board ProfileScreen) come from
  // the bundled catalog — no extra reads.
  const courseTitlesByCode = useMemo(
    () => new Map(UW_COURSE_CATALOG.map((course) => [course.code, course.title] as const)),
    []
  );

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  const loadProfile = useCallback(async () => {
    if (!currentUser) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    try {
      setIsLoading(true);
      try {
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
      }

      // Stats grid + per-class "N active" counts + saved locations all read
      // from existing data sources. Failures here must not blank the
      // identity block, so they degrade to empty quietly.
      try {
        const [loadedSessions, loadedLocations, aggregates] = await Promise.all([
          getUpcomingSessions({ includeInProgress: true }),
          getLocations(),
          getLocationRatingAggregates(),
        ]);
        setSessions(loadedSessions);
        setLocations(loadedLocations);
        setRatingAggregates(aggregates);
      } catch {
        // Keep whatever was last loaded; the sections fall back to zero/empty.
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();

      return () => {};
    }, [loadProfile])
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadProfile();
  }

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
    setDeleteReauthPassword('');
    setDeleteReauthEmail(currentUser?.email ?? '');
    setShowDeleteReauthModal(true);
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

  const isBusy = isSaving || isReauthenticatingDelete;
  const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;
  const inputColors = {
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.border,
    color: palette.text,
  };

  const classesUpper = useMemo(
    () => classes.map((classCode) => classCode.trim().toUpperCase()),
    [classes]
  );

  // Per-class "N active" counts on the current-classes rows come from the
  // sessions feed — the board's number with a real source behind it.
  const activeByClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      const code = session.classId.trim().toUpperCase();
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);

  // Stats grid (board: Joined / Hosted / Hours / Rating). Joined and Hosted
  // have real sources; Hours and Rating are not in the data model, so they
  // are replaced with the nearest real metrics (Classes, Matches) rather than
  // invented — same substitution convention as the Today hero.
  const stats: ProfileStat[] = useMemo(() => {
    const uid = currentUser?.uid ?? '';
    const joined = sessions.filter(
      (session) => uid && session.participantIds.includes(uid) && session.hostId !== uid
    ).length;
    const hosted = sessions.filter((session) => uid && session.hostId === uid).length;
    const matches = sessions.filter((session) =>
      classesUpper.includes(session.classId.trim().toUpperCase())
    ).length;

    return [
      { value: String(joined), label: 'Joined' },
      { value: String(hosted), label: 'Hosted' },
      { value: String(classes.length), label: 'Classes' },
      { value: String(matches), label: 'Matches' },
    ];
  }, [classes.length, classesUpper, currentUser, sessions]);

  // "Saved locations" is not modeled, so the section shows the top-rated UW
  // study spots from the locations + rating-aggregate sources, matching the
  // board's name + ★ rating rows.
  const savedLocations: SavedLocation[] = useMemo(() => {
    return locations
      .map((location) => ({
        name: location.name,
        rating: ratingAggregates.get(location.locationId)?.averageStars ?? null,
      }))
      .sort((first, second) => (second.rating ?? -1) - (first.rating ?? -1))
      .slice(0, SAVED_LOCATIONS_SHOWN);
  }, [locations, ratingAggregates]);

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
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
      }
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.xl }]}>
      {/* Avatar header + name / class-year block (board ProfileScreen ~1761). */}
      <View style={styles.identity}>
        <Avatar name={displayName || currentUser?.email || 'Student'} size="xl" verified />
        <View style={styles.nameRow}>
          <Text style={[styles.identityName, { color: palette.text }]} numberOfLines={1}>
            {displayName || currentUser?.email || 'Student'}
          </Text>
          <View
            accessibilityLabel="Verified UW student"
            style={[styles.verifiedCheck, { backgroundColor: palette.tint }]}>
            <Text style={styles.verifiedCheckMark}>✓</Text>
          </View>
        </View>
        {/* Board's "Junior · Computer Science · Class of '27" academic line is
            not in the data model; the verified UW identity is shown instead. */}
        <Text style={[TypeScale.eyebrow, styles.classYear, { color: palette.icon }]}>
          Verified @wisc.edu
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsEditingName((editing) => !editing)}
        >
          <Text style={[TypeScale.label, { color: palette.tint }]}>
            {isEditingName ? 'Done' : 'Edit'}
          </Text>
        </Pressable>
      </View>

      {/* Stats grid (board ProfileScreen ~1771). */}
      <View style={styles.statsGrid}>
        {stats.map((stat) => (
          <View
            key={stat.label}
            style={[styles.statCell, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.statValue, { color: palette.tint }]}>{stat.value}</Text>
            <Text style={[styles.statLabel, { color: palette.icon }]}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {isEditingName ? (
        <View
          style={[
            styles.card,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <Text style={[TypeScale.heading, { color: palette.text }]}>
            Your name
          </Text>

          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            {nameStatus}
          </Text>

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
      ) : null}

      {/* Current classes (board ProfileScreen ~1789). */}
      <View style={styles.section}>
        <SectionHeader
          eyebrow="Current classes"
          action={
            <Pressable accessibilityRole="button" onPress={() => setIsEditing((editing) => !editing)}>
              <Text style={[TypeScale.label, { color: palette.tint }]}>
                {isEditing ? 'Done' : 'Edit'}
              </Text>
            </Pressable>
          }
        />
        {classes.length > 0 ? (
          <View style={styles.rowList}>
            {classes.map((classCode) => (
              <View
                key={classCode}
                style={[styles.classRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={styles.classRowBody}>
                  <CourseChip code={classCode} size="sm" />
                  <Text
                    style={[TypeScale.bodyStrong, styles.classTitle, { color: palette.text }]}
                    numberOfLines={1}>
                    {courseTitlesByCode.get(classCode) ?? 'UW–Madison course'}
                  </Text>
                </View>
                <Text style={[TypeScale.label, { color: palette.icon }]}>
                  {activeByClass.get(classCode.trim().toUpperCase()) ?? 0} active
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            No classes saved yet. Tap Edit to add the courses you’re taking.
          </Text>
        )}
      </View>

      {/* Editor panel — kept from the prior screen so classes/name stay
          editable without a separate settings surface; revealed via Edit. */}
      {isEditing ? (
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
            <View style={styles.rowList}>
              {classes.map((classCode) => (
                <View
                  key={classCode}
                  style={[styles.editClassRow, { borderColor: palette.border }]}>
                  <CourseChip code={classCode} size="sm" />
                  <Text
                    style={[TypeScale.body, styles.classTitle, { color: palette.text }]}
                    numberOfLines={1}>
                    {courseTitlesByCode.get(classCode) ?? 'UW–Madison course'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${classCode}`}
                    disabled={isSaving}
                    onPress={() => toggleClassSelection(classCode)}
                    style={({ pressed }) => [
                      styles.removeButton,
                      { opacity: isSaving || pressed ? 0.4 : 1 },
                    ]}>
                    <Text style={[TypeScale.label, { color: palette.icon }]}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <Button label="Save classes" fullWidth loading={isSaving} onPress={handleSaveClasses} />
        </View>
      ) : null}

      {/* Saved locations (board ProfileScreen ~1814). */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Saved locations" />
        {savedLocations.length > 0 ? (
          <View style={styles.rowList}>
            {savedLocations.map((location) => (
              <View
                key={location.name}
                style={[styles.locationRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <Text style={[TypeScale.bodyStrong, styles.locationName, { color: palette.text }]} numberOfLines={1}>
                  {location.name}
                </Text>
                <Text style={[TypeScale.label, { color: palette.icon }]}>
                  {location.rating != null ? `★ ${location.rating.toFixed(1)}` : 'New'}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            Rate a study spot to see your places here.
          </Text>
        )}
      </View>

      {/* Account — board defers these behind its top-right Settings entry; with
          no settings screen they live here so nothing becomes unreachable. */}
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
    gap: Space.xl,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  identity: {
    alignItems: 'center',
    gap: Space.sm,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm - 2,
    marginTop: Space.xs,
  },
  identityName: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 28,
    lineHeight: 34,
    flexShrink: 1,
    textAlign: 'center',
  },
  verifiedCheck: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  verifiedCheckMark: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 10,
    lineHeight: 12,
  },
  classYear: {
    marginTop: Space.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  statCell: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flex: 1,
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.md,
  },
  statValue: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 20,
    lineHeight: 24,
  },
  statLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  section: {
    gap: Space.md,
  },
  rowList: {
    gap: Space.sm,
  },
  classRow: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm,
  },
  classRowBody: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: Space.md,
  },
  classTitle: {
    flexShrink: 1,
  },
  locationRow: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm,
  },
  locationName: {
    flexShrink: 1,
  },
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.lg + 4,
  },
  editClassRow: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 52,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  removeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
  editDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Space.xs,
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
