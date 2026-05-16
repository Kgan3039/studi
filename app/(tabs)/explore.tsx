import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { getLocations, type StudyLocation } from '@/lib/firestore';
import type { User } from 'firebase/auth';

export default function StudyLocationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [status, setStatus] = useState('Loading study locations...');
  const [isLoading, setIsLoading] = useState(true);
  const hasLocationSearch = locationQuery.trim().length > 0;
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

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
      setAuthResolved(true);
    });

    return unsubscribe;
  }, []);

  async function loadLocations() {
    try {
      setIsLoading(true);
      const loadedLocations = await getLocations();
      setLocations(loadedLocations);
      setStatus(
        loadedLocations.length > 0
          ? `Loaded ${loadedLocations.length} study location${
              loadedLocations.length === 1 ? '' : 's'
            }.`
          : 'No study locations found yet.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load locations right now.';
      setStatus(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    loadLocations();
  }, [currentUser]);

  useEffect(() => {
    if (authResolved && !currentUser) {
      router.replace('/');
    }
  }, [authResolved, currentUser, router]);

  if (!authResolved || !currentUser) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
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
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Campus spots</ThemedText>
        <ThemedText type="title" style={styles.heroTitle}>
          Study Locations
        </ThemedText>
        <ThemedText style={styles.heroText}>
          Browse places around campus where students can meet, focus, and start study sessions.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Actions</ThemedText>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: palette.surfaceMuted },
            ]}>
            <ThemedText type="defaultSemiBold">{locations.length} loaded</ThemedText>
          </View>
        </View>
        <ThemedText type="subtitle">Find your next study spot</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>
        <TextInput
          autoCapitalize="words"
          onChangeText={setLocationQuery}
          placeholder="Search by library, building, area, or tag"
          placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
          style={[styles.input, { borderColor: palette.outline, color: palette.text }]}
          value={locationQuery}
        />
        {hasLocationSearch ? (
          <View style={styles.searchResults}>
            <ThemedText style={styles.searchHint}>
              {filteredLocations.length > 0
                ? `${filteredLocations.length} matching study spot${
                    filteredLocations.length === 1 ? '' : 's'
                  }`
                : 'No matching study spots yet'}
            </ThemedText>
            {filteredLocations.slice(0, 4).map((location) => (
              <Pressable
                key={`suggestion-${location.locationId}`}
                onPress={() => setLocationQuery(location.name)}
                style={[
                  styles.searchSuggestion,
                  {
                    backgroundColor: palette.surfaceMuted,
                    borderColor: palette.outline,
                  },
                ]}>
                <View style={styles.searchSuggestionText}>
                  <ThemedText type="defaultSemiBold">{location.name}</ThemedText>
                  <ThemedText style={styles.locationArea}>
                    {location.building} • {location.campusArea}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Pressable
          onPress={() => router.push('/sessions')}
          style={[
            styles.secondaryButton,
            {
              borderColor: palette.outline,
            },
          ]}>
          <ThemedText type="defaultSemiBold">Browse Available Sessions</ThemedText>
        </Pressable>
        <View style={styles.actionColumn}>
          <Pressable
            onPress={() => router.push('/create-session')}
            style={[styles.createButton, { backgroundColor: palette.tint }]}>
            <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
              Create a Study Session
            </ThemedText>
          </Pressable>
        </View>
        <Pressable
          onPress={loadLocations}
          style={[
            styles.refreshButton,
            {
              borderColor: palette.outline,
              opacity: isLoading ? 0.6 : 1,
            },
          ]}>
          {isLoading ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <ThemedText type="defaultSemiBold">Refresh Locations</ThemedText>
          )}
        </Pressable>
      </ThemedView>

      {filteredLocations.length > 0 ? (
        filteredLocations.map((location) => (
          <ThemedView
            key={location.locationId}
            style={[
              styles.card,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}>
            <View style={styles.locationHeader}>
              <ThemedText style={styles.cardLabel}>Study Spot</ThemedText>
              <ThemedText type="subtitle">{location.name}</ThemedText>
              <ThemedText style={styles.locationArea}>{location.campusArea}</ThemedText>
            </View>

            <ThemedText>{location.building}</ThemedText>
            <ThemedText style={styles.notesText}>{location.notes}</ThemedText>

            <View style={styles.tagRow}>
              {(Array.isArray(location.tags) ? location.tags : []).map((tag) => (
                <ThemedView
                  key={`${location.locationId}-${tag}`}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: palette.surfaceMuted,
                      borderColor: palette.outline,
                    },
                  ]}>
                  <ThemedText type="defaultSemiBold">{tag}</ThemedText>
                </ThemedView>
              ))}
            </View>
          </ThemedView>
        ))
      ) : hasLocationSearch ? (
        <ThemedView
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <ThemedText type="subtitle">No spots match that search</ThemedText>
          <ThemedText>
            Try a building name, campus area, or search terms like `quiet`, `late-night`, or
            `group`.
          </ThemedText>
        </ThemedView>
      ) : (
        <ThemedView
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <ThemedText type="subtitle">No study spots available right now</ThemedText>
          <ThemedText>
            Studi could not load any official or saved study locations yet. Refresh once more or
            check your Firestore connection.
          </ThemedText>
        </ThemedView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
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
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  createButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
  actionColumn: {
    gap: 10,
  },
  cardLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.65,
    textTransform: 'uppercase',
  },
  locationArea: {
    opacity: 0.75,
  },
  locationHeader: {
    gap: 4,
  },
  notesText: {
    opacity: 0.85,
  },
  statusText: {
    opacity: 0.82,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  searchHint: {
    fontSize: 14,
    opacity: 0.7,
  },
  searchResults: {
    gap: 8,
  },
  searchSuggestion: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  searchSuggestionText: {
    gap: 2,
  },
  tag: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
