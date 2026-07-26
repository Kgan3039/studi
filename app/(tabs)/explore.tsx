import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/campus-map';
import type { MapSessionTiming } from '@/components/campus-map.types';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterChip } from '@/components/ui/FilterChip';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { Colors, Elevation, Radius, Space, TypeScale } from '@/constants/theme';
import { getAtmosphereFiltersForLocationTags } from '@/data/location-rating-options';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
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
import { canonicalStudyLocationId } from '@/lib/catalog';
import type { User } from 'firebase/auth';

type MapFilter = 'all' | 'live' | 'next-hour' | 'my-classes' | 'quiet';

const MAP_FILTERS: { id: MapFilter; label: string }[] = [
  { id: 'all', label: 'All spots' },
  { id: 'live', label: 'Live now' },
  { id: 'next-hour', label: 'Next hour' },
  { id: 'my-classes', label: 'My classes' },
  { id: 'quiet', label: 'Quiet spots' },
];

const MAP_FILTER_ICONS: Record<MapFilter, IconSymbolName> = {
  all: 'line.3.horizontal.decrease',
  live: 'clock',
  'next-hour': 'calendar',
  'my-classes': 'person.2.fill',
  quiet: 'book.closed',
};

function isLive(session: StudySession, now: number) {
  const start = getTimestampMillis(session.startTime);
  const end = getTimestampMillis(session.endTime);

  return start !== null && end !== null && start <= now && end > now;
}

