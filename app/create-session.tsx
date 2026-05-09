import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
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
  const [title, setTitle] = useState('');
  const [sessionDate, setSessionDate] = useState('');
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
        ...location.tags,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [locationQuery, locations]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    async function loadSetupData() {
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

        const profileClasses = profile?.classes ?? [];
        const normalizedRequestedClass = requestedClassId?.trim().toUpperCase() ?? '';
        setClasses(profileClasses);
        setLocations(loadedLocations);
        setSelectedClass(
          normalizedRequestedClass && profileClasses.includes(normalizedRequestedClass)
            ? normalizedRequestedClass
            : profileClasses[0] ?? ''
        );
        setSelectedLocationId(loadedLocations[0]?.locationId ?? '');
        setTitle(
          normalizedRequestedClass && profileClasses.includes(normalizedRequestedClass)
            ? `${normalizedRequestedClass} Study Session`
            : ''
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
    }

    loadSetupData();
  }, [currentUser, requestedClassId]);

  async function handleCreateSession() {
    if (!currentUser) {
      Alert.alert('Sign In Required', 'Sign in before creating a study session.');
      return;
    }

    if (!selectedClass || !selectedLocationId || !title.trim() || !sessionDate || !startTime || !endTime) {
      Alert.alert('Missing Info', 'Fill out class, location, title, date, and start/end times.');
      return;
    }

    try {
      setIsSaving(true);
      const sessionId = await createSession({
        classId: selectedClass,
        hostId: currentUser.uid,
        locationId: selectedLocationId,
        title: title.trim(),
        startTime: combineDateAndTime(sessionDate, startTime),
        endTime: combineDateAndTime(sessionDate, endTime),
      });

      setStatus(`Session created successfully. Session ID: ${sessionId}`);
      setTitle('');
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
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
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
        <ThemedText type="subtitle">Session details</ThemedText>

        <TextInput
          onChangeText={setTitle}
          placeholder="Session title"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[
            styles.input,
            {
              borderColor: palette.outline,
              color: palette.text,
            },
          ]}
          value={title}
        />

        <TextInput
          autoCapitalize="none"
          onChangeText={setSessionDate}
          placeholder="Date (YYYY-MM-DD)"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[
            styles.input,
            {
              borderColor: palette.outline,
              color: palette.text,
            },
          ]}
          value={sessionDate}
        />

        <View style={styles.timeRow}>
          <TextInput
            autoCapitalize="none"
            onChangeText={setStartTime}
            placeholder="Start (HH:MM)"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[
              styles.input,
              styles.flexInput,
              {
                borderColor: palette.outline,
                color: palette.text,
              },
            ]}
            value={startTime}
          />

          <TextInput
            autoCapitalize="none"
            onChangeText={setEndTime}
            placeholder="End (HH:MM)"
            placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
            style={[
              styles.input,
              styles.flexInput,
              {
                borderColor: palette.outline,
                color: palette.text,
              },
            ]}
            value={endTime}
          />
        </View>

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
  flexInput: {
    flex: 1,
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
  timeRow: {
    flexDirection: 'row',
    gap: 10,
  },
});
