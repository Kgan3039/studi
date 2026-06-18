import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
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

import { CampusMap } from '@/components/campus-map';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Brand, Colors, Elevation, Radius, Space, TypeScale } from '@/constants/theme';
import { getAtmosphereFiltersForLocationTags } from '@/data/location-rating-options';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getLocationRatingAggregates,
  getLocations,
  getUpcomingSessions,
  getUserProfile,
  type LocationRatingAggregate,
  type StudyLocation,
  type StudySession,
} from '@/lib/firestore';
import type { User } from 'firebase/auth';

type MapFilter = 'all' | 'live' | 'next-hour' | 'my-classes' | 'quiet';

const MAP_FILTERS: { id: MapFilter; label: string }[] = [
  { id: 'all', label: 'All spots' },
  { id: 'live', label: 'Live now' },
  { id: 'next-hour', label: 'Next hour' },
  { id: 'my-classes', label: 'My classes' },
  { id: 'quiet', label: 'Quiet spots' },
];

function isLive(session: StudySession, now: number) {
  return session.startTime.toMillis() <= now && session.endTime.toMillis() > now;
}

function formatSessionTime(session: StudySession) {
  const start = session.startTime.toDate();
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (start.toDateString() === now.toDateString()) {
    return time;
  }

  if (start.toDateString() === tomorrow.toDateString()) {
    return `Tomorrow · ${time}`;
  }

  return `${start.toLocaleDateString('en-US', { weekday: 'short' })} · ${time}`;
}

