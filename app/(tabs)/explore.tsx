import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
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
  getUpcomingSessions,
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
  // Board card line "N sessions today" — a real count grouped from the
  // existing getUpcomingSessions read (no new data source / model).
  const [sessionsTodayByLocation, setSessionsTodayByLocation] = useState<Map<string, number>>(
    new Map()
  );
  const [locationQuery, setLocationQuery] = useState('');
  // Board LocationsScreen has a single horizontal pill rail. The earlier
  // two-section Area + Atmosphere filter block collapses to one rail; the
  // atmosphere tags match the board's "Quiet / Coffee / Group rooms" pills.
  // Campus area is no longer a filter but still shows on every card.
  const [selectedAtmosphere, setSelectedAtmosphere] = useState<LocationAtmosphereFilter | null>(
    null
  );
  const [status, setStatus] = useState('Loading study spots...');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
      const searchText = [location.name, location.building, location.campusArea, descriptorText]
        .join(' ')
        .toLowerCase();
      const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery);
      const atmosphereFilters = getAtmosphereFiltersForLocationTags([
        ...(Array.isArray(location.tags) ? location.tags : []),
        ...(aggregate?.reviewTags ?? []),
      ]);
      const matchesAtmosphere = !selectedAtmosphere || atmosphereFilters.has(selectedAtmosphere);

      return matchesQuery && matchesAtmosphere;
    });
  }, [locationQuery, locations, ratingAggregates, selectedAtmosphere]);

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

    try {
      const upcoming = await getUpcomingSessions({ includeInProgress: true });
      const today = new Date().toDateString();
      const counts = new Map<string, number>();
      upcoming.forEach((session) => {
        if (session.startTime.toDate().toDateString() === today) {
          counts.set(session.locationId, (counts.get(session.locationId) ?? 0) + 1);
        }
      });
      setSessionsTodayByLocation(counts);
    } catch {
      // Session counts unavailable — cards still show name/rating/tags
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

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadLocations();
    setIsRefreshing(false);
  }

  if (!authResolved || !currentUser) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  // Board: active rail pill is solid accent with white text.
  const railChipColors = (isSelected: boolean) => ({
    backgroundColor: isSelected ? palette.tint : palette.surface,
    borderColor: palette.border,
    borderWidth: isSelected ? 0 : StyleSheet.hairlineWidth * 2,
  });
  const railChipTextColor = (isSelected: boolean) => (isSelected ? '#FFFFFF' : palette.icon);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={palette.icon}
        />
      }>
      <View style={styles.header}>
        <Text style={[TypeScale.title, { color: palette.text }]}>Study spots</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{status}</Text>
      </View>

      {/* Search is kept (already implemented) but visually subordinate — the
          board's Locations screen leads with the pill rail, not search. */}
      <TextInput
        autoCapitalize="words"
        onChangeText={setLocationQuery}
        placeholder="Search spots"
        placeholderTextColor={colorScheme === 'dark' ? '#9F918B' : Brand.charcoal400}
        style={[styles.search, { backgroundColor: palette.surfaceMuted, color: palette.text }]}
        value={locationQuery}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}>
        {[null, ...LOCATION_ATMOSPHERE_FILTERS].map((atmosphere) => {
          const isSelected = selectedAtmosphere === atmosphere;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={atmosphere ?? 'all-spots'}
              onPress={() => setSelectedAtmosphere(atmosphere)}
              style={[styles.railChip, railChipColors(isSelected)]}>
              <Text style={[TypeScale.label, { color: railChipTextColor(isSelected) }]}>
                {atmosphere ?? 'All'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {locations.length > 0 ? (
        filteredLocations.length === 0 ? (
          <View
            style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[TypeScale.heading, { color: palette.text }]}>
              No spots match those filters
            </Text>
            <Text style={[TypeScale.body, { color: palette.icon }]}>
              Try another atmosphere, or clear the search.
            </Text>
          </View>
        ) : (
          <View style={styles.locationList}>
            {filteredLocations.map((location) => {
              const agg = ratingAggregates.get(location.locationId);
              const sessionsToday = sessionsTodayByLocation.get(location.locationId) ?? 0;
              const ownTags = Array.isArray(location.tags) ? location.tags : [];

              return (
                <View
                  key={location.locationId}
                  style={[
                    styles.card,
                    Elevation.e1,
                    { backgroundColor: palette.surface, borderColor: palette.border },
                  ]}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.cardHeading}>
                      <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>
                        {location.name}
                      </Text>
                      <Text style={[TypeScale.caption, { color: palette.icon }]}>
                        {location.building} · {location.campusArea}
                      </Text>
                    </View>
                    <View style={styles.cardRating}>
                      {agg ? (
                        <>
                          <Text style={[TypeScale.meta, { color: palette.text }]}>
                            ★ {agg.averageStars}
                          </Text>
                          <Text style={[TypeScale.caption, { color: palette.icon }]}>
                            ({agg.totalRatings})
                          </Text>
                        </>
                      ) : (
                        <Text style={[TypeScale.caption, { color: palette.icon }]}>New</Text>
                      )}
                    </View>
                  </View>

                  {location.notes ? (
                    <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={2}>
                      {location.notes}
                    </Text>
                  ) : null}

                  {ownTags.length > 0 || (agg?.topTags.length ?? 0) > 0 ? (
                    <View style={styles.tagRow}>
                      {ownTags.map((tag) => (
                        <View
                          key={`${location.locationId}-${tag}`}
                          style={[styles.tag, { backgroundColor: palette.surfaceMuted }]}>
                          <Text style={[TypeScale.label, { color: palette.text }]}>{tag}</Text>
                        </View>
                      ))}
                      {agg?.topTags.map((tag) => (
                        <View
                          key={`${location.locationId}-community-${tag}`}
                          style={[styles.tag, { backgroundColor: `${Brand.sunflower400}1A` }]}>
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
                  ) : null}

                  <View style={styles.cardFooter}>
                    <Text style={[TypeScale.meta, { color: palette.icon }]}>
                      {sessionsToday > 0
                        ? `${sessionsToday} session${sessionsToday === 1 ? '' : 's'} today`
                        : 'No sessions today'}
                    </Text>
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
                </View>
              );
            })}
          </View>
        )
      ) : !isLoading ? (
        <View
          style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[TypeScale.heading, { color: palette.text }]}>Can’t reach the library</Text>
          <Text style={[TypeScale.body, { color: palette.icon }]}>
            Studi could not load any study locations. Check your connection and try again.
          </Text>
        </View>
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
    gap: Space.lg,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 4,
  },
  header: {
    gap: Space.xs,
  },
  search: {
    borderRadius: Radius.xl,
    fontFamily: FontFamily.body,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
  },
  rail: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingRight: Space.lg,
  },
  railChip: {
    borderRadius: Radius.pill,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs + 2,
  },
  locationList: {
    gap: Space.md,
  },
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.sm,
    padding: Space.lg,
  },
  cardTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
  },
  cardHeading: {
    flex: 1,
    gap: 2,
  },
  cardRating: {
    alignItems: 'flex-end',
    gap: 2,
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
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Space.md,
    marginTop: Space.xs,
  },
});
