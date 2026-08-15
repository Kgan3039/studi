import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Timestamp } from 'firebase/firestore';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionCard } from '@/components/session-card';
import { SessionCreatedTransition } from '@/components/session-created-transition';
import { Button } from '@/components/ui/Button';
import {
  CatalogRequestLink,
  CatalogRequestSheet,
} from '@/components/ui/CatalogRequestSheet';
import { CourseChip } from '@/components/ui/CourseChip';
import { FieldLabel, FormSection } from '@/components/ui/FormSection';
import { IconButton } from '@/components/ui/IconButton';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useOverlayEntrance } from '@/components/ui/overlay-motion';
import {
  PullToRefreshIndicator,
  usePullToRefreshDistance,
} from '@/components/ui/PullToRefreshIndicator';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { formatTimeLabel, TimeDropdown } from '@/components/time-dropdown';
import { Brand, Colors, Elevation, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  createSession,
  getLocationRatingAggregates,
  getLocations,
  getSessionById,
  getUserProfile,
  SESSION_CAPACITY_MAX,
  SESSION_CAPACITY_MIN,
  SESSION_CAPACITY_DEFAULT,
  updateSession,
  type LocationRatingAggregate,
  type StudyLocation,
  type StudySessionListItem,
} from '@/lib/firestore';
import { canonicalStudyLocationId } from '@/lib/catalog';
import {
  MAX_DAYS_IN_FUTURE,
  validateSessionSchedule,
} from '@/lib/session-schedule';
import {
  getCreateSessionErrorMessage,
  getEditSessionErrorMessage,
} from '@/lib/session-create-retry';
import type { User } from 'firebase/auth';

const CALENDAR_WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const LOCATION_PREVIEW_COUNT = 4;

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
      inCurrentMonth: cellDate.getMonth() === monthStart.getMonth(),
      isoDate: toIsoDate(cellDate),
      label: cellDate.getDate().toString(),
    };
  });
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function formatDateLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function isPastCalendarDate(isoDate: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsedDate = new Date(`${isoDate}T12:00:00`);
  return parsedDate < today;
}

function isSessionStartInPast(date: string, time: string) {
  return new Date(`${date}T${time}:00`) <= new Date();
}

/** Board CreateTimeScreen quick picks — common evening-leaning start times. */
const TIME_PRESETS = ['14:00', '15:00', '16:30', '18:00', '19:30', '21:00'];

const DURATION_PRESETS = [
  { label: '60 min', minutes: 60 },
  { label: '90 min', minutes: 90 },
  { label: '2 hr', minutes: 120 },
  { label: '3 hr', minutes: 180 },
] as const;

/**
 * Board CreateCapacityScreen seat grid — preset tiles in a 4-column grid.
 * The board shows 2–12; 16 and 20 extend the row to cover the full allowed
 * range (2–20) without a slider.
 */
const CAPACITY_PRESETS = [2, 4, 6, 8, 10, 12, 16, 20];

type SessionEditValues = {
  capacity: number;
  classId: string;
  endTime: string;
  locationId: string;
  sessionDate: string;
  startTime: string;
  title: string;
};

