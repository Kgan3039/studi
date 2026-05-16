import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { createSession, getLocations, getUserProfile, type StudyLocation } from '@/lib/firestore';
import type { User } from 'firebase/auth';

function combineDateAndTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

const CALENDAR_WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const TIME_OPTIONS = Array.from({ length: 33 }, (_, index) => {
  const totalMinutes = 7 * 60 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
});

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

function formatTimeLabel(time: string) {
  const [hourValue, minuteValue] = time.split(':').map(Number);
  const period = hourValue >= 12 ? 'PM' : 'AM';
  const displayHour = hourValue % 12 === 0 ? 12 : hourValue % 12;
  return `${displayHour}:${minuteValue.toString().padStart(2, '0')} ${period}`;
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

export default function CreateSessionScreen() {
  const { classId: requestedClassId } = useLocalSearchParams<{ classId?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState(() => startOfMonth(new Date()));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [status, setStatus] = useState('Sign in to create a study session.');
  const [isLoading, setIsLoading] = useState(true);
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
          : loadedLocations[0]?.locationId ?? ''
      );
      setStatus(
        profileClasses.length > 0 && loadedLocations.length > 0
          ? 'Pick a class, location, and time to create a session.'
          : 'Add classes on your Profile and make sure study spots are available before creating sessions.'
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load session setup right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, requestedClassId]);

  useFocusEffect(
    useCallback(() => {
      loadSetupData();
    }, [loadSetupData])
  );

  useEffect(() => {
    loadSetupData();
  }, [loadSetupData]);

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

    try {
      setIsSaving(true);
      const sessionId = await createSession({
        classId: selectedClass,
        hostId: currentUser.uid,
        locationId: selectedLocationId,
        title: `${selectedClass} Study Session`,
        startTime: combineDateAndTime(sessionDate, startTime),
        endTime: combineDateAndTime(sessionDate, endTime),
      });

      setStatus(`Session created successfully. Session ID: ${sessionId}`);
      setSessionDate('');
      setStartTime('');
      setEndTime('');
      Alert.alert('Session Created', `Study session created with ID ${sessionId}.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create the study session right now.';
      setStatus(message);
      Alert.alert('Create Session Error', message);
    } finally {
      setIsSaving(false);
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
          { paddingBottom: insets.bottom + 56, paddingTop: insets.top + 12 },
        ]}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: palette.hero },
        ]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Sessions</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Create Session
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Start a study session your classmates can join by choosing a class, location, and time.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Overview</ThemedText>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: palette.surfaceMuted },
            ]}>
            <ThemedText type="defaultSemiBold">Host a session</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Session status</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <ThemedText style={styles.sectionLabel}>Step 1</ThemedText>
        <ThemedText type="subtitle">Choose a class</ThemedText>
        {isLoading ? (
          <ActivityIndicator color={palette.text} />
        ) : classes.length > 0 ? (
          <View style={styles.chipRow}>
            {classes.map((classCode) => {
              const isSelected = selectedClass === classCode;

              return (
                <Pressable
                  key={classCode}
                  onPress={() => setSelectedClass(classCode)}
                  style={[
                    styles.chip,
                    {
                        backgroundColor: isSelected
                          ? palette.tint
                          : palette.surfaceMuted,
                      borderColor: isSelected
                        ? palette.tint
                          : palette.outline,
                    },
                  ]}>
                  <ThemedText
                    type="defaultSemiBold"
                    lightColor={isSelected ? '#ffffff' : undefined}
                    darkColor={isSelected ? '#ffffff' : undefined}>
                    {classCode}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <ThemedText>Add classes on your Profile tab first.</ThemedText>
        )}
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <ThemedText style={styles.sectionLabel}>Step 2</ThemedText>
        <ThemedText type="subtitle">Choose a location</ThemedText>
        <TextInput
          autoCapitalize="words"
          onChangeText={setLocationQuery}
          placeholder="Search study spots by name, building, area, or tag"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[
            styles.input,
            {
              borderColor: palette.outline,
              color: palette.text,
            },
          ]}
          value={locationQuery}
        />
        {isLoading ? (
          <ActivityIndicator color={palette.text} />
        ) : filteredLocations.length > 0 ? (
          <View style={styles.locationColumn}>
            {filteredLocations.map((location) => {
              const isSelected = selectedLocationId === location.locationId;

              return (
                <Pressable
                  key={location.locationId}
                  onPress={() => setSelectedLocationId(location.locationId)}
                  style={[
                    styles.locationOption,
                    {
                      backgroundColor: isSelected
                        ? colorScheme === 'dark'
                          ? palette.badge
                          : palette.badge
                        : palette.surface,
                      borderColor: isSelected
                        ? palette.tint
                          : palette.outline,
                    },
                  ]}>
                  <ThemedText type="defaultSemiBold">{location.name}</ThemedText>
                  <ThemedText>{location.building}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : locationQuery.trim() ? (
          <ThemedText>No saved study spots match that search yet.</ThemedText>
        ) : (
          <ThemedText>No study spots are available right now.</ThemedText>
        )}
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <ThemedText style={styles.sectionLabel}>Step 3</ThemedText>
        <ThemedText type="subtitle">Pick date and time</ThemedText>
        <ThemedText style={styles.statusText}>
          Studi will name the session from your selected class.
        </ThemedText>

        <View style={[styles.calendar, { borderColor: palette.outline }]}>
          <View style={styles.calendarHeader}>
            <Pressable
              disabled={!canGoToPreviousMonth}
              onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, -1))}
              style={[
                styles.monthButton,
                {
                  borderColor: palette.outline,
                  opacity: canGoToPreviousMonth ? 1 : 0.35,
                },
              ]}>
              <ThemedText type="defaultSemiBold">{'<'}</ThemedText>
            </Pressable>
            <ThemedText type="defaultSemiBold">{formatMonthLabel(selectedCalendarMonth)}</ThemedText>
            <Pressable
              onPress={() => setSelectedCalendarMonth((currentMonth) => addMonths(currentMonth, 1))}
              style={[styles.monthButton, { borderColor: palette.outline }]}>
              <ThemedText type="defaultSemiBold">{'>'}</ThemedText>
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {CALENDAR_WEEKDAYS.map((weekday) => (
              <ThemedText key={weekday} style={styles.weekday}>
                {weekday}
              </ThemedText>
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
                  onPress={() => setSessionDate(calendarDay.isoDate)}
                  style={[
                    styles.dateCell,
                    {
                      backgroundColor: isSelected ? palette.tint : 'transparent',
                      opacity: calendarDay.inCurrentMonth && !isPast ? 1 : 0.34,
                    },
                  ]}>
                  <ThemedText
                    type={isSelected ? 'defaultSemiBold' : 'default'}
                    lightColor={isSelected ? '#ffffff' : undefined}
                    darkColor={isSelected ? '#ffffff' : undefined}>
                    {calendarDay.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <ThemedText type="defaultSemiBold">
          Selected date: {sessionDate ? formatDateLabel(sessionDate) : 'Choose a date'}
        </ThemedText>

        <ThemedText style={styles.sectionLabel}>Start time</ThemedText>
        <View style={styles.timeChipRow}>
          {TIME_OPTIONS.map((time) => {
            const isSelected = startTime === time;

            return (
              <Pressable
                key={`start-${time}`}
                onPress={() => {
                  setStartTime(time);
                  setEndTime((currentEndTime) =>
                    currentEndTime && currentEndTime <= time ? '' : currentEndTime
                  );
                }}
                style={[
                  styles.timeChip,
                  {
                    backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                    borderColor: isSelected ? palette.tint : palette.outline,
                  },
                ]}>
                <ThemedText
                  type="defaultSemiBold"
                  lightColor={isSelected ? '#ffffff' : undefined}
                  darkColor={isSelected ? '#ffffff' : undefined}>
                  {formatTimeLabel(time)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText style={styles.sectionLabel}>End time</ThemedText>
        <View style={styles.timeChipRow}>
          {TIME_OPTIONS.map((time) => {
            const isSelected = endTime === time;
            const isBeforeStart = !!startTime && time <= startTime;

            return (
              <Pressable
                disabled={isBeforeStart}
                key={`end-${time}`}
                onPress={() => setEndTime(time)}
                style={[
                  styles.timeChip,
                  {
                    backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                    borderColor: isSelected ? palette.tint : palette.outline,
                    opacity: isBeforeStart ? 0.35 : 1,
                  },
                ]}>
                <ThemedText
                  type="defaultSemiBold"
                  lightColor={isSelected ? '#ffffff' : undefined}
                  darkColor={isSelected ? '#ffffff' : undefined}>
                  {formatTimeLabel(time)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ThemedText style={styles.statusText}>
          {startTime && endTime
            ? `Selected time: ${formatTimeLabel(startTime)}-${formatTimeLabel(endTime)}`
            : 'Choose a start and end time.'}
        </ThemedText>

        <Pressable
          disabled={isSaving || isLoading}
          onPress={handleCreateSession}
          style={[
            styles.primaryButton,
            { backgroundColor: palette.tint, opacity: isSaving || isLoading ? 0.6 : 1 },
          ]}>
          {isSaving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
              Create Session
            </ThemedText>
          )}
        </Pressable>
      </ThemedView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroText: {
    lineHeight: 30,
    maxWidth: 420,
  },
  heroTitle: {
    marginBottom: 4,
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
  statusText: {
    opacity: 0.82,
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
  calendar: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  calendarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateCell: {
    alignItems: 'center',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: `${100 / 7}%`,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  locationColumn: {
    gap: 10,
  },
  locationOption: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  monthButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  timeChip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  timeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  weekday: {
    opacity: 0.65,
    textAlign: 'center',
    width: `${100 / 7}%`,
  },
  weekdayRow: {
    flexDirection: 'row',
  },
});
