import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/campus-map';
import type { MapSessionTiming } from '@/components/campus-map.types';
import {
  CatalogRequestLink,
  CatalogRequestSheet,
} from '@/components/ui/CatalogRequestSheet';
import { CourseChip } from '@/components/ui/CourseChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { FilterChip } from '@/components/ui/FilterChip';
import { Sheet } from '@/components/ui/Sheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import {
  PullToRefreshIndicator,
  usePullToRefreshDistance,
} from '@/components/ui/PullToRefreshIndicator';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import { SearchBar } from '@/components/ui/SearchBar';
import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import {
  getAtmosphereFiltersForLocationTags,
  type LocationAtmosphereFilter,
} from '@/data/location-rating-options';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/analytics';
import { shouldOfferLocationRequest } from '@/lib/catalog-request';
import { subscribeToAuthState } from '@/lib/auth';
import {
  getLocationRatingAggregates,
  getOwnLocationRatings,
  getLocations,
  getUpcomingSessions,
  getUserProfile,
  type LocationRatingAggregate,
  type StudyLocation,
  type StudySession,
} from '@/lib/firestore';
import { canonicalStudyLocationId } from '@/lib/catalog';
import type { User } from 'firebase/auth';

/** Session-derived filters. Each narrows independently and they combine. */
type ActivityFilter = 'live' | 'next-hour' | 'my-classes';

const ACTIVITY_FILTERS: { id: ActivityFilter; label: string; icon: IconSymbolName }[] = [
  { id: 'live', label: 'Live now', icon: 'clock' },
  { id: 'next-hour', label: 'Next hour', icon: 'calendar' },
  { id: 'my-classes', label: 'My classes', icon: 'person.2.fill' },
];

/**
 * Atmosphere filters come from what students actually rated a spot, so they
 * only include the qualities someone would search *for*.
 */
const ATMOSPHERE_FILTERS: LocationAtmosphereFilter[] = [
  'Quiet',
  'Spacious',
  'Group Friendly',
  'Solo Focused',
];

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
    return `Tomorrow, ${time}`;
  }

  return `${start.toLocaleDateString('en-US', { weekday: 'short' })}, ${time}`;
}

