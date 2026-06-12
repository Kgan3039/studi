import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Brand, Colors, Elevation, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
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
          ? `${loadedLocations.length} study spot${suffix} around campus`
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

  // Board LocationsScreen: active filter pill is solid accent with white text.
  const filterChipColors = (isSelected: boolean) => ({
    backgroundColor: isSelected ? palette.tint : palette.surface,
    borderColor: palette.border,
    borderWidth: isSelected ? 0 : StyleSheet.hairlineWidth * 2,
  });
  const filterChipTextColor = (isSelected: boolean) => (isSelected ? '#FFFFFF' : palette.icon);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <View style={styles.header}>
        <Text style={[TypeScale.title, { color: palette.text }]}>Study spots</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{status}</Text>
      </View>

      <View style={styles.searchSection}>
        <TextInput
          autoCapitalize="words"
          onChangeText={setLocationQuery}
          placeholder="Search by library, building, area, or tag"
          placeholderTextColor={colorScheme === 'dark' ? '#9F918B' : Brand.charcoal400}
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
        <View style={styles.filters}>
          <View style={styles.filterHeader}>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>Area</Text>
            {hasActiveFilters ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLocationQuery('');
                  setSelectedCampusArea(null);
                  setSelectedAtmosphere(null);
                }}>
                <Text style={[TypeScale.label, { color: palette.tint }]}>Clear all</Text>
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
                  style={[styles.filterChip, filterChipColors(isSelected)]}>
                  <Text style={[TypeScale.label, { color: filterChipTextColor(isSelected) }]}>
                    {campusArea ?? 'All areas'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[TypeScale.caption, { color: palette.icon }]}>Atmosphere</Text>
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
                  style={[styles.filterChip, filterChipColors(isSelected)]}>
                  <Text style={[TypeScale.label, { color: filterChipTextColor(isSelected) }]}>
                    {atmosphere}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {locations.length > 0 ? (
        <View style={styles.locationList}>
          {filteredLocations.length === 0 ? (
            <View
              style={[
                styles.card,
                { backgroundColor: palette.surface, borderColor: palette.border },
              ]}>
              <Text style={[TypeScale.heading, { color: palette.text }]}>
                No spots match those filters
              </Text>
              <Text style={[TypeScale.body, { color: palette.icon }]}>
                Try another area or atmosphere, or clear all filters.
              </Text>
            </View>
          ) : (
            filteredLocations.map((location) => {
              const isExpanded = expandedLocationId === location.locationId;
              const agg = ratingAggregates.get(location.locationId);
              return (
                <View
                  key={location.locationId}
                  style={[
                    styles.card,
                    Elevation.e1,
                    { backgroundColor: palette.surface, borderColor: palette.border },
                  ]}>
                  <Pressable
                    onPress={() =>
                      setExpandedLocationId(isExpanded ? null : location.locationId)
                    }
                    style={styles.accordionHeader}>
                    <View style={styles.accordionHeaderLeft}>
                      <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>
                        {location.name}
                      </Text>
                      <Text style={[TypeScale.caption, { color: palette.icon }]}>
                        {location.building} · {location.campusArea}
                      </Text>
                    </View>
                    <View style={styles.accordionHeaderRight}>
                      {agg ? (
                        <Text style={[TypeScale.meta, { color: palette.icon }]}>
                          ★ {agg.averageStars}
                        </Text>
                      ) : null}
                      <Text style={[styles.chevron, { color: palette.tint }]}>
                        {isExpanded ? '▲' : '▼'}
                      </Text>
                    </View>
                  </Pressable>

                  {isExpanded && (
                    <View style={styles.accordionContent}>
                      <Text style={[TypeScale.body, { color: palette.icon }]}>
                        {location.notes}
                      </Text>

                      {agg ? (
                        <View style={styles.ratingRow}>
                          <View style={styles.starRow}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Text
                                key={star}
                                style={{
                                  color:
                                    star <= Math.round(agg.averageStars)
                                      ? Brand.sunflower400
                                      : palette.outline,
                                  fontSize: 18,
                                  lineHeight: 24,
                                }}>
                                ★
                              </Text>
                            ))}
                          </View>
                          <Text style={[TypeScale.label, { color: palette.text }]}>
                            {agg.averageStars}
                          </Text>
                          <Text style={[TypeScale.caption, { color: palette.icon }]}>
                            ({agg.totalRatings})
                          </Text>
                        </View>
                      ) : (
                        <Text style={[TypeScale.caption, { color: palette.icon }]}>
                          No ratings yet — be the first.
                        </Text>
                      )}

                      <View style={styles.tagRow}>
                        {location.tags.map((tag) => (
                          <View
                            key={`${location.locationId}-${tag}`}
                            style={[styles.tag, { backgroundColor: palette.surfaceMuted }]}>
                            <Text style={[TypeScale.label, { color: palette.text }]}>{tag}</Text>
                          </View>
                        ))}
                      </View>

                      {agg && agg.topTags.length > 0 && (
                        <View style={styles.communityTagsSection}>
                          <Text style={[TypeScale.caption, { color: palette.icon }]}>
                            Student tags
                          </Text>
                          <View style={styles.tagRow}>
                            {agg.topTags.map((tag) => (
                              <View
                                key={`${location.locationId}-community-${tag}`}
                                style={[
                                  styles.tag,
                                  { backgroundColor: `${Brand.sunflower400}1A` },
                                ]}>
                                <Text
                                  style={[
                                    TypeScale.label,
                                    { color: colorScheme === 'dark' ? '#F0C36A' : '#A87514' },
                                  ]}>
                                  {tag}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      )}

                      <Button
                        label="Rate this spot"
                        variant="secondary"
                        size="sm"
                        onPress={() =>
                          router.push({
                            pathname: '/rate-location',
                            params: {
                              locationId: location.locationId,
                              locationName: location.name,
                            },
                          })
                        }
                      />
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>
      ) : !isLoading ? (
        <View
          style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[TypeScale.heading, { color: palette.text }]}>
            Can’t reach the library
          </Text>
          <Text style={[TypeScale.body, { color: palette.icon }]}>
            Studi could not load any study locations. Check your connection and try again.
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label="Browse sessions" fullWidth onPress={() => router.push('/sessions')} />
        <Button
          label="Refresh spots"
          variant="secondary"
          fullWidth
          loading={isLoading}
          onPress={loadLocations}
        />
      </View>
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
    gap: Space.lg,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  header: {
    gap: Space.xs,
  },
  searchSection: {
    gap: Space.md,
  },
  card: {
    borderRadius: Radius.card,
    borderTopRightRadius: Radius.accentCorner,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.sm,
    padding: Space.lg + 4,
  },
  input: {
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontFamily: FontFamily.body,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: Space.lg,
  },
  filters: {
    gap: Space.sm + 2,
  },
  filterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  filterChip: {
    borderRadius: Radius.pill,
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs + 2,
  },
  locationList: {
    gap: Space.md,
  },
  accordionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  accordionHeaderLeft: {
    flex: 1,
    gap: 2,
    paddingRight: Space.md,
  },
  accordionHeaderRight: {
    alignItems: 'flex-end',
    gap: Space.xs,
  },
  chevron: {
    fontSize: 12,
  },
  accordionContent: {
    gap: Space.md,
    paddingTop: Space.md,
  },
  tag: {
    borderRadius: Radius.pill,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs + 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  ratingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.xs + 2,
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },
  communityTagsSection: {
    gap: Space.sm,
  },
  actions: {
    gap: Space.sm + 2,
  },
});
