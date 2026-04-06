import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getLocations, type StudyLocation } from '@/lib/firestore';

export default function StudyLocationsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
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
      contentContainerStyle={styles.content}>
      <ThemedView
        style={[
          styles.hero,
          { backgroundColor: colorScheme === 'dark' ? '#1f3035' : '#eef7fa' },
        ]}>
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
          { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
        ]}>
        <ThemedText type="subtitle">Status</ThemedText>
        <ThemedText>{status}</ThemedText>
        <Pressable
          onPress={loadLocations}
          style={[
            styles.refreshButton,
            {
              borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
              { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
            ]}>
            <View style={styles.locationHeader}>
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
                      backgroundColor: colorScheme === 'dark' ? '#1b252a' : '#f4fafc',
                      borderColor: colorScheme === 'dark' ? '#35515b' : '#c8dbe2',
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
            { borderColor: colorScheme === 'dark' ? '#2c3b42' : '#d7e8ef' },
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
  locationArea: {
    opacity: 0.75,
  },
  locationHeader: {
    gap: 4,
  },
  notesText: {
    opacity: 0.85,
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