function ExpandedLocationDetails({
  backgroundColor,
  children,
  reduceMotion,
}: {
  backgroundColor: string;
  children: ReactNode;
  reduceMotion: boolean;
}) {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    Animated.timing(progress, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.locationDetails,
        {
          backgroundColor,
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-8, 0],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

export default function StudyLocationsScreen() {
  const router = useRouter();
  const { locationId: requestedLocationId, locationRequest } = useLocalSearchParams<{
    locationId?: string;
    locationRequest?: string;
  }>();
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const locationRowRefs = useRef(new Map<string, View>());
  const pendingScrollLocationRef = useRef<string | null>(null);
  const appliedRequestedLocationRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const isMountedRef = useRef(true);
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { onPullScroll, pullDistance } = usePullToRefreshDistance();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [locations, setLocations] = useState<StudyLocation[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [profileClasses, setProfileClasses] = useState<string[]>([]);
  const [ownRatings, setOwnRatings] = useState<Map<string, number>>(new Map());
  const [ratingAggregates, setRatingAggregates] = useState<Map<string, LocationRatingAggregate>>(
    new Map()
  );
  const [activityFilters, setActivityFilters] = useState<ActivityFilter[]>([]);
  const [atmosphereFilters, setAtmosphereFilters] = useState<LocationAtmosphereFilter[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [requestSheetOpen, setRequestSheetOpen] = useState(false);
  const activeFilterCount = activityFilters.length + atmosphereFilters.length;

  function toggleActivityFilter(id: ActivityFilter) {
    setActivityFilters((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function toggleAtmosphereFilter(tag: LocationAtmosphereFilter) {
    setAtmosphereFilters((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]
    );
  }

  function clearSpotFilters() {
    setActivityFilters([]);
    setAtmosphereFilters([]);
  }
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);
  const [scrollRequestNonce, setScrollRequestNonce] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
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
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => subscription.remove();
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
      const [loadedLocations, loadedSessions, aggregatesResult, profileResult, ownRatingsResult] =
        await Promise.all([
          getLocations(),
          getUpcomingSessions({ includeInProgress: true }).catch(() => []),
          getLocationRatingAggregates().catch(() => new Map<string, LocationRatingAggregate>()),
          getUserProfile(currentUser.uid).catch(() => null),
          getOwnLocationRatings(currentUser.uid).catch(() => new Map<string, number>()),
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
      // Stored ids can be Firestore-only aliases, so canonicalize to match the
      // curated ids the list renders against.
      setOwnRatings(
        new Map(
          [...ownRatingsResult].map(([locationId, stars]) => [
            canonicalStudyLocationId(locationId),
            stars,
          ])
        )
      );
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

  const locationSearchTextById = useMemo(
    () =>
      new Map(
        locations.map((location) => {
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

          return [location.locationId, searchText] as const;
        })
      ),
    [locations, ratingAggregates, sessionsByLocationId]
  );

  const shouldOfferRequest = useMemo(
    () => shouldOfferLocationRequest(searchQuery, [...locationSearchTextById.values()]),
    [locationSearchTextById, searchQuery]
  );

  const filteredLocations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const now = Date.now();
    const oneHourFromNow = now + 60 * 60 * 1000;

    return locations.filter((location) => {
      const aggregate = ratingAggregates.get(location.locationId);
      const locationSessions = sessionsByLocationId.get(location.locationId) ?? [];
      const locationTags = getLocationTags(location);
      const reviewTags = aggregate?.reviewTags ?? [];
      const searchText = locationSearchTextById.get(location.locationId) ?? '';

      if (normalizedQuery && !searchText.includes(normalizedQuery)) {
        return false;
      }

      // Every selected filter has to hold, so combinations narrow rather than
      // replace each other.
      const matchesActivity = activityFilters.every((filter) => {
        switch (filter) {
          case 'live':
            return locationSessions.some((session) => isLive(session, now));
          case 'next-hour':
            return locationSessions.some((session) =>
              isStartingWithin(session, now, oneHourFromNow)
            );
          case 'my-classes':
            return locationSessions.some((session) =>
              profileClassSet.has(normalizeClassCode(session.classId))
            );
          default:
            return true;
        }
      });

      if (!matchesActivity) {
        return false;
      }

      if (atmosphereFilters.length > 0) {
        const atmosphere = getAtmosphereFiltersForLocationTags([...locationTags, ...reviewTags]);
        return atmosphereFilters.every((tag) => atmosphere.has(tag));
      }

      return true;
    });
  }, [
    activityFilters,
    atmosphereFilters,
    locations,
    locationSearchTextById,
    profileClassSet,
    ratingAggregates,
    searchQuery,
    sessionsByLocationId,
  ]);

  // Clear a map selection or expanded row when filters remove that spot.
  useEffect(() => {
    if (
      selectedLocationId &&
      !filteredLocations.some((location) => location.locationId === selectedLocationId)
    ) {
      setSelectedLocationId(null);
    }
    if (
      expandedLocationId &&
      !filteredLocations.some((location) => location.locationId === expandedLocationId)
    ) {
      setExpandedLocationId(null);
    }
  }, [expandedLocationId, filteredLocations, selectedLocationId]);

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

      // Mirrors the location filter so the pin counts only include sessions
      // the current filters would actually surface.
      return activityFilters.every((filter) => {
        switch (filter) {
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
    });
  }, [activityFilters, profileClassSet, sessions, visibleLocationIds]);

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

  const expandedLocation =
    filteredLocations.find((location) => location.locationId === expandedLocationId) ?? null;
  const expandedOwnStars = expandedLocation
    ? ownRatings.get(expandedLocation.locationId)
    : undefined;
  const selectedSessions = expandedLocation
    ? [...(sessionsByLocationId.get(expandedLocation.locationId) ?? [])].sort(
        (first, second) =>
          (getTimestampMillis(first.startTime) ?? Number.MAX_SAFE_INTEGER) -
          (getTimestampMillis(second.startTime) ?? Number.MAX_SAFE_INTEGER)
      )
    : [];

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

  // A pin tap is intentionally lightweight: it identifies the spot on the map
  // without moving the screen or opening a large block of content.
  const selectLocation = useCallback((locationId: string) => {
    setSelectedLocationId(locationId);
  }, []);

  const animateDetailsLayout = useCallback(() => {
    if (reduceMotion) {
      return;
    }

    LayoutAnimation.configureNext({
      create: {
        duration: 200,
        property: LayoutAnimation.Properties.opacity,
        type: LayoutAnimation.Types.easeOut,
      },
      delete: {
        duration: 180,
        property: LayoutAnimation.Properties.opacity,
        type: LayoutAnimation.Types.easeIn,
      },
      duration: 240,
      update: {
        duration: 240,
        type: LayoutAnimation.Types.easeInEaseOut,
      },
    });
  }, [reduceMotion]);

  const toggleLocationDetails = useCallback(
    (locationId: string) => {
      animateDetailsLayout();
      setSelectedLocationId(locationId);
      setExpandedLocationId((current) => (current === locationId ? null : locationId));
    },
    [animateDetailsLayout]
  );

  const openLocationDetails = useCallback(
    (locationId: string, scrollToRow = false) => {
      animateDetailsLayout();
      setSelectedLocationId(locationId);
      setExpandedLocationId(locationId);

      if (scrollToRow) {
        pendingScrollLocationRef.current = locationId;
        setScrollRequestNonce((current) => current + 1);
      }
    },
    [animateDetailsLayout]
  );
  const handleOpenLocationFromMap = useCallback(
    (locationId: string) => openLocationDetails(locationId, true),
    [openLocationDetails]
  );

  // Arriving from a link (e.g. a spot on Profile) opens that spot's details
  // rather than dropping the person at the top of an unfiltered map.
  useEffect(() => {
    const requested = requestedLocationId?.trim();

    const requestKey = `${requested ?? ''}:${locationRequest ?? ''}`;

    if (
      !requested ||
      locations.length === 0 ||
      appliedRequestedLocationRef.current === requestKey
    ) {
      return;
    }

    const canonicalId = canonicalStudyLocationId(requested);
    const match = locations.find((location) => location.locationId === canonicalId);

    if (!match) {
      return;
    }

    appliedRequestedLocationRef.current = requestKey;
    // Clear narrowing filters so the requested spot can't be filtered out from
    // under the person who just asked for it.
    clearSpotFilters();
    setSearchQuery('');
    openLocationDetails(canonicalId, true);
  }, [locationRequest, locations, openLocationDetails, requestedLocationId]);

  useEffect(() => {
    const locationId = pendingScrollLocationRef.current;

    if (!locationId) {
      return;
    }

    let animationFrame: number | null = null;
    let cancelled = false;
    let attempts = 0;

    const scrollWhenReady = () => {
      if (cancelled || pendingScrollLocationRef.current !== locationId) {
        return;
      }

      const row = locationRowRefs.current.get(locationId);

      // Filtering and the inline-details layout commit on separate frames.
      // Keep the request alive until the row has a real screen position rather
      // than silently abandoning it just because the row was not mounted yet.
      if (!row) {
        attempts += 1;
        if (attempts < 10) {
          animationFrame = requestAnimationFrame(scrollWhenReady);
        }
        return;
      }

      row.measureInWindow((_x, y, _width, height) => {
        if (cancelled || !Number.isFinite(y) || !Number.isFinite(height) || height <= 0) {
          attempts += 1;
          if (attempts < 10) {
            animationFrame = requestAnimationFrame(scrollWhenReady);
          }
          return;
        }

        const topInset = insets.top + Space.md;
        const targetOffset = Math.max(0, scrollYRef.current + y - topInset);

        scrollViewRef.current?.scrollTo({
          animated: !reduceMotion,
          y: targetOffset,
        });
        pendingScrollLocationRef.current = null;
      });
    };

    // One frame allows the selected row and its expanded panel to commit;
    // retries above cover slower mounts without adding a visible delay.
    animationFrame = requestAnimationFrame(scrollWhenReady);

    return () => {
      cancelled = true;
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [expandedLocationId, filteredLocations.length, insets.top, reduceMotion, scrollRequestNonce]);

  /**
   * The expanded panel for the selected spot. Rendered inline under its own
   * row, so it reads as that row opening rather than a sheet at the bottom of
   * an unrelated list.
   */
  function renderLocationDetails() {
    if (!expandedLocation) {
      return null;
    }

    const tags = getLocationTags(expandedLocation).slice(0, 3);

    return (
      // No card here: this already sits inside the spots list, and a bordered
      // panel inside a bordered list is the card-in-card the anti-slop rules
      // reject. An indent plus the row's own tint is enough to show it belongs
      // to the spot above it.
      <ExpandedLocationDetails
        backgroundColor={palette.surfaceMuted}
        reduceMotion={reduceMotion}>
        {expandedLocation.notes ? (
          <Text style={[TypeScale.body, { color: palette.text }]}>
            {expandedLocation.notes}
          </Text>
        ) : null}

        {tags.length > 0 ? (
          <View style={styles.tagRow}>
            {tags.map((tag) => (
              <View
                key={tag}
                style={[styles.tag, { backgroundColor: palette.background }]}>
                <Text style={[TypeScale.caption, { color: palette.icon }]}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.detailsActions}>
          <Button
            icon="mappin.and.ellipse"
            label="Directions"
            size="sm"
            onPress={() => openDirections(expandedLocation)}
          />
          <Button
            icon="star.fill"
            label={
              expandedOwnStars !== undefined ? `Your rating · ${expandedOwnStars}` : 'Rate'
            }
            size="sm"
            variant="secondary"
            onPress={() => rateLocation(expandedLocation)}
          />
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
                    <Text numberOfLines={1} style={[TypeScale.bodyStrong, { color: palette.text }]}>
                      {session.title}
                    </Text>
                    <Text style={[TypeScale.caption, { color: palette.icon }]}>
                      {formatSessionTime(session)}, {participantCount} going
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
          <View style={[styles.noSessions, { borderTopColor: palette.border }]}>
            <Text style={[TypeScale.caption, { color: palette.icon }]}>
              No sessions here yet.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/create-session',
                  params: { locationId: expandedLocation.locationId },
                })
              }
              style={({ pressed }) => [styles.hostLink, pressed && styles.pressed]}>
              <Text style={[TypeScale.label, { color: palette.tint }]}>Host one here</Text>
            </Pressable>
          </View>
        )}
      </ExpandedLocationDetails>
    );
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
    clearSpotFilters();
  }

  if (!authResolved || !currentUser) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  return (
    <>
    <ScrollView
      ref={scrollViewRef}
      keyboardShouldPersistTaps="handled"
      onScroll={(event) => {
        scrollYRef.current = event.nativeEvent.contentOffset.y;
        onPullScroll(event);
      }}
      refreshControl={
        <RefreshControl
          colors={['transparent']}
          progressBackgroundColor="transparent"
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor="transparent"
        />
      }
      scrollEventThrottle={16}
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingBottom: insets.bottom + Space.xxl * 2 + Space.md,
          paddingTop: insets.top + Space.md,
        },
      ]}>
      <ScreenHeader
        showNotifications
        title="Study spots"
        status={loadMessage}
      />

      <ScreenTransition style={styles.transition}>
      {/* Same search band as Sessions: field plus its filter control on one
          row, with the options themselves behind the button. */}
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <SearchBar
            accessibilityLabel="Search study spots and sessions"
            onChangeText={setSearchQuery}
            placeholder="Search spots"
            value={searchQuery}
          />
        </View>
        <Pressable
          accessibilityLabel={
            activeFilterCount > 0 ? `Filters, ${activeFilterCount} applied` : 'Filters'
          }
          accessibilityRole="button"
          onPress={() => setFiltersOpen(true)}
          style={({ pressed }) => [
            styles.filterButton,
            {
              backgroundColor: activeFilterCount > 0 ? palette.tint : 'transparent',
              borderColor: activeFilterCount > 0 ? palette.tint : palette.outline,
              opacity: pressed ? 0.7 : 1,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}>
          <IconSymbol
            color={activeFilterCount > 0 ? '#FFFFFF' : palette.icon}
            name="slider.horizontal.3"
            size={20}
          />
          {activeFilterCount > 0 ? (
            <Text style={[TypeScale.label, styles.filterCount]}>{activeFilterCount}</Text>
          ) : null}
        </Pressable>
      </View>

      {activeFilterCount > 0 ? (
        <View style={styles.filterRow}>
          {activityFilters.map((filter) => (
            <FilterChip
              icon="xmark"
              key={filter}
              label={ACTIVITY_FILTERS.find((option) => option.id === filter)?.label ?? filter}
              onPress={() => toggleActivityFilter(filter)}
            />
          ))}
          {atmosphereFilters.map((tag) => (
            <FilterChip icon="xmark" key={tag} label={tag} onPress={() => toggleAtmosphereFilter(tag)} />
          ))}
        </View>
      ) : null}

      <View style={styles.mapAndSheet}>
        <CampusMap
          locations={locations}
          noResultsActionLabel={
            shouldOfferRequest ? 'Can’t find this spot? Send a request' : undefined
          }
          onOpenCampusMap={openCampusMap}
          onOpenLocation={handleOpenLocationFromMap}
          onNoResultsAction={
            shouldOfferRequest ? () => setRequestSheetOpen(true) : undefined
          }
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
              const isExpanded = expandedLocationId === location.locationId;
              const sessionCount = sessionsByLocation.get(location.locationId) ?? 0;
              const aggregate = ratingAggregates.get(location.locationId);
              const ownStars = ownRatings.get(location.locationId);

              return (
                <View
                  key={location.locationId}
                  ref={(node) => {
                    if (node) {
                      locationRowRefs.current.set(location.locationId, node);
                    } else {
                      locationRowRefs.current.delete(location.locationId);
                    }
                  }}>
                  <View
                    style={[
                      styles.locationListItem,
                      {
                        backgroundColor: isSelected ? palette.surfaceMuted : palette.background,
                        borderBottomColor: isSelected ? 'transparent' : palette.border,
                      },
                    ]}>
                    <View style={styles.locationListCopy}>
                      <View style={styles.locationNameRow}>
                        <Text
                          style={[TypeScale.bodyStrong, styles.locationNameText, { color: palette.text }]}>
                          {location.name}
                        </Text>
                        {/* Your own rating, called out separately from the
                            crowd average — otherwise there's nothing on the row
                            that distinguishes a spot you've rated from one you
                            haven't. */}
                        {ownStars !== undefined ? (
                          <View
                            style={[styles.ratedBadge, { backgroundColor: palette.surfaceMuted }]}>
                            <IconSymbol
                              color={colorScheme === 'dark' ? Brand.starDark : Brand.star}
                              name="star.fill"
                              size={11}
                            />
                            <Text style={[TypeScale.micro, { color: palette.text }]}>
                              You rated {ownStars}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {/* One line, always. The long form wrapped to three lines
                          and left "stars" hanging on its own. */}
                      <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
                        {[
                          location.campusArea,
                          `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`,
                          aggregate ? `★ ${aggregate.averageStars}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <View style={styles.locationListActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: isExpanded }}
                        onPress={() => toggleLocationDetails(location.locationId)}
                        style={({ pressed }) => [
                          styles.locationListButton,
                          pressed && styles.pressed,
                        ]}>
                        <Text style={[TypeScale.label, { color: palette.tint }]}>Details</Text>
                        <MaterialIcons
                          color={palette.tint}
                          name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                          size={20}
                        />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          ownStars !== undefined
                            ? `Edit your ${ownStars} star rating for ${location.name}`
                            : `Rate ${location.name}`
                        }
                        onPress={() => rateLocation(location)}
                        style={({ pressed }) => [
                          styles.locationListButton,
                          pressed && styles.pressed,
                        ]}>
                        <Text style={[TypeScale.label, { color: palette.tint }]}>
                          {ownStars !== undefined ? 'Edit' : 'Rate'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                  {/* Details expand under the spot they belong to, so the row you
                      tapped stays on screen next to its own information. */}
                  {isExpanded ? renderLocationDetails() : null}
                </View>
              );
            })}
          </View>

          {!searchQuery.trim() ? (
            <View style={[styles.catalogRequestFooter, { borderTopColor: palette.border }]}>
              <CatalogRequestLink
                context="catalog"
                type="location"
                onPress={() => setRequestSheetOpen(true)}
              />
            </View>
          ) : null}

          </View>
        ) : !isLoading ? (
          <EmptyState
            icon="spot"
            headline={searchQuery.trim() ? 'No study spots found' : 'No study spots available'}
            body={
              shouldOfferRequest
                ? 'We may be missing this spot.\nSend us a request and we’ll review it.'
                : 'Try clearing the current filters.'
            }
            actionLabel={shouldOfferRequest ? undefined : 'Clear filters'}
            onAction={shouldOfferRequest ? undefined : clearFilters}
            style={styles.noPinsState}
          />
        ) : null}
      </View>
      </ScreenTransition>
    </ScrollView>

    <PullToRefreshIndicator pullDistance={pullDistance} refreshing={isRefreshing} />

    <CatalogRequestSheet
      initialQuery={searchQuery}
      onClose={() => setRequestSheetOpen(false)}
      source="explore-location"
      type="location"
      visible={requestSheetOpen}
    />

    <Sheet
      visible={filtersOpen}
      onClose={() => setFiltersOpen(false)}
      title="Filters"
      subtitle={`${filteredLocations.length} of ${locations.length} spots shown`}
      footer={
        <View style={styles.filterFooter}>
          <Button
            label="Clear all"
            variant="secondary"
            onPress={clearSpotFilters}
            disabled={activeFilterCount === 0}
            style={styles.filterFooterButton}
          />
          <Button
            label="Show results"
            onPress={() => setFiltersOpen(false)}
            style={styles.filterFooterButton}
          />
        </View>
      }>
      <View style={styles.filterGroup}>
        <Text style={[TypeScale.label, { color: palette.icon }]}>Activity</Text>
        <View style={styles.filterGroupRow}>
          {ACTIVITY_FILTERS.map((filter) => (
            <FilterChip
              icon={filter.icon}
              key={filter.id}
              label={filter.label}
              onPress={() => toggleActivityFilter(filter.id)}
              selected={activityFilters.includes(filter.id)}
            />
          ))}
        </View>
      </View>

      <View style={styles.filterGroup}>
        <Text style={[TypeScale.label, { color: palette.icon }]}>Atmosphere</Text>
        <View style={styles.filterGroupRow}>
          {ATMOSPHERE_FILTERS.map((tag) => (
            <FilterChip
              key={tag}
              label={tag}
              onPress={() => toggleAtmosphereFilter(tag)}
              selected={atmosphereFilters.includes(tag)}
            />
          ))}
        </View>
      </View>
    </Sheet>
    </>
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
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
  },
  searchField: {
    flex: 1,
  },
  filterButton: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.xs,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  filterCount: {
    color: '#FFFFFF',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  filterGroup: {
    gap: Space.sm,
  },
  filterGroupRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  filterFooter: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  filterFooterButton: {
    flex: 1,
  },
  mapAndSheet: {
    gap: Space.md,
  },
  resultsStack: {
    gap: Space.md,
  },
  catalogRequestFooter: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Space.md,
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
  locationNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  locationNameText: {
    flexShrink: 1,
  },
  ratedBadge: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
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
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Space.sm,
  },
  // Inline expansion under the selected row — a recessed surface rather than a
  // floating sheet, so it reads as part of the list.
  locationDetails: {
    gap: Space.md,
    paddingBottom: Space.lg,
    paddingHorizontal: Space.md + 2,
    paddingTop: Space.xs,
  },
  detailsActions: {
    flexDirection: 'row',
    gap: Space.sm,
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
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Space.sm,
    justifyContent: 'space-between',
    paddingTop: Space.md,
  },
  hostLink: {
    paddingVertical: Space.xs,
  },
  pressed: {
    opacity: 0.72,
  },
});
