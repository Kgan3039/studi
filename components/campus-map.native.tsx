import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LatLng } from 'react-native-maps';

import {
  Brand,
  Colors,
  Elevation,
  Radius,
  Space,
  TypeScale,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { canonicalStudyLocationId } from '@/lib/catalog';
import type { StudyLocation } from '@/lib/firestore';
import {
  ANDROID_TRACK_REFRESH_MS,
  buildCampusMarkerEntries,
  isRenderableCoordinate,
  markerAppearanceSignature,
  planCampusMarkers,
} from '@/lib/map-markers';
import type { MapSessionTiming } from '@/components/campus-map.types';

type CampusMapProps = {
  locations: StudyLocation[];
  onOpenCampusMap: () => void;
  onSelectLocation: (locationId: string) => void;
  selectedLocationId: string | null;
  sessionTimingByLocation: Map<string, MapSessionTiming>;
  sessionsByLocation: Map<string, number>;
  visibleLocationIds: Set<string>;
};

const CAMPUS_REGION = {
  latitude: 43.0747,
  latitudeDelta: 0.012,
  longitude: -89.414,
  longitudeDelta: 0.041,
};

const MAP_PADDING = { bottom: 24, left: 8, right: 8, top: 8 };
const FIT_PADDING = { bottom: 64, left: 44, right: 44, top: 64 };

function markerCoordinate(location: StudyLocation): LatLng | null {
  if (!isRenderableCoordinate(location.coordinates)) {
    return null;
  }

  if (location.locationId === 'college-library-cafe') {
    return {
      latitude: location.coordinates.latitude - 0.00022,
      longitude: location.coordinates.longitude + 0.00018,
    };
  }

  return location.coordinates;
}

function getTimingColor(timing: MapSessionTiming, tint: string, icon: string) {
  switch (timing) {
    case 'live':
      return tint;
    case 'soon':
      return Brand.warning;
    case 'later':
      return Brand.info;
    default:
      return icon;
  }
}

type CampusMapMarkerProps = {
  coordinate: LatLng;
  isSelected: boolean;
  isVisible: boolean;
  location: StudyLocation;
  onSelectLocation: (locationId: string) => void;
  palette: (typeof Colors)[keyof typeof Colors];
  sessionCount: number;
  timing: MapSessionTiming;
};

// Markers stay mounted for the whole location set; search, filters, and
// selection only flip scalar props and styles. Under the Fabric legacy
// interop, AIRMap's native child array must never see structural churn:
// remount-by-key crashed it, and so does a changing zIndex — Fabric sorts
// absolute-positioned siblings by zIndex and emits remove/insert mutations
// to reorder them (verified via crash reports; see PR #54). So: no zIndex,
// no key churn, no conditional children, and an identical subtree shape in
// every state.
const IS_ANDROID = Platform.OS === 'android';

const CampusMapMarker = memo(function CampusMapMarker({
  coordinate,
  isSelected,
  isVisible,
  location,
  onSelectLocation,
  palette,
  sessionCount,
  timing,
}: CampusMapMarkerProps) {
  const timingColor = getTimingColor(timing, palette.tint, palette.icon);

  // Android redraws tracked custom markers on a ~40 ms loop, so tracking is
  // only pulsed on for a bounded window when the rendered appearance (or the
  // native position, e.g. a hidden marker relocating) actually changes, then
  // switched back off. iOS Apple Maps ignores the prop entirely, so it stays
  // a constant false there. The toggle is a prop update only — same key,
  // same child position, identical subtree.
  const appearanceSignature = markerAppearanceSignature({
    isSelected,
    isVisible,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    sessionCount,
    theme: `${palette.surface}|${palette.border}|${palette.tint}|${palette.icon}`,
    timing,
  });
  const [tracksViewChanges, setTracksViewChanges] = useState(IS_ANDROID);

  useEffect(() => {
    if (!IS_ANDROID) {
      return;
    }

    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), ANDROID_TRACK_REFRESH_MS);

    // Restarts the window on rapid changes and prevents any state update
    // after unmount — the pending timer is always cleared first.
    return () => clearTimeout(timer);
  }, [appearanceSignature]);

  const handlePress = useCallback(() => {
    // Hidden markers are relocated off-campus and never selectable, but keep
    // the guard so a tap racing a visibility change cannot select one.
    if (isVisible) {
      onSelectLocation(location.locationId);
    }
  }, [isVisible, location.locationId, onSelectLocation]);

  return (
    <Marker
      anchor={{ x: 0.5, y: 0.5 }}
      accessibilityElementsHidden={!isVisible}
      accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}, ${timing === 'live' ? 'happening now' : timing === 'soon' ? 'starting soon' : timing === 'later' ? 'later' : 'no scheduled sessions'}`}
      coordinate={coordinate}
      identifier={location.locationId}
      onPress={handlePress}
      opacity={isVisible ? 1 : 0}
      tracksViewChanges={tracksViewChanges}>
      {/* collapsable={false} keeps Fabric from flattening/unflattening these
          views as their styles change, so the marker's native subtree shape
          is identical in every state. */}
      <View collapsable={false} style={styles.markerTouchTarget}>
        <View
          collapsable={false}
          style={[
            styles.markerHalo,
            {
              backgroundColor: isSelected ? `${timingColor}20` : 'transparent',
            },
          ]}>
          <View
            collapsable={false}
            style={[
              styles.markerCore,
              isSelected && styles.markerCoreSelected,
              Elevation.e1,
              {
                backgroundColor: palette.surface,
                borderColor: isSelected ? timingColor : palette.border,
              },
            ]}>
            <View
              collapsable={false}
              style={[
                styles.markerStatus,
                isSelected && styles.markerStatusSelected,
                { backgroundColor: timingColor },
              ]}
            />
          </View>
        </View>
      </View>
    </Marker>
  );
});

export function CampusMap({
  locations,
  onOpenCampusMap,
  onSelectLocation,
  selectedLocationId,
  sessionTimingByLocation,
  sessionsByLocation,
  visibleLocationIds,
}: CampusMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [isMapReady, setIsMapReady] = useState(false);

  // One entry per canonical location id, in canonical-id order, valid
  // coordinates only — MapView's direct children are exactly this list and
  // nothing else, so the native child array stays deterministic.
  const markers = useMemo(
    () =>
      buildCampusMarkerEntries(locations, { canonicalize: canonicalStudyLocationId }).flatMap(
        ({ canonicalId, location }) => {
          const coordinate = markerCoordinate(location);

          return coordinate ? [{ canonicalId, coordinate, location }] : [];
        }
      ),
    [locations]
  );

  // Same-length, same-order, same-key list on every render: hidden markers
  // are relocated off-campus (renderCoordinate) instead of unmounted, and
  // only visible markers feed the camera fit.
  const markerPlan = useMemo(
    () => planCampusMarkers(markers, visibleLocationIds),
    [markers, visibleLocationIds]
  );

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    const seenKeys = new Set<string>();

    for (const { canonicalId, location } of markers) {
      if (seenKeys.has(canonicalId)) {
        console.error(
          `[CampusMap] Duplicate marker key "${canonicalId}" (source id "${location.locationId}"). ` +
            'Marker keys must be unique or AIRMap child indexes diverge.'
        );
      }
      seenKeys.add(canonicalId);
    }

    console.log(
      '[CampusMap] markers',
      markers.map(({ canonicalId, coordinate, location }) => ({
        key: canonicalId,
        sourceId: location.locationId,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        selected: selectedLocationId === location.locationId,
      }))
    );
  }, [markers, selectedLocationId]);

  const fitVisibleMarkers = useCallback(() => {
    const { fitCoordinates } = markerPlan;

    if (!isMapReady || fitCoordinates.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      try {
        if (fitCoordinates.length === 1) {
          mapRef.current?.animateToRegion(
            {
              ...fitCoordinates[0],
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            },
            180
          );
          return;
        }

        mapRef.current?.fitToCoordinates(fitCoordinates, {
          animated: true,
          edgePadding: FIT_PADDING,
        });
      } catch {
        // Native maps can reject camera updates while mounting or unmounting;
        // leaving the current region is safer than letting search/filter crash.
      }
    });
  }, [isMapReady, markerPlan]);

  useEffect(() => {
    fitVisibleMarkers();
  }, [fitVisibleMarkers]);

  return (
    <View
      accessibilityLabel="Interactive campus study spot map"
      style={[styles.frame, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
      <MapView
        ref={mapRef}
        initialRegion={CAMPUS_REGION}
        loadingBackgroundColor={palette.surfaceMuted}
        loadingEnabled
        loadingIndicatorColor={palette.tint}
        mapPadding={MAP_PADDING}
        mapType="standard"
        maxZoomLevel={19}
        minZoomLevel={12}
        moveOnMarkerPress={false}
        onMapReady={() => setIsMapReady(true)}
        pitchEnabled={false}
        rotateEnabled={false}
        showsBuildings
        showsCompass={false}
        showsIndoors
        showsPointsOfInterest
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
        userInterfaceStyle={colorScheme}>
        {markerPlan.markers.map(({ canonicalId, isVisible, location, renderCoordinate }) => (
          <CampusMapMarker
            key={canonicalId}
            coordinate={renderCoordinate}
            isSelected={selectedLocationId === location.locationId}
            isVisible={isVisible}
            location={location}
            onSelectLocation={onSelectLocation}
            palette={palette}
            sessionCount={sessionsByLocation.get(location.locationId) ?? 0}
            timing={sessionTimingByLocation.get(location.locationId) ?? 'none'}
          />
        ))}
      </MapView>

      {markerPlan.fitCoordinates.length === 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.emptyOverlay,
            Elevation.e1,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}>
          <Text style={[TypeScale.label, { color: palette.text }]}>No matching pins</Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            Clear search or try another filter.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="link"
        onPress={onOpenCampusMap}
        style={({ pressed }) => [
          styles.uwMapButton,
          Elevation.e1,
          { backgroundColor: palette.surface, opacity: pressed ? 0.72 : 1 },
        ]}>
        <Text style={[TypeScale.label, { color: palette.text }]}>UW layers</Text>
        <MaterialIcons color={palette.icon} name="open-in-new" size={15} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: Radius.xxl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 420,
    overflow: 'hidden',
    position: 'relative',
  },
  emptyOverlay: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: 2,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    position: 'absolute',
    top: Space.lg,
  },
  markerCore: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  markerCoreSelected: {
    borderWidth: 1.5,
    height: 24,
    width: 24,
  },
  markerHalo: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  markerStatus: {
    borderRadius: Radius.pill,
    height: 7,
    width: 7,
  },
  markerStatusSelected: {
    height: 9,
    width: 9,
  },
  markerTouchTarget: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  uwMapButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    bottom: Space.xxl + Space.sm,
    flexDirection: 'row',
    gap: Space.xs,
    left: Space.md,
    minHeight: 36,
    paddingHorizontal: Space.md,
    position: 'absolute',
  },
});