export default function StudyLocationsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [profileClasses, setProfileClasses] = useState<string[]>([]);
  const [ratingAggregates, setRatingAggregates] = useState<Map<string, LocationRatingAggregate>>(
    new Map()
  );
  const [selectedFilter, setSelectedFilter] = useState<MapFilter>('all');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadMessage, setLoadMessage] = useState('Finding open tables around campus…');

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
      setAuthResolved(true);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authResolved && !currentUser) {
      router.replace('/');
    }
  }, [authResolved, currentUser, router]);

  const loadMap = useCallback(async () => {
    if (!currentUser) {
      return;
    }

    setIsLoading(true);

    try {
      const [loadedLocations, loadedSessions, aggregatesResult, profileResult] = await Promise.all([
        getLocations(),
        getUpcomingSessions({ includeInProgress: true }),
        getLocationRatingAggregates().catch(() => new Map<string, LocationRatingAggregate>()),
        getUserProfile(currentUser.uid).catch(() => null),
      ]);
      const counts = new Map<string, number>();

      loadedSessions.forEach((session) => {
        counts.set(session.locationId, (counts.get(session.locationId) ?? 0) + 1);
      });

      const firstLocation = [...loadedLocations].sort(
        (first, second) =>
          (counts.get(second.locationId) ?? 0) - (counts.get(first.locationId) ?? 0)
      )[0];

      setLocations(loadedLocations);
      setSessions(loadedSessions);
      setRatingAggregates(aggregatesResult);
      setProfileClasses(profileResult?.classes ?? []);
      setSelectedLocationId((current) => current ?? firstLocation?.locationId ?? null);
      setLoadMessage(
        `${loadedLocations.length} spot${loadedLocations.length === 1 ? '' : 's'} around campus`
      );
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : 'The campus map could not load.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      void loadMap();
    }, [loadMap])
  );

  const filteredLocations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000;

    return locations.filter((location) => {
      const aggregate = ratingAggregates.get(location.locationId);
      const locationSessions = sessions.filter(
        (session) => session.locationId === location.locationId
      );
      const searchText = [
        location.name,
        location.building,
        location.campusArea,
        location.notes,
        ...location.tags,
        ...(aggregate?.reviewTags ?? []),
        ...locationSessions.flatMap((session) => [session.classId, session.title]),
      ]
        .join(' ')
        .toLowerCase();

      if (normalizedQuery && !searchText.includes(normalizedQuery)) {
        return false;
      }

      switch (selectedFilter) {
        case 'live':
          return locationSessions.some((session) => isLive(session, now));
        case 'next-hour':
          return locationSessions.some((session) => {
            const start = session.startTime.toMillis();
            return start > now && start <= oneHourFromNow;
          });
        case 'my-classes':
          return locationSessions.some((session) => profileClasses.includes(session.classId));
        case 'quiet':
          return getAtmosphereFiltersForLocationTags([
            ...location.tags,
            ...(aggregate?.reviewTags ?? []),
          ]).has('Quiet');
        default:
          return true;
      }
    });
  }, [locations, profileClasses, ratingAggregates, searchQuery, selectedFilter, sessions]);

  useEffect(() => {
    if (
      filteredLocations.length > 0 &&
      !filteredLocations.some((location) => location.locationId === selectedLocationId)
    ) {
      setSelectedLocationId(filteredLocations[0].locationId);
    }
  }, [filteredLocations, selectedLocationId]);

  const visibleLocationIds = useMemo(
    () => new Set(filteredLocations.map((location) => location.locationId)),
    [filteredLocations]
  );

  const visibleSessions = useMemo(() => {
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000;

    return sessions.filter((session) => {
      if (!visibleLocationIds.has(session.locationId)) {
        return false;
      }

      switch (selectedFilter) {
        case 'live':
          return isLive(session, now);
        case 'next-hour': {
          const start = session.startTime.toMillis();
          return start > now && start <= oneHourFromNow;
        }
        case 'my-classes':
          return profileClasses.includes(session.classId);
        default:
          return true;
      }
    });
  }, [profileClasses, selectedFilter, sessions, visibleLocationIds]);

  const sessionsByLocation = useMemo(() => {
    const counts = new Map<string, number>();

    visibleSessions.forEach((session) => {
      counts.set(session.locationId, (counts.get(session.locationId) ?? 0) + 1);
    });

    return counts;
  }, [visibleSessions]);

  const selectedLocation =
    filteredLocations.find((location) => location.locationId === selectedLocationId) ?? null;
  const selectedSessions = selectedLocation
    ? sessions
        .filter((session) => session.locationId === selectedLocation.locationId)
        .sort((first, second) => first.startTime.toMillis() - second.startTime.toMillis())
    : [];
  const selectedRating = selectedLocation
    ? ratingAggregates.get(selectedLocation.locationId)
    : undefined;

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadMap();
    setIsRefreshing(false);
  }

  function openDirections(location: StudyLocation) {
    const destination = encodeURIComponent(
      `${location.name}, ${location.building}, Madison, Wisconsin`
    );
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${destination}`
        : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

    void Linking.openURL(url);
  }

  function clearFilters() {
    setSearchQuery('');
    setSelectedFilter('all');
  }

  if (!authResolved || !currentUser) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={palette.icon}
        />
      }
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[TypeScale.title, { color: palette.text }]}>Study spots</Text>
          <Text style={[TypeScale.meta, { color: palette.icon }]}>{loadMessage}</Text>
        </View>
        {isLoading ? <ActivityIndicator color={palette.tint} size="small" /> : null}
      </View>

      <View
        style={[
          styles.searchBar,
          { backgroundColor: palette.surface, borderColor: palette.border },
          Elevation.e1,
        ]}>
        <MaterialIcons color={palette.icon} name="search" size={22} />
        <TextInput
          accessibilityLabel="Search study spots and sessions"
          autoCapitalize="none"
          onChangeText={setSearchQuery}
          placeholder="Search sessions or study spots"
          placeholderTextColor={colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle}
          returnKeyType="search"
          style={[TypeScale.body, styles.searchInput, { color: palette.text }]}
          value={searchQuery}
        />
        {searchQuery ? (
          <Pressable
            accessibilityLabel="Clear search"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setSearchQuery('')}>
            <MaterialIcons color={palette.icon} name="cancel" size={20} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRail}>
        {MAP_FILTERS.map((filter) => {
          const isSelected = selectedFilter === filter.id;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={filter.id}
              onPress={() => setSelectedFilter(filter.id)}
              style={({ pressed }) => [
                styles.filterChip,
                isSelected
                  ? { backgroundColor: palette.tint }
                  : {
                      backgroundColor: palette.surface,
                      borderColor: palette.border,
                      borderWidth: StyleSheet.hairlineWidth * 2,
                    },
                pressed && styles.pressed,
              ]}>
              <Text
                style={[TypeScale.label, { color: isSelected ? '#FFFFFF' : palette.icon }]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {filteredLocations.length > 0 ? (
        <View style={styles.mapAndSheet}>
          <CampusMap
            locations={filteredLocations}
            onSelectLocation={setSelectedLocationId}
            selectedLocationId={selectedLocationId}
            sessionsByLocation={sessionsByLocation}
          />

          {selectedLocation ? (
            <View
              style={[
                styles.locationSheet,
                Elevation.e2,
                { backgroundColor: palette.background, borderColor: palette.border },
              ]}>
              <View style={[styles.sheetHandle, { backgroundColor: palette.outline }]} />
              <View style={styles.sheetHeadingRow}>
                <View style={styles.locationHeading}>
                  <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>
                    {selectedLocation.campusArea}
                  </Text>
                  <Text style={[TypeScale.h2, { color: palette.text }]}>
                    {selectedLocation.name}
                  </Text>
                  <Text style={[TypeScale.meta, { color: palette.icon }]}>
                    {selectedSessions.length} upcoming{' '}
                    {selectedSessions.length === 1 ? 'session' : 'sessions'}
                    {selectedRating ? ` · ★ ${selectedRating.averageStars}` : ''}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel={`Get directions to ${selectedLocation.name}`}
                  accessibilityRole="link"
                  onPress={() => openDirections(selectedLocation)}
                  style={({ pressed }) => [
                    styles.directionsButton,
                    { backgroundColor: palette.tint },
                    pressed && styles.pressed,
                  ]}>
                  <MaterialIcons color="#FFFFFF" name="directions" size={18} />
                  <Text style={[TypeScale.label, { color: '#FFFFFF' }]}>Directions</Text>
                </Pressable>
              </View>

              <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={2}>
                {selectedLocation.notes}
              </Text>

              <View style={styles.tagRow}>
                {selectedLocation.tags.slice(0, 3).map((tag) => (
                  <View
                    key={tag}
                    style={[styles.tag, { backgroundColor: palette.surfaceMuted }]}>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>#{tag}</Text>
                  </View>
                ))}
              </View>

              {selectedSessions.length > 0 ? (
                <View style={styles.sessionList}>
                  {selectedSessions.slice(0, 3).map((session) => {
                    const live = isLive(session, Date.now());

                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={session.sessionId}
                        onPress={() => router.push(`/session/${session.sessionId}`)}
                        style={({ pressed }) => [
                          styles.sessionRow,
                          { backgroundColor: palette.surface, borderColor: palette.border },
                          pressed && styles.pressed,
                        ]}>
                        <CourseChip code={session.classId} size="sm" />
                        <View style={styles.sessionCopy}>
                          <Text
                            numberOfLines={1}
                            style={[TypeScale.bodyStrong, { color: palette.text }]}>
                            {session.title}
                          </Text>
                          <Text style={[TypeScale.caption, { color: palette.icon }]}>
                            {formatSessionTime(session)} · {session.participantIds.length} going
                          </Text>
                        </View>
                        {live ? (
                          <Text style={[TypeScale.eyebrow, { color: palette.tint }]}>● LIVE</Text>
                        ) : (
                          <MaterialIcons color={palette.icon} name="chevron-right" size={20} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.noSessions, { borderColor: palette.border }]}>
                  <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>Open table</Text>
                  <Text style={[TypeScale.caption, { color: palette.icon }]}>
                    No one has planned a session here yet.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: '/create-session',
                        params: { locationId: selectedLocation.locationId },
                      })
                    }
                    style={({ pressed }) => [styles.hostLink, pressed && styles.pressed]}>
                    <Text style={[TypeScale.label, { color: palette.tint }]}>Host one here →</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : !isLoading ? (
        <EmptyState
          icon="spot"
          headline="No pins over here"
          body="Try another search or widen the map filters."
          actionLabel="Show every spot"
          onAction={clearFilters}
        />
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
    gap: Space.md,
    padding: Space.lg + 4,
    paddingBottom: Space.xxl + 8,
  },
  header: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerCopy: {
    gap: 2,
  },
  searchBar: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.sm,
    minHeight: 50,
    paddingHorizontal: Space.lg,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Space.sm,
  },
  filterRail: {
    gap: Space.sm,
    paddingRight: Space.lg,
  },
  filterChip: {
    borderRadius: Radius.pill,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: Space.md + 2,
  },
  mapAndSheet: {
    gap: 0,
  },
  locationSheet: {
    borderRadius: Radius.xxl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    marginTop: -28,
    padding: Space.lg,
    paddingTop: Space.sm,
    zIndex: 5,
  },
  sheetHandle: {
    alignSelf: 'center',
    borderRadius: Radius.pill,
    height: 5,
    marginBottom: Space.xs,
    width: 48,
  },
  sheetHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
  },
  locationHeading: {
    flex: 1,
    gap: 2,
  },
  directionsButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: Space.xs,
    minHeight: 42,
    paddingHorizontal: Space.md,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  tag: {
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm + 2,
    paddingVertical: Space.xs,
  },
  sessionList: {
    gap: Space.sm,
  },
  sessionRow: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.sm,
    minHeight: 72,
    padding: Space.md,
  },
  sessionCopy: {
    flex: 1,
    gap: 2,
  },
  noSessions: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    gap: 2,
    paddingTop: Space.md,
  },
  hostLink: {
    alignSelf: 'flex-start',
    marginTop: Space.sm,
    paddingVertical: Space.xs,
  },
  pressed: {
    opacity: 0.72,
  },
});
