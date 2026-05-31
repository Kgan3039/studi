import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TimeDropdown } from '@/components/time-dropdown';
import { STUDI_SUPPORT_EMAIL } from '@/constants/app-info';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteCurrentUserAccount, logOut, subscribeToAuthState } from '@/lib/auth';
import { UW_COURSE_COUNT, searchCourses } from '@/lib/catalog';
import {
  getUserProfile,
  updateUserAvailability,
  updateUserClasses,
  updateUserDisplayName,
  type AvailabilitySlot,
  type Socials,
} from '@/lib/firestore';
import { type Href, useRouter } from 'expo-router';
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

function formatTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mins.toString().padStart(2, '0')} ${period}`;
}

function formatDay(day: string) {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function formatAvailabilitySlot(slot: AvailabilitySlot) {
  if (slot.date) {
    const date = new Date(`${slot.date}T12:00:00`);
    const formattedDate = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    });

    return `${formattedDate} · ${formatTime(slot.startMinutes)}-${formatTime(slot.endMinutes)}`;
  }

  return `${formatDay(slot.day)} ${formatTime(slot.startMinutes)}-${formatTime(slot.endMinutes)}`;
}

function isSameSlot(first: AvailabilitySlot, second: AvailabilitySlot) {
  return (
    (first.date && second.date ? first.date === second.date : first.day === second.day) &&
    first.startMinutes === second.startMinutes &&
    first.endMinutes === second.endMinutes
  );
}

function formatDateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function getAvailabilityDayFromDate(date: string) {
  const day = new Date(`${date}T12:00:00`).getDay();
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][day] ?? 'mon') as AvailabilitySlot['day'];
}

function buildUpcomingDates(days = 21) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const nextDate = new Date(today);
    nextDate.setDate(today.getDate() + index);
    return nextDate.toISOString().slice(0, 10);
  });
}

function parseTimeInput(value: string) {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

const CALENDAR_WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, monthOffset: number) {
  return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildMonthGrid(monthStart: Date) {
  const firstDayOfMonth = startOfMonth(monthStart);
  const gridStart = new Date(firstDayOfMonth);
  gridStart.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + index);

    return {
      date: cellDate,
      inCurrentMonth: cellDate.getMonth() === monthStart.getMonth(),
      isoDate: toIsoDate(cellDate),
    };
  });
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function isPastCalendarDate(isoDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsedDate = new Date(`${isoDate}T12:00:00`);
  return parsedDate < today;
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [socials, setSocials] = useState<Socials>({
    phone: '',
    instagram: '',
    snapchat: '',
    discord: '',
  });
  const [selectedAvailabilityDate, setSelectedAvailabilityDate] = useState(buildUpcomingDates(21)[0]);
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [availabilityStartTime, setAvailabilityStartTime] = useState('');
  const [availabilityEndTime, setAvailabilityEndTime] = useState('');
  const [nameStatus, setNameStatus] = useState('Save your name so Studi looks more personal.');
  const [classesStatus, setClassesStatus] = useState('Update the classes you want to match on.');
  const [availabilityStatus, setAvailabilityStatus] = useState(
    'Choose a day, then add a time block when you are free.'
  );
  const courseResults = useMemo(() => {
    if (courseQuery.trim().length < 2) {
      return [];
    }

    return searchCourses(courseQuery, classes, 14);
  }, [classes, courseQuery]);
  const calendarDays = useMemo(() => buildMonthGrid(selectedCalendarMonth), [selectedCalendarMonth]);
  const canGoToPreviousMonth = useMemo(() => {
    const currentMonthStart = startOfMonth(new Date());
    return selectedCalendarMonth > currentMonthStart;
  }, [selectedCalendarMonth]);

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
        const savedAvailability = profile?.availability ?? [];
        const savedSocials = profile?.socials ?? {
          phone: '',
          instagram: '',
          snapchat: '',
          discord: '',
        };
        setFirstName(savedName.firstName);
        setLastName(savedName.lastName);
        setClasses(savedClasses);
        setAvailability(savedAvailability);
        setSocials(savedSocials);
        setNameStatus(
          profile?.displayName
            ? `Profile name saved as ${profile.displayName}.`
            : 'Add your first and last name to personalize Studi.'
        );
        setClassesStatus(
          savedClasses.length > 0
            ? `You are matching on ${savedClasses.length} class${
                savedClasses.length === 1 ? '' : 'es'
              }.`
            : 'No classes saved yet.'
        );
        setAvailabilityStatus(
          savedAvailability.length > 0
            ? `You have ${savedAvailability.length} saved availability slot${
                savedAvailability.length === 1 ? '' : 's'
              }.`
            : 'No availability saved yet.'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load your profile.';
        setNameStatus(message);
        setClassesStatus(message);
        setAvailabilityStatus(message);
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

  function removeAvailabilitySlot(slot: AvailabilitySlot) {
    setAvailability((currentAvailability) =>
      currentAvailability.filter((savedSlot) => !isSameSlot(savedSlot, slot))
    );
  }

  function handleAddAvailabilitySlot() {
    const startMinutes = parseTimeInput(availabilityStartTime);
    const endMinutes = parseTimeInput(availabilityEndTime);

    if (!selectedAvailabilityDate) {
      setAvailabilityStatus('Choose a date before adding a time slot.');
      Alert.alert('Availability Error', 'Please choose a date first.');
      return;
    }

    if (startMinutes === null || endMinutes === null) {
      setAvailabilityStatus('Choose both a start and end time.');
      Alert.alert('Availability Error', 'Choose both a start and end time.');
      return;
    }

    if (endMinutes <= startMinutes) {
      setAvailabilityStatus('Your availability must end after it starts.');
      Alert.alert('Availability Error', 'End time must be later than start time.');
      return;
    }

    const selectedStart = new Date(`${selectedAvailabilityDate}T00:00:00`);
    selectedStart.setMinutes(startMinutes);
    const selectedEnd = new Date(`${selectedAvailabilityDate}T00:00:00`);
    selectedEnd.setMinutes(endMinutes);
    const now = new Date();

    if (selectedStart <= now) {
      setAvailabilityStatus('Choose a future day/time for your availability.');
      Alert.alert('Availability Error', 'Availability cannot be in the past.');
      return;
    }

    const newSlot: AvailabilitySlot = {
      date: selectedAvailabilityDate,
      day: getAvailabilityDayFromDate(selectedAvailabilityDate),
      startMinutes,
      endMinutes,
    };

    setAvailability((currentAvailability) =>
      currentAvailability.some((savedSlot) => isSameSlot(savedSlot, newSlot))
        ? currentAvailability
        : [...currentAvailability, newSlot].sort((firstSlot, secondSlot) => {
            const firstDate = firstSlot.date ?? '';
            const secondDate = secondSlot.date ?? '';

            if (firstDate !== secondDate) {
              return firstDate.localeCompare(secondDate);
            }

            return firstSlot.startMinutes - secondSlot.startMinutes;
          })
    );
    setAvailabilityStartTime('');
    setAvailabilityEndTime('');
    setAvailabilityStatus(`Added ${formatAvailabilitySlot(newSlot)} to your pending availability.`);
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
      setNameStatus(`Profile name saved as ${displayName}.`);
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
      setClassesStatus(
        classes.length > 0
          ? `You are matching on ${classes.length} class${classes.length === 1 ? '' : 'es'}.`
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

  async function handleSaveAvailability() {
    if (!currentUser) {
      return;
    }

    try {
      setIsSaving(true);
      await updateUserAvailability(currentUser.uid, availability);
      setAvailabilityStatus(
        availability.length > 0
          ? `You have ${availability.length} saved availability slot${
              availability.length === 1 ? '' : 's'
            }.`
          : 'No availability saved yet.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save availability right now.';
      setAvailabilityStatus(message);
      Alert.alert('Availability Error', message);
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
        if (result.method === 'password') {
          setDeleteReauthPassword('');
          setDeleteReauthEmail(result.email);
          setShowDeleteReauthModal(true);
          return;
        }

        Alert.alert(
          'Please Sign In Again',
          'For security, Firebase requires a recent login before deleting this account. Please sign out, sign back in, and try again.'
        );
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

  if (!currentUser && !isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ThemedText type="subtitle">Sign in to view your profile</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.surface }]}>
        <Image
          contentFit="contain"
          source={require('../../assets/images/studi-wordmark.png')}
          style={styles.heroLogo}
        />
        <ThemedText style={[styles.eyebrow, styles.heroEyebrow, { color: palette.tint }]}>
          Your Studi profile
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Keep your name, classes, and availability up to date so matching and sessions stay
          useful.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Account</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.badge }]}>
            <ThemedText type="defaultSemiBold">Signed in</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">{currentUser?.email ?? 'UW account'}</ThemedText>
        <ThemedText style={styles.mutedText}>
          This is the email tied to your Firebase account.
        </ThemedText>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Name</ThemedText>
        </View>
        <ThemedText type="subtitle">How your name appears</ThemedText>
        <ThemedText style={styles.statusCopy}>{nameStatus}</ThemedText>
        <View style={styles.inlineRow}>
          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={firstName}
          />
          <TextInput
            autoCapitalize="words"
            editable={!isSaving}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[styles.input, styles.flexInput, { borderColor: palette.outline, color: palette.text }]}
            value={lastName}
          />
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleSaveName}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText type="defaultSemiBold">Save Name</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Socials</ThemedText>
        </View>

        <ThemedText type="subtitle">Connect your socials</ThemedText>

        <ThemedText style={styles.mutedText}>
          Add your social accounts so people can connect with you outside of Studi.
        </ThemedText>

        <View style={styles.slotList}>
          {socials.phone ? (
            <View
              style={[
                styles.chip,
                styles.wideChip,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.outline,
                },
              ]}>
              <ThemedText type="defaultSemiBold">
                Phone: {socials.phone}
              </ThemedText>
            </View>
          ) : null}

          {socials.instagram ? (
            <View
              style={[
                styles.chip,
                styles.wideChip,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.outline,
                },
              ]}>
              <ThemedText type="defaultSemiBold">
                Instagram: {socials.instagram}
              </ThemedText>
            </View>
          ) : null}

          {socials.snapchat ? (
            <View
              style={[
                styles.chip,
                styles.wideChip,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.outline,
                },
              ]}>
              <ThemedText type="defaultSemiBold">
                Snapchat: {socials.snapchat}
              </ThemedText>
            </View>
          ) : null}

          {socials.discord ? (
            <View
              style={[
                styles.chip,
                styles.wideChip,
                {
                  backgroundColor: palette.surfaceMuted,
                  borderColor: palette.outline,
                },
              ]}>
              <ThemedText type="defaultSemiBold">
                Discord: {socials.discord}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <Pressable
          disabled={isSaving}
          onPress={() => router.push('/socials')}
          style={[
            styles.primaryButton,
            {
              backgroundColor: palette.tint,
              opacity: isSaving ? 0.6 : 1,
            },
          ]}>
          <ThemedText
            lightColor="#ffffff"
            darkColor="#ffffff"
            type="defaultSemiBold">
            Edit
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Classes</ThemedText>
        <ThemedText type="subtitle">Courses you want to match on</ThemedText>
        <ThemedText style={styles.statusCopy}>{classesStatus}</ThemedText>
        <ThemedText style={styles.mutedText}>
          Search across {UW_COURSE_COUNT.toLocaleString()} official UW-Madison courses.
        </ThemedText>
        <TextInput
          autoCapitalize="characters"
          editable={!isSaving}
          onChangeText={setCourseQuery}
          placeholder="Search by course code or title"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[styles.input, { borderColor: palette.outline, color: palette.text }]}
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
                  style={[
                    styles.searchResultCard,
                    {
                      backgroundColor: palette.surfaceMuted,
                      borderColor: palette.outline,
                      opacity: isSaving ? 0.5 : 1,
                    },
                  ]}>
                  <ThemedText type="defaultSemiBold">{course.code}</ThemedText>
                  <ThemedText>{course.title}</ThemedText>
                  <ThemedText style={styles.searchMeta}>
                    {course.subjectName} · {course.credits}
                  </ThemedText>
                </Pressable>
              ))
            ) : (
              <ThemedText style={styles.mutedText}>No courses matched that search yet.</ThemedText>
            )}
          </View>
        ) : (
          <ThemedText style={styles.mutedText}>
            Start typing at least 2 characters to search the course catalog.
          </ThemedText>
        )}
        <View style={styles.chipRow}>
          {classes.map((classCode) => (
            <Pressable
              key={classCode}
              disabled={isSaving}
              onPress={() => toggleClassSelection(classCode)}
              style={[
                styles.chip,
                {
                  backgroundColor: palette.tint,
                  borderColor: palette.tint,
                  opacity: isSaving ? 0.5 : 1,
                },
              ]}>
              <ThemedText
                type="defaultSemiBold"
                lightColor="#ffffff"
                darkColor="#ffffff">
                {classCode} ×
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleSaveClasses}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            Save Classes
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Availability</ThemedText>
        <ThemedText type="subtitle">Choose real days and time blocks</ThemedText>
        <ThemedText style={styles.statusCopy}>{availabilityStatus}</ThemedText>
        <ThemedText style={styles.mutedText}>
          Pick a real day from the calendar, then choose a start and end time.
          Studi will block dates in the past and time slots that have already passed.
        </ThemedText>
        <View style={[styles.calendarCard, { borderColor: palette.outline, backgroundColor: palette.background }]}>
          <View style={styles.calendarHeader}>
            <ThemedText type="subtitle">{formatMonthLabel(selectedCalendarMonth)}</ThemedText>
            <View style={styles.calendarNav}>
              <Pressable
                disabled={!canGoToPreviousMonth || isSaving}
                onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
                style={[
                  styles.calendarNavButton,
                  {
                    borderColor: palette.outline,
                    opacity: !canGoToPreviousMonth || isSaving ? 0.35 : 1,
                  },
                ]}>
                <ThemedText type="defaultSemiBold">‹</ThemedText>
              </Pressable>
              <Pressable
                disabled={isSaving}
                onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
                style={[styles.calendarNavButton, { borderColor: palette.outline, opacity: isSaving ? 0.35 : 1 }]}>
                <ThemedText type="defaultSemiBold">›</ThemedText>
              </Pressable>
            </View>
          </View>

          <View style={styles.calendarWeekRow}>
            {CALENDAR_WEEKDAYS.map((weekday) => (
              <View key={weekday} style={styles.calendarWeekCell}>
                <ThemedText style={styles.calendarWeekday}>{weekday}</ThemedText>
              </View>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarDays.map((dayCell) => {
              const isSelected = selectedAvailabilityDate === dayCell.isoDate;
              const isPast = isPastCalendarDate(dayCell.isoDate);
              const isDisabled = isSaving || isPast;

              return (
                <Pressable
                  key={dayCell.isoDate}
                  disabled={isDisabled}
                  onPress={() => setSelectedAvailabilityDate(dayCell.isoDate)}
                  style={[
                    styles.calendarDay,
                    {
                      backgroundColor: isSelected ? palette.tint : 'transparent',
                      borderColor: isSelected ? palette.tint : 'transparent',
                      opacity: dayCell.inCurrentMonth ? (isPast ? 0.35 : 1) : 0.2,
                    },
                  ]}>
                  <ThemedText
                    type={isSelected ? 'defaultSemiBold' : 'default'}
                    lightColor={isSelected ? '#ffffff' : undefined}
                    darkColor={isSelected ? '#ffffff' : undefined}>
                    {dayCell.date.getDate()}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <ThemedText style={styles.selectedDateText}>
          Selected day: {formatDateLabel(selectedAvailabilityDate)}
        </ThemedText>
        <View style={styles.inlineRow}>
          <View style={styles.flexInput}>
            <TimeDropdown
              disabled={isSaving}
              label="Start time"
              onChange={(time) => {
                setAvailabilityStartTime(time);
                setAvailabilityEndTime((currentEndTime) =>
                  currentEndTime && currentEndTime <= time ? '' : currentEndTime
                );
              }}
              value={availabilityStartTime}
            />
          </View>
          <View style={styles.flexInput}>
            <TimeDropdown
              disabled={isSaving}
              disabledOption={(time) => !!availabilityStartTime && time <= availabilityStartTime}
              label="End time"
              onChange={setAvailabilityEndTime}
              value={availabilityEndTime}
            />
          </View>
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleAddAvailabilitySlot}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText type="defaultSemiBold">Add Time Slot</ThemedText>
        </Pressable>
        <View style={styles.slotList}>
          {availability.length > 0 ? (
            availability.map((slot) => (
              <Pressable
                key={`${slot.date ?? slot.day}-${slot.startMinutes}-${slot.endMinutes}`}
                disabled={isSaving}
                onPress={() => removeAvailabilitySlot(slot)}
                style={[
                  styles.chip,
                  styles.wideChip,
                  {
                    backgroundColor: palette.surfaceMuted,
                    borderColor: palette.outline,
                    opacity: isSaving ? 0.5 : 1,
                  },
                ]}>
                <ThemedText type="defaultSemiBold">{formatAvailabilitySlot(slot)} ×</ThemedText>
              </Pressable>
            ))
          ) : (
            <ThemedText style={styles.mutedText}>No availability slots saved yet.</ThemedText>
          )}
        </View>
        <Pressable
          disabled={isSaving}
          onPress={handleSaveAvailability}
          style={[styles.primaryButton, { backgroundColor: palette.tint, opacity: isSaving ? 0.6 : 1 }]}>
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            Save Availability
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Privacy and support</ThemedText>
        </View>
        <ThemedText type="subtitle">Help, policy, and data requests</ThemedText>
        <ThemedText style={styles.mutedText}>
          Open the privacy policy, contact {STUDI_SUPPORT_EMAIL}, or find account data request
          options before using delete account.
        </ThemedText>
        <Pressable
          disabled={isBusy}
          onPress={() => router.push('/privacy-support' as Href)}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isBusy ? 0.6 : 1 }]}>
          <ThemedText type="defaultSemiBold">Privacy & Support</ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Account actions</ThemedText>
        <ThemedText type="subtitle">Manage your session</ThemedText>
        <Pressable
          disabled={isBusy}
          onPress={handleSignOut}
          style={[styles.secondaryButton, { borderColor: palette.outline, opacity: isBusy ? 0.6 : 1 }] }>
          {isBusy ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <ThemedText type="defaultSemiBold">Sign Out</ThemedText>
          )}
        </Pressable>
        <Pressable
          disabled={isBusy}
          onPress={confirmDeleteAccount}
          style={[
            styles.destructiveButton,
            {
              borderColor: palette.tint,
              opacity: isBusy ? 0.6 : 1,
            },
          ]}>
          {isDeletingAccount ? (
            <ActivityIndicator color={palette.tint} />
          ) : (
            <ThemedText style={[styles.destructiveButtonText, { color: palette.tint }]}>
              Delete Account
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>

      <Modal
        animationType="fade"
        onRequestClose={closeDeleteReauthModal}
        transparent
        visible={showDeleteReauthModal}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <ThemedText type="subtitle">Confirm with Password</ThemedText>
            <ThemedText style={styles.mutedText}>
              For security, please re-enter your password for {deleteReauthEmail || 'your account'}.
            </ThemedText>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isReauthenticatingDelete}
              onChangeText={setDeleteReauthPassword}
              placeholder="Password"
              placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
              secureTextEntry
              style={[styles.input, { borderColor: palette.outline, color: palette.text }]}
              value={deleteReauthPassword}
            />
            <View style={styles.modalActions}>
              <Pressable
                disabled={isReauthenticatingDelete}
                onPress={closeDeleteReauthModal}
                style={[
                  styles.modalButton,
                  { borderColor: palette.outline, opacity: isReauthenticatingDelete ? 0.6 : 1 },
                ]}>
                <ThemedText type="defaultSemiBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                disabled={isReauthenticatingDelete}
                onPress={handleDeleteWithReauthPassword}
                style={[
                  styles.modalButton,
                  { borderColor: palette.tint, opacity: isReauthenticatingDelete ? 0.6 : 1 },
                ]}>
                {isReauthenticatingDelete ? (
                  <ActivityIndicator color={palette.tint} />
                ) : (
                  <ThemedText style={{ color: palette.tint }} type="defaultSemiBold">
                    Delete Account
                  </ThemedText>
                )}
              </Pressable>
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
    padding: 24,
  },
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
    height: 96,
    width: 300,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroEyebrow: {
    textAlign: 'center',
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
  statusCopy: {
    opacity: 0.8,
  },
  mutedText: {
    opacity: 0.8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  wideChip: {
    minHeight: 48,
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
  destructiveButton: {
    alignSelf: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  destructiveButtonText: {
    fontSize: 13,
    letterSpacing: 0.2,
  },
  inlineButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  searchResults: {
    gap: 10,
  },
  searchResultCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  searchMeta: {
    fontSize: 13,
    opacity: 0.7,
  },
  calendarCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  calendarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  calendarNav: {
    flexDirection: 'row',
    gap: 8,
  },
  calendarNavButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  calendarWeekRow: {
    flexDirection: 'row',
  },
  calendarWeekCell: {
    alignItems: 'center',
    flex: 1,
  },
  calendarWeekday: {
    fontSize: 13,
    opacity: 0.65,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  calendarDay: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: '14.2857%',
  },
  selectedDateText: {
    opacity: 0.82,
  },
  slotList: {
    gap: 10,
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
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    maxWidth: 420,
    padding: 18,
    width: '100%',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  modalButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    minWidth: 128,
    paddingHorizontal: 12,
  },
});
