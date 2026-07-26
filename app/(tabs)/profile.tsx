import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { NotificationCenterButton } from '@/components/ui/NotificationCenterButton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { identifyUser, track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { UW_COURSE_CATALOG, UW_COURSE_COUNT, searchCourses } from '@/lib/catalog';
import {
    getLocationRatingAggregates,
    getLocations,
    getUpcomingSessions,
    getUserProfile,
    invalidateProfileCache,
    PROFILE_BIO_MAX_LENGTH,
    PROFILE_MAJOR_MAX_LENGTH,
    PROFILE_PRONOUNS_MAX_LENGTH,
    updateUserClasses,
    updateUserDisplayName,
    updateUserProfileDetails,
    USER_YEARS,
    type LocationRatingAggregate,
    type StudyLocation,
    type StudySession,
    type UserYear,
} from '@/lib/firestore';
import { useRouter, type Href } from 'expo-router';
import type { User } from 'firebase/auth';

// How many saved-location rows the board renders (ProfileScreen ~1815).
const SAVED_LOCATIONS_SHOWN = 3;

type ProfileStat = { value: string; label: string };

type SavedLocation = { name: string; rating: number | null };

// Last-saved values, kept to compute the profile_updated fieldsChanged count
// (a number, never the values — docs/metrics.md).
type SavedProfileFields = {
  displayName: string;
  year: UserYear | null;
  major: string;
  pronouns: string;
  bio: string;
};

