import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

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
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [title, setTitle] = useState('');
  const [sessionDate, setSessionDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [status, setStatus] = useState('Sign in to create a study session.');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
        setClasses(profileClasses);
        setLocations(loadedLocations);
        setSelectedClass(profileClasses[0] ?? '');
        setSelectedLocationId(loadedLocations[0]?.locationId ?? '');
        setStatus(
          profileClasses.length > 0 && loadedLocations.length > 0
            ? 'Pick a class, location, and time to create a session.'
            : 'Add classes on Home and seed locations before creating sessions.'
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
  }, [currentUser]);

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
      contentContainerStyle={styles.content}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: colorScheme === 'dark' ? '#1f3035' : '#eef7fa' },
        ]}>
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
          { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
        ]}>
        <ThemedText type="subtitle">Session Status</ThemedText>
        <ThemedText>{status}</ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
        ]}>
        <ThemedText type="subtitle">Choose a Class</ThemedText>
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
                        : colorScheme === 'dark'
                          ? '#1b252a'
                          : '#f4fafc',
                      borderColor: isSelected
                        ? palette.tint
                        : colorScheme === 'dark'
                          ? '#35515b'
                          : '#c8dbe2',
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
          <ThemedText>Add classes on the Home tab first.</ThemedText>
        )}
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
        ]}>
        <ThemedText type="subtitle">Choose a Location</ThemedText>
        {isLoading ? (
          <ActivityIndicator color={palette.text} />
        ) : locations.length > 0 ? (
          <View style={styles.locationColumn}>
            {locations.map((location) => {
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
                          ? '#20404a'
                          : '#e6f6fb'
                        : colorScheme === 'dark'
                          ? '#1b252a'
                          : '#ffffff',
                      borderColor: isSelected
                        ? palette.tint
                        : colorScheme === 'dark'
                          ? '#35515b'
                          : '#c8dbe2',
                    },
                  ]}>
                  <ThemedText type="defaultSemiBold">{location.name}</ThemedText>
                  <ThemedText>{location.building}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <ThemedText>Add locations in Firestore first.</ThemedText>
        )}
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
        ]}>
        <ThemedText type="subtitle">Session Details</ThemedText>

        <TextInput
          onChangeText={setTitle}
          placeholder="Session title"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[
            styles.input,
            {
              borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
              borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
                borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
                borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
    gap: 16,
    padding: 20,
  },
  hero: {
    borderRadius: 24,
    padding: 24,
  },
  heroText: {
    maxWidth: 420,
  },
  heroTitle: {
    marginBottom: 12,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
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