function getTimestampMillis(timestamp: StudySession['startTime'] | StudySession['endTime']) {
  try {
    const millis = timestamp.toMillis();

    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function getTimestampDate(timestamp: StudySession['startTime'] | StudySession['endTime']) {
  try {
    const date = timestamp.toDate();

    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function isStartingWithin(session: StudySession, now: number, endWindow: number) {
  const start = getTimestampMillis(session.startTime);

  return start !== null && start > now && start <= endWindow;
}

function normalizeClassCode(classCode: string) {
  return classCode.trim().toUpperCase();
}

function getLocationTags(location: StudyLocation) {
  return Array.isArray(location.tags) ? location.tags.filter((tag) => typeof tag === 'string') : [];
}

function formatSessionTime(session: StudySession) {
  const start = getTimestampDate(session.startTime);

  if (!start) {
    return 'Time TBA';
  }

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
  const scrollViewRef = useRef<ScrollView>(null);
  const loadRequestRef = useRef(0);
  const isMountedRef = useRef(true);
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
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setIsLoading(true);

    try {
      const [loadedLocations, loadedSessions, aggregatesResult, profileResult] = await Promise.all([
        getLocations(),
        getUpcomingSessions({ includeInProgress: true }).catch(() => []),
        getLocationRatingAggregates().catch(() => new Map<string, LocationRatingAggregate>()),
        getUserProfile(currentUser.uid).catch(() => null),
      ]);
      // Sessions may reference Firestore-only alias ids (e.g. `morgridge`);
      // the pin list only carries the curated ids, so canonicalize before
      // grouping or those sessions never show up on the map.
      const canonicalSessions = loadedSessions.map((session) => ({
        ...session,
        locationId: canonicalStudyLocationId(session.locationId),
      }));
      const counts = new Map<string, number>();

      canonicalSessions.forEach((session) => {
        counts.set(session.locationId, (counts.get(session.locationId) ?? 0) + 1);
      });

      const firstLocation = [...loadedLocations].sort(
        (first, second) =>
          (counts.get(second.locationId) ?? 0) - (counts.get(first.locationId) ?? 0)
      )[0];

      if (!isMountedRef.current || loadRequestRef.current !== requestId) {
        return;
      }

      setLocations(loadedLocations);
      setSessions(canonicalSessions);
      setRatingAggregates(aggregatesResult);
      setProfileClasses(profileResult?.classes ?? []);
      setSelectedLocationId((current) => current ?? firstLocation?.locationId ?? null);
      setLoadMessage(
        `${loadedLocations.length} spot${loadedLocations.length === 1 ? '' : 's'} around campus`
      );
    } catch (error) {
      if (!isMountedRef.current || loadRequestRef.current !== requestId) {
        return;
      }

      setLoadMessage(error instanceof Error ? error.message : 'The campus map could not load.');
    } finally {
      if (isMountedRef.current && loadRequestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      void loadMap();
    }, [loadMap])
  );

  const profileClassSet = useMemo(
    () => new Set(profileClasses.map((classCode) => normalizeClassCode(classCode))),
    [profileClasses]
  );

  const sessionsByLocationId = useMemo(() => {
    const groupedSessions = new Map<string, StudySession[]>();

    sessions.forEach((session) => {
      if (!session.locationId) {
        return;
      }

      const locationSessions = groupedSessions.get(session.locationId) ?? [];
      locationSessions.push(session);
      groupedSessions.set(session.locationId, locationSessions);
    });

    return groupedSessions;
  }, [sessions]);

  const filteredLocations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000;

    return locations.filter((location) => {
      const aggregate = ratingAggregates.get(location.locationId);
      const locationSessions = sessionsByLocationId.get(location.locationId) ?? [];
      const locationTags = getLocationTags(location);
      const reviewTags = aggregate?.reviewTags ?? [];
      const searchText = [
        location.name,
        location.building,
        location.campusArea,
        location.notes,
        ...locationTags,
        ...reviewTags,
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
          return locationSessions.some((session) => isStartingWithin(session, now, oneHourFromNow));
        case 'my-classes':
          return locationSessions.some((session) =>
            profileClassSet.has(normalizeClassCode(session.classId))
          );
        case 'quiet':
          return getAtmosphereFiltersForLocationTags([...locationTags, ...reviewTags]).has('Quiet');
        default:
          return true;
      }
    });
  }, [
    locations,
    profileClassSet,
    ratingAggregates,
    searchQuery,
    selectedFilter,
    sessionsByLocationId,
  ]);

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
        case 'next-hour':
          return isStartingWithin(session, now, oneHourFromNow);
        case 'my-classes':
          return profileClassSet.has(normalizeClassCode(session.classId));
        default:
          return true;
      }
    });
  }, [profileClassSet, selectedFilter, sessions, visibleLocationIds]);

  const sessionsByLocation = useMemo(() => {
    const counts = new Map<string, number>();

    visibleSessions.forEach((session) => {
      counts.set(session.locationId, (counts.get(session.locationId) ?? 0) + 1);
    });

    return counts;
  }, [visibleSessions]);

  const sessionTimingByLocation = useMemo(() => {
    const timings = new Map<string, MapSessionTiming>();
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000;

    visibleSessions.forEach((session) => {
      const currentTiming = timings.get(session.locationId) ?? 'none';
      const start = getTimestampMillis(session.startTime);
      const end = getTimestampMillis(session.endTime);

      if (start === null) {
        return;
      }

      if (end !== null && start <= now && end > now) {
        timings.set(session.locationId, 'live');
      } else if (currentTiming !== 'live' && start > now && start <= oneHourFromNow) {
        timings.set(session.locationId, 'soon');
      } else if (currentTiming === 'none' && start > oneHourFromNow) {
        timings.set(session.locationId, 'later');
      }
    });

    return timings;
  }, [visibleSessions]);

  const selectedLocation =
    filteredLocations.find((location) => location.locationId === selectedLocationId) ?? null;
  const selectedSessions = selectedLocation
    ? [...(sessionsByLocationId.get(selectedLocation.locationId) ?? [])].sort(
        (first, second) =>
          (getTimestampMillis(first.startTime) ?? Number.MAX_SAFE_INTEGER) -
          (getTimestampMillis(second.startTime) ?? Number.MAX_SAFE_INTEGER)
      )
    : [];
  const selectedRating = selectedLocation
    ? ratingAggregates.get(selectedLocation.locationId)
    : undefined;

  async function handleRefresh() {
    setIsRefreshing(true);

    try {
      await loadMap();
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }

  function selectLocation(locationId: string) {
    setSelectedLocationId(locationId);

    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    });
  }

  function openDirections(location: StudyLocation) {
    const destination = encodeURIComponent(
      `${location.name}, ${location.building}, Madison, Wisconsin`
    );
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${destination}`
        : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;

    track('map_directions_opened', { locationId: location.locationId });
    void Linking.openURL(url).catch(() => {
      setLoadMessage('Could not open directions on this device.');
    });
  }

  function openCampusMap() {
    track('uw_map_opened');
    void Linking.openURL('https://map.wisc.edu/').catch(() => {
      setLoadMessage('Could not open the UW campus map on this device.');
    });
  }

  function rateLocation(location: StudyLocation) {
    router.push({
      pathname: '/rate-location',
      params: {
        locationId: location.locationId,
        locationName: location.name,
      },
    });
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
      ref={scrollViewRef}
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
      <ScreenHeader
        onRefresh={handleRefresh}
        refreshing={isRefreshing}
        showNotifications
        title="Study spots"
        status={loadMessage}
      />

      <ScreenTransition style={styles.transition}>
      <SearchBar
          accessibilityLabel="Search study spots and sessions"
          onChangeText={setSearchQuery}
          placeholder="Search sessions or study spots"
          value={searchQuery}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRail}>
        {MAP_FILTERS.map((filter) => {
          const isSelected = selectedFilter === filter.id;

          return (
            <FilterChip
              icon={MAP_FILTER_ICONS[filter.id]}
              key={filter.id}
              label={filter.label}
              onPress={() => setSelectedFilter(filter.id)}
              selected={isSelected}
            />
          );
        })}
      </ScrollView>

      <View style={styles.mapAndSheet}>
        <CampusMap
          locations={locations}
          onOpenCampusMap={openCampusMap}
          onSelectLocation={selectLocation}
          selectedLocationId={selectedLocationId}
          sessionTimingByLocation={sessionTimingByLocation}
          sessionsByLocation={sessionsByLocation}
          visibleLocationIds={visibleLocationIds}
        />

        {filteredLocations.length > 0 ? (
          <View style={styles.resultsStack}>
          <View
            style={[
              styles.locationList,
              { borderTopColor: palette.border },
            ]}>
            <View style={styles.locationListHeader}>
              <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>Nearby spots</Text>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>
                Select a spot for details and ratings.
              </Text>
            </View>

            {filteredLocations.map((location) => {
              const isSelected = selectedLocationId === location.locationId;
              const sessionCount = sessionsByLocation.get(location.locationId) ?? 0;
              const aggregate = ratingAggregates.get(location.locationId);

              return (
                <View
                  key={location.locationId}
                  style={[
                    styles.locationListItem,
                    {
                      backgroundColor: isSelected ? palette.surfaceMuted : palette.background,
                      borderBottomColor: palette.border,
                    },
                  ]}>
                  <View style={styles.locationListCopy}>
                    <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>
                      {location.name}
                    </Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      {location.campusArea} · {sessionCount} upcoming{' '}
                      {sessionCount === 1 ? 'session' : 'sessions'}
                      {aggregate ? ` · ★ ${aggregate.averageStars}` : ''}
                    </Text>
                  </View>
                  <View style={styles.locationListActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => selectLocation(location.locationId)}
                      style={({ pressed }) => [
                        styles.locationListButton,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={[TypeScale.label, { color: palette.tint }]}>Details</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => rateLocation(location)}
                      style={({ pressed }) => [
                        styles.locationListButton,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={[TypeScale.label, { color: palette.tint }]}>Rate</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>

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
                  <Text style={[TypeScale.meta, { color: palette.icon }]}>
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

              <Pressable
                accessibilityRole="button"
                onPress={() => rateLocation(selectedLocation)}
                style={({ pressed }) => [styles.rateLink, pressed && styles.pressed]}>
                <MaterialIcons color={palette.tint} name="star-rate" size={18} />
                <Text style={[TypeScale.label, { color: palette.tint }]}>Rate this spot</Text>
              </Pressable>

              <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={2}>
                {selectedLocation.notes}
              </Text>

              <View style={styles.tagRow}>
                {getLocationTags(selectedLocation).slice(0, 3).map((tag) => (
                  <View
                    key={tag}
                    style={[styles.tag, { backgroundColor: palette.surfaceMuted }]}>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>#{tag}</Text>
                  </View>
                ))}
              </View>

              {selectedSessions.length > 0 ? (
                <View style={[styles.sessionList, { borderTopColor: palette.border }]}>
                  {selectedSessions.slice(0, 3).map((session) => {
                    const live = isLive(session, Date.now());
                    const participantCount = Array.isArray(session.participantIds)
                      ? session.participantIds.length
                      : 0;

                    return (
                      <Pressable
                        accessibilityRole="button"
                        key={session.sessionId}
                        onPress={() => router.push(`/session/${session.sessionId}`)}
                      style={({ pressed }) => [
                          styles.sessionRow,
                          { borderBottomColor: palette.border },
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
                            {formatSessionTime(session)} · {participantCount} going
                          </Text>
                        </View>
                        {live ? (
                          <Text style={[TypeScale.meta, { color: palette.tint }]}>● Live</Text>
                        ) : (
                          <MaterialIcons color={palette.icon} name="chevron-right" size={20} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.noSessions, { borderColor: palette.border }]}>
                  <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>
                    No sessions here yet
                  </Text>
                  <Text style={[TypeScale.caption, { color: palette.icon }]}>
                    Create one for classmates to join.
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
            headline="No study spots found"
            body="Try another search or clear the current filters."
            actionLabel="Clear filters"
            onAction={clearFilters}
            style={styles.noPinsState}
          />
        ) : null}
      </View>
      </ScreenTransition>
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
  transition: {
    gap: Space.md,
  },
  filterRail: {
    gap: Space.sm,
    paddingRight: Space.lg,
  },
  mapAndSheet: {
    gap: Space.md,
  },
  resultsStack: {
    gap: Space.md,
  },
  noPinsState: {
    backgroundColor: 'transparent',
    paddingTop: Space.lg,
  },
  locationList: {
    borderTopWidth: 1,
  },
  locationListHeader: {
    gap: 2,
    paddingBottom: Space.md,
    paddingTop: Space.lg,
  },
  locationListItem: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 72,
    padding: Space.md,
  },
  locationListCopy: {
    flex: 1,
    gap: 2,
  },
  locationListActions: {
    flexDirection: 'row',
    gap: Space.xs,
  },
  locationListButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Space.sm,
  },
  locationSheet: {
    borderRadius: Radius.xxl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.md,
    padding: Space.lg,
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
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Space.xs,
    minHeight: 42,
    paddingHorizontal: Space.md,
  },
  rateLink: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: Space.xs,
    paddingVertical: Space.xs,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  tag: {
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm + 2,
    paddingVertical: Space.xs,
  },
  sessionList: {
    borderTopWidth: 1,
  },
  sessionRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
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