const EMPTY_SAVED_FIELDS: SavedProfileFields = {
  displayName: '',
  year: null,
  major: '',
  pronouns: '',
  bio: '',
};

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

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [major, setMajor] = useState('');
  const [year, setYear] = useState<UserYear | null>(null);
  const [pronouns, setPronouns] = useState('');
  const [bio, setBio] = useState('');
  const [savedFields, setSavedFields] = useState<SavedProfileFields>(EMPTY_SAVED_FIELDS);
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
        setMajor(profile?.major ?? '');
        setYear(profile?.year ?? null);
        setPronouns(profile?.pronouns ?? '');
        setBio(profile?.bio ?? '');
        setSavedFields({
          displayName: profile?.displayName ?? '',
          year: profile?.year ?? null,
          major: profile?.major ?? '',
          pronouns: profile?.pronouns ?? '',
          bio: profile?.bio ?? '',
        });
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

  async function handleSaveProfile() {
    if (!currentUser) {
      return;
    }

    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();

    if (!firstName.trim() || !lastName.trim()) {
      setNameStatus('Enter both your first and last name.');
      Alert.alert('Profile Error', 'Please enter both your first and last name.');
      return;
    }

    const details = {
      year,
      major: major.trim(),
      pronouns: pronouns.trim(),
      bio: bio.trim(),
    };
    const nameChanged = displayName !== savedFields.displayName;
    const detailsChanged =
      details.year !== savedFields.year ||
      details.major !== savedFields.major ||
      details.pronouns !== savedFields.pronouns ||
      details.bio !== savedFields.bio;
    const fieldsChanged =
      Number(nameChanged) +
      Number(details.year !== savedFields.year) +
      Number(details.major !== savedFields.major) +
      Number(details.pronouns !== savedFields.pronouns) +
      Number(details.bio !== savedFields.bio);

    try {
      setIsSaving(true);
      if (nameChanged) {
        await updateUserDisplayName(currentUser.uid, displayName);
      }
      if (detailsChanged) {
        await updateUserProfileDetails(currentUser.uid, details);
      }
      if (fieldsChanged > 0) {
        invalidateProfileCache(currentUser.uid);
        track('profile_updated', { fieldsChanged });
      }
      setSavedFields({ displayName, ...details });
      setMajor(details.major);
      setPronouns(details.pronouns);
      setBio(details.bio);
      setNameStatus(`Saved as ${displayName}.`);
      setIsEditingName(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save your profile right now.';
      setNameStatus(message);
      Alert.alert('Profile Error', message);
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

  const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
  // "Junior · Computer Science · she/her" — only the fields the user filled in.
  const academicLine = [year, major.trim(), pronouns.trim()]
    .filter(Boolean)
    .join(' · ');
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

  // Saved locations are not modeled, so this section accurately presents the
  // top-rated UW study spots from the locations + rating-aggregate sources.
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
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <ScreenHeader title="You" action={<NotificationCenterButton />} />

      <View style={styles.identity}>
        <Avatar name={displayName || currentUser?.email || 'Student'} size="lg" verified />
        <View style={styles.identityCopy}>
          <Text style={[styles.identityName, { color: palette.text }]} numberOfLines={1}>
            {displayName || currentUser?.email || 'Student'}
          </Text>
          {academicLine ? (
            <Text style={[TypeScale.body, { color: palette.icon }]} numberOfLines={1}>
              {academicLine}
            </Text>
          ) : null}
          <Text style={[TypeScale.meta, { color: palette.icon }]}>
            Verified @wisc.edu
          </Text>
          {bio.trim() ? (
            <Text style={[TypeScale.body, styles.bioText, { color: palette.text }]}>
              {bio.trim()}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsEditingName((editing) => !editing)}
          hitSlop={8}>
          <Text style={[TypeScale.label, { color: palette.tint }]}>
            {isEditingName ? 'Done' : 'Edit'}
          </Text>
        </Pressable>
      </View>

      <View
        accessibilityLabel="Profile activity"
        style={[
          styles.statsGrid,
          { borderBottomColor: palette.border, borderTopColor: palette.border },
        ]}>
        {stats.map((stat, index) => (
          <View
            key={stat.label}
            style={[
              styles.statCell,
              index > 0 ? { borderLeftColor: palette.border, borderLeftWidth: 1 } : null,
            ]}>
            <Text style={[styles.statValue, { color: palette.text }]}>{stat.value}</Text>
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
            Your profile
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

          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            maxLength={PROFILE_MAJOR_MAX_LENGTH}
            onChangeText={setMajor}
            placeholder="Major (e.g. Computer Science)"
            placeholderTextColor={placeholderColor}
            style={[styles.input, inputColors]}
            value={major}
          />

          {/* Year — tap to select, tap again to clear (the field is optional). */}
          <View style={styles.yearRow}>
            {USER_YEARS.map((yearOption) => {
              const selected = year === yearOption;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  disabled={isSaving}
                  key={yearOption}
                  onPress={() => setYear(selected ? null : yearOption)}
                  style={({ pressed }) => [
                    styles.yearChip,
                    {
                      backgroundColor: selected ? palette.tint : palette.surfaceMuted,
                      borderColor: selected ? palette.tint : palette.border,
                      opacity: isSaving || pressed ? 0.7 : 1,
                    },
                  ]}>
                  <Text
                    style={[
                      TypeScale.label,
                      { color: selected ? '#FFFFFF' : palette.text },
                    ]}>
                    {yearOption}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            autoCapitalize="none"
            editable={!isSaving}
            maxLength={PROFILE_PRONOUNS_MAX_LENGTH}
            onChangeText={setPronouns}
            placeholder="Pronouns (e.g. she/her)"
            placeholderTextColor={placeholderColor}
            style={[styles.input, inputColors]}
            value={pronouns}
          />

          <View>
            <TextInput
              editable={!isSaving}
              maxLength={PROFILE_BIO_MAX_LENGTH}
              multiline
              onChangeText={setBio}
              placeholder="Short bio — what are you studying toward?"
              placeholderTextColor={placeholderColor}
              style={[styles.input, styles.bioInput, inputColors]}
              value={bio}
            />
            <Text style={[TypeScale.caption, styles.bioCounter, { color: palette.icon }]}>
              {bio.length}/{PROFILE_BIO_MAX_LENGTH}
            </Text>
          </View>

          <Button
            label="Save profile"
            variant="secondary"
            fullWidth
            loading={isSaving}
            onPress={handleSaveProfile}
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
          <View style={[styles.rowList, { borderTopColor: palette.border }]}>
            {classes.map((classCode) => (
              <View
                key={classCode}
                style={[styles.classRow, { borderBottomColor: palette.border }]}>
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

      {/* Top-rated campus locations. */}
      <View style={styles.section}>
        <SectionHeader eyebrow="Top study spots" />
        {savedLocations.length > 0 ? (
          <View style={[styles.rowList, { borderTopColor: palette.border }]}>
            {savedLocations.map((location) => (
              <View
                key={location.name}
                style={[styles.locationRow, { borderBottomColor: palette.border }]}>
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
            Rated study spots will appear here.
          </Text>
        )}
      </View>

      <View
        style={[
          styles.settingsList,
          { borderBottomColor: palette.border, borderTopColor: palette.border },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Study buddies"
          onPress={() => router.push('/friends' as Href)}
          style={({ pressed }) => [
            styles.settingsRow,
            { borderBottomColor: palette.border, opacity: pressed ? 0.55 : 1 },
          ]}>
          <View style={styles.settingsRowBody}>
            <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>Study buddies</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              Friends, requests, and classmates
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={palette.icon} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings' as Href)}
          style={({ pressed }) => [
            styles.settingsRow,
            styles.settingsRowLast,
            { opacity: pressed ? 0.55 : 1 },
          ]}>
          <View style={styles.settingsRowBody}>
            <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>Settings</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              Notifications, privacy, and account
            </Text>
          </View>
          <IconSymbol name="chevron.right" size={18} color={palette.icon} />
        </Pressable>
      </View>
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
    flexDirection: 'row',
    gap: Space.md,
  },
  identityCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  identityName: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 26,
    lineHeight: 31,
    flexShrink: 1,
  },
  bioText: {
    marginTop: Space.xs,
  },
  yearRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  yearChip: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm,
  },
  bioInput: {
    minHeight: 88,
    paddingTop: Space.md,
    textAlignVertical: 'top',
  },
  bioCounter: {
    marginTop: Space.xs,
    textAlign: 'right',
  },
  statsGrid: {
    borderBottomWidth: 1,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  statCell: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.md,
  },
  statValue: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 20,
    lineHeight: 24,
  },
  statLabel: {
    ...TypeScale.caption,
  },
  section: {
    gap: Space.md,
  },
  rowList: {
    borderTopWidth: 1,
  },
  classRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
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
    borderBottomWidth: 1,
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
  settingsList: {
    borderBottomWidth: 1,
    borderTopWidth: 1,
  },
  settingsRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm,
  },
  settingsRowBody: {
    flexShrink: 1,
    gap: 2,
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
});