/** "HH:MM" + minutes, or null when it would cross midnight (end must be same-day). */
function addMinutesToTime(time: string, minutes: number): string | null {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  if (Number.isNaN(total) || total >= 24 * 60) {
    return null;
  }
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function toTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function CreateSessionScreen() {
  const router = useRouter();
  const {
    classId: requestedClassId,
    locationId: requestedLocationId,
    sessionId: editSessionId,
  } = useLocalSearchParams<{
    classId?: string;
    locationId?: string;
    sessionId?: string;
  }>();
  const isEditMode = Boolean(editSessionId);
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { onPullScroll, pullDistance } = usePullToRefreshDistance();
  // Presented as a transparentModal route, so it drives its own entrance.
  const { panelStyle, scrimStyle } = useOverlayEntrance(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [ratingAggregates, setRatingAggregates] = useState<Map<string, LocationRatingAggregate>>(
    new Map()
  );
  const [locationQuery, setLocationQuery] = useState('');
  const [requestSheetOpen, setRequestSheetOpen] = useState(false);
  const [showAllLocations, setShowAllLocations] = useState(false);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [capacity, setCapacity] = useState(SESSION_CAPACITY_DEFAULT);
  const [focusText, setFocusText] = useState('');
  const [editingSession, setEditingSession] = useState<StudySessionListItem | null>(null);
  const [initialEditValues, setInitialEditValues] = useState<SessionEditValues | null>(null);
  const editInitializedRef = useRef(false);
  const [createdSession, setCreatedSession] = useState<{
    classId: string;
    locationName: string;
    sessionId: string;
  } | null>(null);
  const [status, setStatus] = useState('Sign in to create a study session.');
  const [scheduleHint, setScheduleHint] = useState(
    `Choose a date between today and the next ${MAX_DAYS_IN_FUTURE} days.`
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const filteredLocations = useMemo(() => {
    const normalizedQuery = locationQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return locations;
    }

    return locations.filter((location) =>
      [
        location.name,
        location.building,
        location.campusArea,
        location.notes,
        ...(Array.isArray(location.tags) ? location.tags : []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [locationQuery, locations]);

  // The full spot list is long enough to bury the rest of the form, so only a
  // few show until the person searches or asks for the rest. A selected spot is
  // always kept visible so it never scrolls out of its own list.
  const visibleLocations = useMemo(() => {
    if (showAllLocations || locationQuery.trim()) {
      return filteredLocations;
    }

    const head = filteredLocations.slice(0, LOCATION_PREVIEW_COUNT);

    if (
      selectedLocationId &&
      !head.some((location) => location.locationId === selectedLocationId)
    ) {
      const selected = filteredLocations.find(
        (location) => location.locationId === selectedLocationId
      );
      if (selected) {
        return [selected, ...head];
      }
    }

    return head;
  }, [filteredLocations, locationQuery, selectedLocationId, showAllLocations]);

  const hiddenLocationCount = filteredLocations.length - visibleLocations.length;
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

  useEffect(() => {
    if (!isEditMode) {
      track('session_create_started', {
        ...(requestedClassId ? { fromClassId: requestedClassId } : {}),
        ...(requestedLocationId ? { fromLocationId: requestedLocationId } : {}),
      });
    }
  }, [isEditMode, requestedClassId, requestedLocationId]);

  const loadSetupData = useCallback(async () => {
    if (!currentUser) {
      setClasses([]);
      setLocations([]);
      setEditingSession(null);
      setInitialEditValues(null);
      editInitializedRef.current = false;
      setStatus('Sign in to create a study session.');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const [profile, loadedLocations, loadedSession] = await Promise.all([
        getUserProfile(currentUser.uid),
        getLocations(),
        editSessionId ? getSessionById(editSessionId) : Promise.resolve(null),
      ]);

      if (editSessionId && (!loadedSession || loadedSession.hostId !== currentUser.uid)) {
        setEditingSession(loadedSession);
        setInitialEditValues(null);
        editInitializedRef.current = false;
        setClasses([]);
        setLocations(loadedLocations);
        setStatus('Only the session host can edit this session.');
        return;
      }

      const sessionClassId = loadedSession?.classId.trim().toUpperCase() ?? '';
      const profileClasses = [
        ...new Set(
          [
            ...(sessionClassId ? [sessionClassId] : []),
            ...(profile?.classes ?? []).map((classCode) => classCode.trim().toUpperCase()),
          ].filter(Boolean)
        ),
      ];
      const sessionLocation = loadedSession?.location;
      const availableLocations =
        sessionLocation &&
        !loadedLocations.some((location) => location.locationId === sessionLocation.locationId)
          ? [sessionLocation, ...loadedLocations]
          : loadedLocations;
      const normalizedRequestedClass = requestedClassId?.trim().toUpperCase() ?? '';
      const defaultClass =
        isEditMode && sessionClassId
          ? sessionClassId
          : normalizedRequestedClass && profileClasses.includes(normalizedRequestedClass)
          ? normalizedRequestedClass
          : profileClasses[0] ?? '';
      // The picker only lists canonical ids, so resolve alias ids (e.g. a
      // deep link carrying `morgridge`) before matching.
      const canonicalRequestedId = requestedLocationId
        ? canonicalStudyLocationId(requestedLocationId)
        : '';
      const defaultLocationId = availableLocations.some(
        (location) => location.locationId === canonicalRequestedId
      )
        ? canonicalRequestedId
        : availableLocations[0]?.locationId ?? '';

      setClasses(profileClasses);
      setLocations(availableLocations);
      if (isEditMode && loadedSession) {
        setEditingSession(loadedSession);
        if (!editInitializedRef.current) {
          const loadedStart = loadedSession.startTime.toDate();
          const loadedEnd = loadedSession.endTime.toDate();
          const editCapacity = loadedSession.capacity ?? Math.min(
            SESSION_CAPACITY_MAX,
            Math.max(
              SESSION_CAPACITY_MIN,
              Math.max(SESSION_CAPACITY_DEFAULT, loadedSession.participantIds.length)
            )
          );
          const editValues = {
            capacity: editCapacity,
            classId: sessionClassId,
            endTime: toTimeInput(loadedEnd),
            locationId: loadedSession.locationId,
            sessionDate: toIsoDate(loadedStart),
            startTime: toTimeInput(loadedStart),
            title: loadedSession.title.trim() || `${sessionClassId} Study Session`,
          } satisfies SessionEditValues;

          setInitialEditValues(editValues);
          setSelectedClass(editValues.classId);
          setSelectedLocationId(editValues.locationId);
          setSessionDate(editValues.sessionDate);
          setSelectedCalendarMonth(startOfMonth(loadedStart));
          setStartTime(editValues.startTime);
          setEndTime(editValues.endTime);
          setCapacity(editValues.capacity);
          setFocusText(editValues.title);
          editInitializedRef.current = true;
        }
        setStatus('');
      } else {
        setEditingSession(null);
        setInitialEditValues(null);
        editInitializedRef.current = false;
        setSelectedClass((currentSelectedClass) =>
          currentSelectedClass && profileClasses.includes(currentSelectedClass)
            ? currentSelectedClass
            : defaultClass
        );
        setSelectedLocationId((currentSelectedLocationId) =>
          currentSelectedLocationId &&
          availableLocations.some((location) => location.locationId === currentSelectedLocationId)
            ? currentSelectedLocationId
            : defaultLocationId
        );
        // Only say something when something is actually wrong.
        setStatus(
          profileClasses.length > 0 && availableLocations.length > 0
            ? ''
            : 'Add classes on your Profile before creating a session.'
        );
      }
    } catch (error) {
      setStatus(
        isEditMode
          ? getEditSessionErrorMessage(error)
          : 'Unable to load session setup right now.'
      );
    } finally {
      setIsLoading(false);
    }

    try {
      const aggregates = await getLocationRatingAggregates();
      setRatingAggregates(aggregates);
    } catch {
      // Ratings unavailable — locations still show
    }
  }, [currentUser, editSessionId, isEditMode, requestedClassId, requestedLocationId]);

  useFocusEffect(
    useCallback(() => {
      loadSetupData();
    }, [loadSetupData])
  );

  async function handleRefresh() {
    if (!currentUser) {
      return;
    }

    setIsRefreshing(true);
    try {
      await loadSetupData();
    } finally {
      setIsRefreshing(false);
    }
  }

  const currentEditValues: SessionEditValues = {
    capacity,
    classId: selectedClass,
    endTime,
    locationId: selectedLocationId,
    sessionDate,
    startTime,
    title: focusText.trim() || `${selectedClass} Study Session`,
  };
  const hasEditChanges =
    !isEditMode ||
    (initialEditValues !== null &&
      (currentEditValues.capacity !== initialEditValues.capacity ||
        currentEditValues.classId !== initialEditValues.classId ||
        currentEditValues.endTime !== initialEditValues.endTime ||
        currentEditValues.locationId !== initialEditValues.locationId ||
        currentEditValues.sessionDate !== initialEditValues.sessionDate ||
        currentEditValues.startTime !== initialEditValues.startTime ||
        currentEditValues.title !== initialEditValues.title));

  async function handleCreateSession() {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before creating a study session.');
      return;
    }

    if (isEditMode && !hasEditChanges) {
      setStatus('No changes to update.');
      return;
    }

    if (!selectedClass || !selectedLocationId || !sessionDate || !startTime || !endTime) {
      Alert.alert('Missing Info', 'Fill out class, location, date, and start/end times.');
      return;
    }

    const scheduleChanged =
      !isEditMode ||
      initialEditValues === null ||
      sessionDate !== initialEditValues.sessionDate ||
      startTime !== initialEditValues.startTime ||
      endTime !== initialEditValues.endTime;
    let startDate: Date;
    let endDate: Date;

    if (scheduleChanged) {
      if (endTime <= startTime) {
        Alert.alert('Time Error', 'Choose an end time later than the start time.');
        return;
      }

      if (isSessionStartInPast(sessionDate, startTime)) {
        Alert.alert('Date Error', 'Choose a future date and start time for your session.');
        return;
      }

      const validatedSchedule = validateSessionSchedule(sessionDate, startTime, endTime);

      if ('error' in validatedSchedule) {
        setScheduleHint(validatedSchedule.error);
        setStatus(validatedSchedule.error);
        Alert.alert('Invalid Session Time', validatedSchedule.error);
        return;
      }

      startDate = new Date(validatedSchedule.startTimeIso);
      endDate = new Date(validatedSchedule.endTimeIso);
    } else if (editingSession) {
      // Unchanged times remain valid for a host editing an in-progress session.
      startDate = editingSession.startTime.toDate();
      endDate = editingSession.endTime.toDate();
    } else {
      setStatus('Unable to load the session to update it.');
      return;
    }

    // "Focus" maps onto the existing title field; default keeps prior behavior.
    const sessionTitle = focusText.trim() || `${selectedClass} Study Session`;

    try {
      setIsSaving(true);
      if (isEditMode && editSessionId) {
        const capacityChanged =
          initialEditValues === null || capacity !== initialEditValues.capacity;
        await updateSession(editSessionId, {
          hostId: currentUser.uid,
          classId: selectedClass,
          locationId: selectedLocationId,
          title: sessionTitle,
          startTime: startDate,
          endTime: endDate,
          ...(editingSession?.capacity === undefined && !capacityChanged ? {} : { capacity }),
        });
        setStatus('Session updated. Everyone going will be notified.');
        router.back();
        return;
      }

      const sessionId = await createSession({
        classId: selectedClass,
        hostId: currentUser.uid,
        locationId: selectedLocationId,
        title: sessionTitle,
        startTime: startDate,
        endTime: endDate,
        capacity,
      });

      track('session_created', {
        classId: selectedClass,
        locationId: selectedLocationId,
        capacity,
        hoursUntilStart: Math.round(
          (startDate.getTime() - Date.now()) / 3_600_000
        ),
      });
      setStatus('Your session is live. Classmates can join now.');
      setCreatedSession({
        classId: selectedClass,
        locationName: selectedLocation?.name ?? 'your study spot',
        sessionId,
      });
    } catch (error) {
      if (isEditMode) {
        const message = getEditSessionErrorMessage(error);
        setStatus(message);
        Alert.alert('Update Session Error', message);
      } else {
        const message = getCreateSessionErrorMessage(error);
        setStatus(message);
        Alert.alert('Create Session Error', message);
      }
    } finally {
      setIsSaving(false);
    }
  }

  // Live preview of the card classmates will see — also doubles as validation.
  const previewSession = useMemo(() => {
    if (!selectedClass || !sessionDate || !startTime || !endTime || endTime <= startTime) {
      return null;
    }

    const start = new Date(`${sessionDate}T${startTime}:00`);
    const end = new Date(`${sessionDate}T${endTime}:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }

    return {
      sessionId: 'preview',
      classId: selectedClass,
      title: focusText.trim() || `${selectedClass} Study Session`,
      startTime: Timestamp.fromDate(start),
      endTime: Timestamp.fromDate(end),
      status: 'open' as const,
      participantIds: currentUser ? [currentUser.uid] : [],
      capacity,
    };
  }, [capacity, currentUser, endTime, focusText, selectedClass, sessionDate, startTime]);

  const selectedLocation = locations.find(
    (location) => location.locationId === selectedLocationId
  );
  const placeholderColor = colorScheme === 'dark' ? '#9F918B' : Brand.charcoal400;
  const handleCreatedTransitionFinish = useCallback(() => {
    if (!createdSession) {
      return;
    }

    router.replace({
      pathname: '/session/[sessionId]',
      params: { sessionId: createdSession.sessionId },
    });
  }, [createdSession, router]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
      <Pressable
        accessibilityLabel="Close"
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
            <Text style={[TypeScale.h2, { color: palette.text }]}>
              {isEditMode ? 'Edit Session' : 'New Session'}
            </Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {isEditMode
                ? 'Update the details classmates will see'
                : 'Classmates can join once you post it'}
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
        onScroll={onPullScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            colors={['transparent']}
            progressBackgroundColor="transparent"
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="transparent"
          />
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Space.lg) },
        ]}>
        {/* The panel header titles this screen and the sections below explain
            themselves, so there's no intro copy here. Only real status — an
            error or a save result — earns a line. */}
        {status ? (
          <Text style={[TypeScale.meta, styles.formStatus, { color: palette.icon }]}>{status}</Text>
        ) : null}

        <ScreenTransition style={styles.transition}>
        <FormSection icon="book.closed" title="Class">
          {isLoading ? (
            <ActivityIndicator color={palette.tint} />
          ) : classes.length > 0 ? (
            <View style={styles.chipRow}>
              {classes.map((classCode) => (
                <CourseChip
                  key={classCode}
                  code={classCode}
                  size="lg"
                  selected={selectedClass === classCode}
                  onPress={() => setSelectedClass(classCode)}
                />
              ))}
            </View>
          ) : (
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              Add classes on your Profile tab first.
            </Text>
          )}
        </FormSection>

        <FormSection icon="mappin.and.ellipse" title="Place">
          <SearchBar
            accessibilityLabel="Search study spots"
            onChangeText={setLocationQuery}
            placeholder="Search spots by name, building, or tag"
            value={locationQuery}
          />
          {isLoading ? (
            <ActivityIndicator color={palette.tint} />
          ) : filteredLocations.length > 0 ? (
            <View style={[styles.locationColumn, { borderTopColor: palette.border }]}>
              {visibleLocations.map((location) => {
                const isSelected = selectedLocationId === location.locationId;
                const aggregate = ratingAggregates.get(location.locationId);

                return (
                  <Pressable
                    key={location.locationId}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setSelectedLocationId(location.locationId)}
                    style={[
                      styles.locationOption,
                      {
                        backgroundColor: palette.surface,
                        borderBottomColor: palette.border,
                        // A leading rule marks the choice without flooding the
                        // row with colour.
                        borderLeftColor: isSelected ? palette.tint : 'transparent',
                        borderLeftWidth: 3,
                      },
                    ]}>
                    <View style={styles.locationText}>
                      <Text style={[TypeScale.label, { color: palette.text }]} numberOfLines={1}>
                        {location.name}
                      </Text>
                      <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                        {location.building}
                        {aggregate ? `, ${aggregate.averageStars} stars` : ''}
                      </Text>
                    </View>
                    {isSelected ? (
                      <IconSymbol color={palette.tint} name="checkmark.circle.fill" size={21} />
                    ) : null}
                  </Pressable>
                );
              })}
              {hiddenLocationCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowAllLocations(true)}
                  style={({ pressed }) => [
                    styles.locationOption,
                    styles.showAllRow,
                    { backgroundColor: palette.surface, opacity: pressed ? 0.6 : 1 },
                  ]}>
                  <Text style={[TypeScale.label, { color: palette.tint }]}>
                    Show {hiddenLocationCount} more{' '}
                    {hiddenLocationCount === 1 ? 'spot' : 'spots'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : locationQuery.trim() ? (
            <View style={styles.noResultsBlock}>
              <Text style={[TypeScale.body, styles.noResultsText, { color: palette.icon }]}>
                No saved study spots match that search yet.
              </Text>
              <CatalogRequestLink
                type="location"
                onPress={() => setRequestSheetOpen(true)}
              />
            </View>
          ) : (
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              No study spots are available right now.
            </Text>
          )}
        </FormSection>

        <FormSection
          icon="calendar"
          title="Date"
          caption={sessionDate ? formatDateLabel(sessionDate) : 'Choose a day'}>
          <View
            style={[
              styles.calendar,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.calendarHeader}>
              <IconButton
                accessibilityLabel="Previous month"
                disabled={!canGoToPreviousMonth}
                icon="chevron.left"
                onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
              />
              <Text style={[TypeScale.label, { color: palette.text }]}>
                {formatMonthLabel(selectedCalendarMonth)}
              </Text>
              <IconButton
                accessibilityLabel="Next month"
                icon="chevron.right"
                onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
              />
            </View>

            <View style={styles.weekdayRow}>
              {CALENDAR_WEEKDAYS.map((weekday) => (
                <Text key={weekday} style={[TypeScale.caption, styles.weekday, { color: palette.icon }]}>
                  {weekday}
                </Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {calendarDays.map((calendarDay) => {
                const isSelected = sessionDate === calendarDay.isoDate;
                const isPast = isPastCalendarDate(calendarDay.isoDate);

                return (
                  <Pressable
                    disabled={isPast}
                    key={calendarDay.isoDate}
                    onPress={() => {
                      setSessionDate(calendarDay.isoDate);
                      setScheduleHint(
                        `Choose a date between today and the next ${MAX_DAYS_IN_FUTURE} days.`
                      );
                    }}
                    style={[
                      styles.dateCell,
                      {
                        backgroundColor: isSelected ? palette.tint : 'transparent',
                        opacity: calendarDay.inCurrentMonth && !isPast ? 1 : 0.34,
                      },
                    ]}>
                    <Text
                      style={[
                        isSelected ? TypeScale.label : TypeScale.body,
                        { color: isSelected ? '#FFFFFF' : palette.text },
                      ]}>
                      {calendarDay.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </FormSection>

        <FormSection
          icon="clock"
          title="Time"
          caption={
            startTime && endTime
              ? `${formatTimeLabel(startTime)}–${formatTimeLabel(endTime)}`
              : 'Pick a start, then how long you’ll be there'
          }>
          <FieldLabel>Starts at</FieldLabel>
          <View style={styles.presetGrid}>
            {TIME_PRESETS.map((presetTime) => {
              const isSelected = startTime === presetTime;
              const isPast = !!sessionDate && isSessionStartInPast(sessionDate, presetTime);

              return (
                <Pressable
                  key={presetTime}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: isPast }}
                  disabled={isPast}
                  onPress={() => {
                    setStartTime(presetTime);
                    setEndTime((currentEndTime) =>
                      currentEndTime && currentEndTime <= presetTime ? '' : currentEndTime
                    );
                  }}
                  style={[
                    styles.presetCell,
                    isSelected
                      ? {
                          backgroundColor:
                            colorScheme === 'dark' ? `${palette.tint}26` : Brand.accentSoft,
                          borderColor: palette.tint,
                        }
                      : {
                          backgroundColor: palette.surface,
                          borderColor: palette.border,
                          opacity: isPast ? 0.4 : 1,
                        },
                  ]}>
                  <Text
                    style={[
                      TypeScale.label,
                      { color: isSelected ? palette.tint : palette.text },
                    ]}>
                    {formatTimeLabel(presetTime)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel>Duration</FieldLabel>
          <View style={styles.durationRow}>
            {DURATION_PRESETS.map((duration) => {
              const computedEnd = startTime
                ? addMinutesToTime(startTime, duration.minutes)
                : null;
              const isSelected = !!computedEnd && endTime === computedEnd;
              const isDisabled = !computedEnd;

              return (
                <Pressable
                  key={duration.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: isDisabled }}
                  disabled={isDisabled}
                  onPress={() => computedEnd && setEndTime(computedEnd)}
                  style={[
                    styles.durationPill,
                    isSelected
                      ? { backgroundColor: palette.tint, borderColor: palette.tint }
                      : {
                          backgroundColor: palette.surface,
                          borderColor: palette.border,
                          opacity: isDisabled ? 0.4 : 1,
                        },
                  ]}>
                  <Text
                    style={[
                      TypeScale.label,
                      { color: isSelected ? '#FFFFFF' : palette.icon },
                    ]}>
                    {duration.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel>Or set exact times</FieldLabel>
          <View style={styles.timeDropdownRow}>
            <View style={styles.flexInput}>
              <TimeDropdown
                label="Start time"
                onChange={(time) => {
                  setStartTime(time);
                  setEndTime((currentEndTime) =>
                    currentEndTime && currentEndTime <= time ? '' : currentEndTime
                  );
                }}
                value={startTime}
              />
            </View>
            <View style={styles.flexInput}>
              <TimeDropdown
                disabledOption={(time) => !!startTime && time <= startTime}
                label="End time"
                onChange={setEndTime}
                value={endTime}
              />
            </View>
          </View>

          <Text style={[TypeScale.caption, { color: palette.icon }]}>{scheduleHint}</Text>
        </FormSection>

        <FormSection
          caption={`Joining closes at ${capacity}. Your seat is counted.`}
          icon="person.2.fill"
          title="Seats">
          <View style={styles.capacityGrid}>
            {CAPACITY_PRESETS.map((seatCount) => {
              const isSelected = capacity === seatCount;
              const isBelowAttendance =
                isEditMode && seatCount < (editingSession?.participantIds.length ?? SESSION_CAPACITY_MIN);

              return (
                <Pressable
                  key={seatCount}
                  accessibilityRole="button"
                  accessibilityLabel={`${seatCount} seats`}
                  accessibilityState={{ selected: isSelected, disabled: isBelowAttendance }}
                  disabled={isBelowAttendance}
                  onPress={() => setCapacity(seatCount)}
                  style={[
                    styles.capacityTile,
                    isSelected
                      ? { backgroundColor: palette.tint, borderColor: palette.tint }
                      : {
                          backgroundColor: palette.surface,
                          borderColor: palette.border,
                          opacity: isBelowAttendance ? 0.4 : 1,
                        },
                  ]}>
                  <Text
                    style={[
                      styles.capacityTileNumber,
                      { color: isSelected ? '#FFFFFF' : palette.text },
                    ]}>
                    {seatCount}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </FormSection>

        <FormSection
          caption={isEditMode ? 'What classmates will see' : 'Optional'}
          icon="square.and.pencil"
          title={isEditMode ? 'Title' : 'Focus'}>
          <TextInput
            maxLength={80}
            onChangeText={setFocusText}
            placeholder={isEditMode ? 'Session title' : 'Pset 4: pipelines and caching'}
            placeholderTextColor={placeholderColor}
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                borderColor: palette.border,
                color: palette.text,
              },
            ]}
            value={focusText}
          />
          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            {isEditMode
              ? 'Update the title shown on the session.'
              : `Leave blank to use “${selectedClass || 'CLASS'} Study Session”.`}
          </Text>
        </FormSection>

        {previewSession ? (
          <FormSection
            caption="What classmates will see"
            icon="eye"
            title="Preview">
            <SessionCard session={previewSession} locationName={selectedLocation?.name} />
          </FormSection>
        ) : null}

        <Button
          label={
            isEditMode
              ? hasEditChanges
                ? 'Save Session'
                : 'No Changes to Update'
              : 'Post Session'
          }
          size="lg"
          fullWidth
          loading={isSaving}
          disabled={isLoading || (isEditMode && !hasEditChanges)}
          onPress={handleCreateSession}
        />
        </ScreenTransition>
      </ScrollView>
      <PullToRefreshIndicator pullDistance={pullDistance} refreshing={isRefreshing} />
      </Animated.View>
      <CatalogRequestSheet
        initialQuery={locationQuery}
        onClose={() => setRequestSheetOpen(false)}
        source="create-session-location"
        type="location"
        visible={requestSheetOpen}
      />
      <SessionCreatedTransition
        classId={createdSession?.classId ?? ''}
        locationName={createdSession?.locationName ?? ''}
        onFinish={handleCreatedTransitionFinish}
        visible={createdSession !== null}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
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
  noResultsBlock: {
    alignItems: 'flex-start',
    gap: Space.xs,
  },
  noResultsText: {
    flexShrink: 1,
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
  transition: {
    gap: Space.xxl,
  },
  question: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 29,
  },
  section: {
    gap: Space.md,
  },
  formStatus: {
    marginBottom: Space.xs,
  },
  showAllRow: {
    borderBottomWidth: 0,
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm + 2,
  },
  calendar: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.md + 2,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Space.sm,
  },
  calendarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateCell: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 40,
    justifyContent: 'center',
    width: `${100 / 7}%`,
  },
  input: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  locationColumn: {
    borderTopWidth: 1,
  },
  locationOption: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    padding: Space.md + 2,
  },
  locationText: {
    flexShrink: 1,
    gap: 2,
  },
  flexInput: {
    flex: 1,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  presetCell: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexBasis: '30%',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  capacityLabelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  capacityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  capacityTile: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    flexBasis: '22%',
    flexGrow: 1,
    justifyContent: 'center',
    // Sized to the number it holds. A square tile leaves a big empty box
    // around a two-character label.
    minHeight: 48,
    paddingVertical: Space.sm,
  },
  capacityTileNumber: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  durationPill: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: Space.lg,
  },
  timeDropdownRow: {
    flexDirection: 'row',
    gap: Space.sm + 2,
  },
  weekday: {
    textAlign: 'center',
    width: `${100 / 7}%`,
  },
  weekdayRow: {
    flexDirection: 'row',
  },
});
