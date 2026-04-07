import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getLocations, type StudyLocation } from '@/lib/firestore';

export default function StudyLocationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [status, setStatus] = useState('Loading study locations...');
  const [isLoading, setIsLoading] = useState(true);

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
    loadLocations();
  }, []);

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

      {locations.length > 0 ? (
        locations.map((location) => (
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
              {location.tags.map((tag) => (
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
      ) : (
        <ThemedView
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <ThemedText type="subtitle">Seed Locations Next</ThemedText>
          <ThemedText>
            Add a few documents in your Firestore `locations` collection, then reload this tab.
          </ThemedText>
          <ThemedText>Suggested IDs: `college-library`, `memorial-library`, `grainger`.</ThemedText>
        </ThemedView>
      )}
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
  refreshButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
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
