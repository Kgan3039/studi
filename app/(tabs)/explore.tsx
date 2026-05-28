import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import {
  getAtmosphereFiltersForLocationTags,
  LOCATION_ATMOSPHERE_FILTERS,
  type LocationAtmosphereFilter,
} from '@/data/location-rating-options';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getLocationRatingAggregates,
  getLocations,
  type LocationRatingAggregate,
  type StudyLocation,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

export default function StudyLocationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [ratingAggregates, setRatingAggregates] = useState<Map<string, LocationRatingAggregate>>(
    new Map()
  );
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [selectedCampusArea, setSelectedCampusArea] = useState<string | null>(null);
  const [selectedAtmosphere, setSelectedAtmosphere] = useState<LocationAtmosphereFilter | null>(
    null
  );
  const [status, setStatus] = useState('Loading study locations...');
  const [isLoading, setIsLoading] = useState(true);
  const hasLocationSearch = locationQuery.trim().length > 0;
  const hasActiveFilters =
    hasLocationSearch || selectedCampusArea !== null || selectedAtmosphere !== null;
  const campusAreas = useMemo(
    () => [...new Set(locations.map((location) => location.campusArea))].sort(),
    [locations]
  );
  const filteredLocations = useMemo(() => {
    const normalizedQuery = locationQuery.trim().toLowerCase();

    return locations.filter((location) => {
      const aggregate = ratingAggregates.get(location.locationId);
      const descriptorText = [
        location.notes,
        ...(Array.isArray(location.tags) ? location.tags : []),
        ...(aggregate?.reviewTags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      const searchText = [
        location.name,
        location.building,
        location.campusArea,
        descriptorText,
      ]
        .join(' ')
        .toLowerCase();
      const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery);
      const matchesArea = !selectedCampusArea || location.campusArea === selectedCampusArea;
      const atmosphereFilters = getAtmosphereFiltersForLocationTags([
        ...(Array.isArray(location.tags) ? location.tags : []),
        ...(aggregate?.reviewTags ?? []),
      ]);
      const matchesAtmosphere =
        !selectedAtmosphere || atmosphereFilters.has(selectedAtmosphere);

      return matchesQuery && matchesArea && matchesAtmosphere;
    });
  }, [locationQuery, locations, ratingAggregates, selectedAtmosphere, selectedCampusArea]);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
      setAuthResolved(true);
    });

    return unsubscribe;
  }, []);

  const loadLocations = useCallback(async () => {
    try {
      setIsLoading(true);
      const loadedLocations = await getLocations();
      setLocations(loadedLocations);
      const suffix = loadedLocations.length === 1 ? '' : 's';
      setStatus(
        loadedLocations.length > 0
          ? `Loaded ${loadedLocations.length} study location${suffix}.`
          : 'No study locations found yet.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load locations right now.';
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (currentUser) {
        loadLocations();
      }
    }, [currentUser, loadLocations])
  );

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
        <View style={styles.filters}>
          <View style={styles.filterHeader}>
            <ThemedText style={styles.filterLabel}>Area</ThemedText>
            {hasActiveFilters ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLocationQuery('');
                  setSelectedCampusArea(null);
                  setSelectedAtmosphere(null);
                }}>
                <ThemedText style={[styles.clearFilters, { color: palette.tint }]}>
                  Clear all
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.filterChipRow}>
            {[null, ...campusAreas].map((campusArea) => {
              const isSelected = selectedCampusArea === campusArea;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  key={campusArea ?? 'all-areas'}
                  onPress={() => setSelectedCampusArea(campusArea)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                      borderColor: isSelected ? palette.tint : palette.outline,
                    },
                  ]}>
                  <ThemedText
                    lightColor={isSelected ? '#ffffff' : undefined}
                    darkColor={isSelected ? '#ffffff' : undefined}
                    type="defaultSemiBold">
                    {campusArea ?? 'All areas'}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText style={styles.filterLabel}>Atmosphere</ThemedText>
          <View style={styles.filterChipRow}>
            {LOCATION_ATMOSPHERE_FILTERS.map((atmosphere) => {
              const isSelected = selectedAtmosphere === atmosphere;

              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  key={atmosphere}
                  onPress={() =>
                    setSelectedAtmosphere((currentAtmosphere) =>
                      currentAtmosphere === atmosphere ? null : atmosphere
                    )
                  }
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                      borderColor: isSelected ? palette.tint : palette.outline,
                    },
                  ]}>
                  <ThemedText
                    lightColor={isSelected ? '#ffffff' : undefined}
                    darkColor={isSelected ? '#ffffff' : undefined}
                    type="defaultSemiBold">
                    {atmosphere}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText style={styles.filterHint}>
            Atmosphere filters use location tags and tags students add in reviews.
          </ThemedText>
        </View>
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

      {locations.length > 0 ? (
        <ThemedView
          style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionLabel}>All Locations</ThemedText>
            <View style={[styles.statusPill, { backgroundColor: palette.surfaceMuted }]}>
              <ThemedText type="defaultSemiBold">{filteredLocations.length} spots</ThemedText>
            </View>
          </View>

          {filteredLocations.length === 0 ? (
            <View style={styles.emptySearch}>
              <ThemedText type="subtitle">No spots match those filters</ThemedText>
              <ThemedText style={styles.notesText}>
                Try another area or atmosphere, or clear all filters.
              </ThemedText>
            </View>
          ) : (
            filteredLocations.map((location, index) => {
              const isExpanded = expandedLocationId === location.locationId;
              const agg = ratingAggregates.get(location.locationId);
              return (
                <View key={location.locationId}>
                  {index > 0 && (
                    <View style={[styles.divider, { backgroundColor: palette.border }]} />
                  )}
                  <Pressable
                    onPress={() =>
                      setExpandedLocationId(isExpanded ? null : location.locationId)
                    }
                    style={styles.accordionHeader}>
                    <View style={styles.accordionHeaderLeft}>
                      <ThemedText type="defaultSemiBold">{location.name}</ThemedText>
                      <View style={styles.locationMetaRow}>
                        <ThemedText style={styles.locationArea}>{location.campusArea}</ThemedText>
                        {agg ? (
                          <ThemedText style={styles.locationRatingPreview}>
                            ★ {agg.averageStars} ({agg.totalRatings})
                          </ThemedText>
                        ) : null}
                      </View>
                    </View>
                    <ThemedText style={[styles.chevron, { color: palette.tint }]}>
                      {isExpanded ? '▲' : '▼'}
                    </ThemedText>
                  </Pressable>

                  {isExpanded && (
                    <View style={styles.accordionContent}>
                      <ThemedText style={styles.notesText}>{location.notes}</ThemedText>

                      {agg ? (
                        <View style={styles.ratingRow}>
                          <View style={styles.starRow}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <ThemedText
                                key={star}
                                style={{
                                  color:
                                    star <= Math.round(agg.averageStars)
                                      ? '#F5A623'
                                      : palette.outline,
                                  fontSize: 18,
                                  lineHeight: 24,
                                }}>
                                ★
                              </ThemedText>
                            ))}
                          </View>
                          <ThemedText type="defaultSemiBold">{agg.averageStars}</ThemedText>
                          <ThemedText style={styles.ratingCount}>
                            ({agg.totalRatings})
                          </ThemedText>
                        </View>
                      ) : (
                        <ThemedText style={styles.ratingEmpty}>
                          No ratings yet — be the first!
                        </ThemedText>
                      )}

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

                      {agg && agg.topTags.length > 0 && (
                        <View style={styles.communityTagsSection}>
                          <ThemedText style={styles.communityTagsLabel}>
                            Student tags
                          </ThemedText>
                          <View style={styles.tagRow}>
                            {agg.topTags.map((tag) => (
                              <ThemedView
                                key={`${location.locationId}-community-${tag}`}
                                style={[
                                  styles.tag,
                                  {
                                    backgroundColor: palette.badge,
                                    borderColor: palette.outline,
                                  },
                                ]}>
                                <ThemedText type="defaultSemiBold">{tag}</ThemedText>
                              </ThemedView>
                            ))}
                          </View>
                        </View>
                      )}

                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/rate-location',
                            params: {
                              locationId: location.locationId,
                              locationName: location.name,
                            },
                          })
                        }
                        style={[styles.rateButton, { borderColor: palette.outline }]}>
                        <ThemedText type="defaultSemiBold">Rate This Spot</ThemedText>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ThemedView>
      ) : !isLoading ? (
        <ThemedView
          style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ThemedText type="subtitle">No study spots available right now</ThemedText>
          <ThemedText>
            Studi could not load any official or saved study locations. Refresh once more or check
            your Firestore connection.
          </ThemedText>
        </ThemedView>
      ) : null}
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
  locationArea: {
    fontSize: 13,
    opacity: 0.65,
  },
  notesText: {
    opacity: 0.85,
  },
  accordionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  accordionHeaderLeft: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  chevron: {
    fontSize: 12,
  },
  accordionContent: {
    gap: 12,
    paddingBottom: 14,
  },
  divider: {
    height: 1,
  },
  emptySearch: {
    gap: 8,
    paddingVertical: 8,
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
  filters: {
    gap: 10,
    paddingTop: 4,
  },
  filterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  filterLabel: {
    fontSize: 12,
    letterSpacing: 0.8,
    opacity: 0.65,
    textTransform: 'uppercase',
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterHint: {
    fontSize: 13,
    opacity: 0.66,
  },
  clearFilters: {
    fontSize: 13,
    fontWeight: '600',
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
  locationMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  locationRatingPreview: {
    color: '#D98700',
    fontSize: 13,
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
  ratingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },
  ratingCount: {
    opacity: 0.65,
  },
  ratingEmpty: {
    opacity: 0.6,
  },
  communityTagsSection: {
    gap: 8,
  },
  communityTagsLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    opacity: 0.6,
    textTransform: 'uppercase',
  },
  rateButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
});
