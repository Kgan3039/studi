import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Timestamp } from 'firebase/firestore';
import {
  ActivityIndicator,
  Alert,
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
import { Button } from '@/components/ui/Button';
import { CourseChip } from '@/components/ui/CourseChip';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { formatTimeLabel, TimeDropdown } from '@/components/time-dropdown';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import {
  createSession,
  getLocationRatingAggregates,
  getLocations,
  getUserProfile,
  type LocationRatingAggregate,
  type StudyLocation,
} from '@/lib/firestore';
import { canonicalStudyLocationId } from '@/lib/catalog';
import {
  MAX_DAYS_IN_FUTURE,
  validateSessionSchedule,
} from '@/lib/session-schedule';
import type { User } from 'firebase/auth';

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

/** "HH:MM" + minutes, or null when it would cross midnight (end must be same-day). */
function addMinutesToTime(time: string, minutes: number): string | null {
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  if (Number.isNaN(total) || total >= 24 * 60) {
    return null;
  }
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function CreateSessionScreen() {
  const { classId: requestedClassId, locationId: requestedLocationId } = useLocalSearchParams<{
    classId?: string;
    locationId?: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [ratingAggregates, setRatingAggregates] = useState<Map<string, LocationRatingAggregate>>(
    new Map()
  );
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [focusText, setFocusText] = useState('');
  const { toast, show: showToast } = useSuccessToast();
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
    track('session_create_started', {
      ...(requestedClassId ? { fromClassId: requestedClassId } : {}),
      ...(requestedLocationId ? { fromLocationId: requestedLocationId } : {}),
    });
  }, [requestedClassId, requestedLocationId]);

  const loadSetupData = useCallback(async () => {
    if (!currentUser) {
      setClasses([]);
      setLocations([]);
      setStatus('Sign in to create a study session.');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const [profile, loadedLocations] = await Promise.all([
        getUserProfile(currentUser.uid),
        getLocations(),
      ]);

      const profileClasses = [
        ...new Set(
          (profile?.classes ?? [])
            .map((classCode) => classCode.trim().toUpperCase())
            .filter(Boolean)
        ),
      ];
      const normalizedRequestedClass = requestedClassId?.trim().toUpperCase() ?? '';
      const defaultClass =
        normalizedRequestedClass && profileClasses.includes(normalizedRequestedClass)
          ? normalizedRequestedClass
          : profileClasses[0] ?? '';
      // The picker only lists canonical ids, so resolve alias ids (e.g. a
      // deep link carrying `morgridge`) before matching.
      const canonicalRequestedId = requestedLocationId
        ? canonicalStudyLocationId(requestedLocationId)
        : '';
      const defaultLocationId = loadedLocations.some(
        (location) => location.locationId === canonicalRequestedId
      )
        ? canonicalRequestedId
        : loadedLocations[0]?.locationId ?? '';

      setClasses(profileClasses);
      setLocations(loadedLocations);
      setSelectedClass((currentSelectedClass) =>
        currentSelectedClass && profileClasses.includes(currentSelectedClass)
          ? currentSelectedClass
          : defaultClass
      );
      setSelectedLocationId((currentSelectedLocationId) =>
        currentSelectedLocationId &&
        loadedLocations.some((location) => location.locationId === currentSelectedLocationId)
          ? currentSelectedLocationId
          : defaultLocationId
      );
      setStatus(
        profileClasses.length > 0 && loadedLocations.length > 0
          ? 'Pick a class, spot, and time — under 30 seconds.'
          : 'Add classes on your Profile and make sure study spots are available before creating sessions.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load session setup right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }

    try {
      const aggregates = await getLocationRatingAggregates();
      setRatingAggregates(aggregates);
    } catch {
      // Ratings unavailable — locations still show
    }
  }, [currentUser, requestedClassId, requestedLocationId]);

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

  async function handleCreateSession() {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before creating a study session.');
      return;
    }

    if (!selectedClass || !selectedLocationId || !sessionDate || !startTime || !endTime) {
      Alert.alert('Missing Info', 'Fill out class, location, date, and start/end times.');
      return;
    }

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

    // "Focus" maps onto the existing title field; default keeps prior behavior.
    const sessionTitle = focusText.trim() || `${selectedClass} Study Session`;

    try {
      setIsSaving(true);
      await createSession({
        classId: selectedClass,
        hostId: currentUser.uid,
        locationId: selectedLocationId,
        title: sessionTitle,
        startTime: new Date(validatedSchedule.startTimeIso),
        endTime: new Date(validatedSchedule.endTimeIso),
      });

      track('session_created', {
        classId: selectedClass,
        locationId: selectedLocationId,
        hoursUntilStart: Math.round(
          (new Date(validatedSchedule.startTimeIso).getTime() - Date.now()) / 3_600_000
        ),
      });
      setStatus('You’re at the table — classmates can join now.');
      setScheduleHint(`Choose a date between today and the next ${MAX_DAYS_IN_FUTURE} days.`);
      setSessionDate('');
      setStartTime('');
      setEndTime('');
      setFocusText('');
      showToast('Session posted', sessionTitle);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create the study session right now.';
      setStatus(message);
      Alert.alert('Create Session Error', message);
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
    };
  }, [currentUser, endTime, focusText, selectedClass, sessionDate, startTime]);

  const selectedLocation = locations.find(
    (location) => location.locationId === selectedLocationId
  );
  const placeholderColor = colorScheme === 'dark' ? '#9F918B' : Brand.charcoal400;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
        }
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 56, paddingTop: Space.lg },
        ]}>
        <View style={styles.header}>
          <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Host session</Text>
          <Text style={[TypeScale.title, { color: palette.text }]}>New session</Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]}>{status}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.question, { color: palette.text }]}>Which class?</Text>
          {isLoading ? (
            <ActivityIndicator color={palette.tint} />
          ) : classes.length > 0 ? (
            <View style={styles.chipRow}>
              {classes.map((classCode) => (
                <CourseChip
                  key={classCode}
                  code={classCode}
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
        </View>

        <View style={styles.section}>
          <Text style={[styles.question, { color: palette.text }]}>Where are you studying?</Text>
          <TextInput
            autoCapitalize="words"
            autoCorrect={false}
            spellCheck={false}
            onChangeText={setLocationQuery}
            placeholder="Search spots by name, building, or tag"
            placeholderTextColor={placeholderColor}
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceMuted,
                borderColor: palette.border,
                color: palette.text,
              },
            ]}
            value={locationQuery}
          />
          {isLoading ? (
            <ActivityIndicator color={palette.tint} />
          ) : filteredLocations.length > 0 ? (
            <View style={styles.locationColumn}>
              {filteredLocations.map((location) => {
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
                        backgroundColor: isSelected
                          ? colorScheme === 'dark'
                            ? `${palette.tint}26`
                            : Brand.accentSoft
                          : palette.surface,
                        borderColor: isSelected ? palette.tint : palette.border,
                      },
                    ]}>
                    <View style={styles.locationText}>
                      <Text style={[TypeScale.label, { color: palette.text }]} numberOfLines={1}>
                        {location.name}
                      </Text>
                      <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                        {location.building}
                        {aggregate ? `  ·  ★ ${aggregate.averageStars}` : ''}
                      </Text>
                    </View>
                    {isSelected ? (
                      <View style={[styles.seatDot, { backgroundColor: palette.tint }]} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : locationQuery.trim() ? (
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              No saved study spots match that search yet.
            </Text>
          ) : (
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              No study spots are available right now.
            </Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.question, { color: palette.text }]}>When does it start?</Text>

          <View
            style={[
              styles.calendar,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.calendarHeader}>
              <Pressable
                disabled={!canGoToPreviousMonth}
                onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
                style={[
                  styles.monthButton,
                  {
                    borderColor: palette.border,
                    opacity: canGoToPreviousMonth ? 1 : 0.35,
                  },
                ]}>
                <Text style={[TypeScale.label, { color: palette.text }]}>{'<'}</Text>
              </Pressable>
              <Text style={[TypeScale.label, { color: palette.text }]}>
                {formatMonthLabel(selectedCalendarMonth)}
              </Text>
              <Pressable
                onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
                style={[styles.monthButton, { borderColor: palette.border }]}>
                <Text style={[TypeScale.label, { color: palette.text }]}>{'>'}</Text>
              </Pressable>
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

          <Text style={[TypeScale.label, { color: palette.text }]}>
            {sessionDate ? formatDateLabel(sessionDate) : 'Choose a date'}
          </Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]}>{scheduleHint}</Text>

          <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Quick picks</Text>
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

          <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Duration</Text>
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

          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            {startTime && endTime
              ? `Selected time: ${formatTimeLabel(startTime)}–${formatTimeLabel(endTime)}`
              : 'Choose a start and end time.'}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Focus (optional)</Text>
          <TextInput
            onChangeText={setFocusText}
            placeholder="e.g. Pset 4 — pipelines & caching"
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
            Becomes the session title — leave blank for “{selectedClass || 'CLASS'} Study
            Session”.
          </Text>
        </View>

        {previewSession ? (
          <View style={styles.section}>
            <Text style={[styles.question, { color: palette.text }]}>Looks good?</Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              This is exactly how classmates will see it.
            </Text>
            <SessionCard session={previewSession} locationName={selectedLocation?.name} />
          </View>
        ) : null}

        <Button
          label="Post session"
          size="lg"
          fullWidth
          loading={isSaving}
          disabled={isLoading}
          onPress={handleCreateSession}
        />
      </ScrollView>
      <SuccessToast toast={toast} />
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
  question: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 29,
  },
  section: {
    gap: Space.md,
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
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  locationColumn: {
    gap: Space.sm + 2,
  },
  locationOption: {
    alignItems: 'center',
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    padding: Space.md + 2,
  },
  locationText: {
    flexShrink: 1,
    gap: 2,
  },
  seatDot: {
    borderRadius: Radius.pill,
    height: 10,
    width: 10,
  },
  monthButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 40,
    justifyContent: 'center',
    width: 40,
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
  durationPill: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
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
