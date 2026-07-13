import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { buildCampusMarkerEntries, isRenderableCoordinate } from '@/lib/map-markers';
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

// How long a marker keeps tracksViewChanges on after its appearance changes.
// Long enough for iOS to re-snapshot the custom view, short enough to keep
// the map cheap while idle.
const TRACK_APPEARANCE_MS = 350;

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

// Markers stay mounted for the whole location set; search and filters only
// flip isVisible/appearance. AIRMap's native child array must never see
// churn from filtering — remount-by-key is what crashed the map under the
// Fabric interop, so selection/timing may only change props here.
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
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  // iOS snapshots custom marker views once tracksViewChanges turns off, so
  // pulse it back on whenever the rendered appearance changes.
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => setTracksViewChanges(false), TRACK_APPEARANCE_MS);

    return () => clearTimeout(timer);
  }, [isSelected, isVisible, timingColor, palette.surface, palette.border]);

  const handlePress = useCallback(() => {
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
      tracksViewChanges={tracksViewChanges}
      zIndex={isSelected ? 4 : sessionCount > 0 ? 3 : 2}>
      <View style={styles.markerTouchTarget}>
        <View
          style={[
            styles.markerHalo,
            {
              backgroundColor: isSelected ? `${timingColor}20` : 'transparent',
            },
          ]}>
          <View
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

  const visibleMarkers = useMemo(
    () => markers.filter((marker) => visibleLocationIds.has(marker.location.locationId)),
    [markers, visibleLocationIds]
  );

  const fitVisibleMarkers = useCallback(() => {
    if (!isMapReady || visibleMarkers.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      try {
        if (visibleMarkers.length === 1) {
          mapRef.current?.animateToRegion(
            {
              ...visibleMarkers[0].coordinate,
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            },
            180
          );
          return;
        }

        mapRef.current?.fitToCoordinates(
          visibleMarkers.map((marker) => marker.coordinate),
          { animated: true, edgePadding: FIT_PADDING }
        );
      } catch {
        // Native maps can reject camera updates while mounting or unmounting;
        // leaving the current region is safer than letting search/filter crash.
      }
    });
  }, [isMapReady, visibleMarkers]);

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
        {markers.map(({ canonicalId, coordinate, location }) => (
          <CampusMapMarker
            key={canonicalId}
            coordinate={coordinate}
            isSelected={selectedLocationId === location.locationId}
            isVisible={visibleLocationIds.has(location.locationId)}
            location={location}
            onSelectLocation={onSelectLocation}
            palette={palette}
            sessionCount={sessionsByLocation.get(location.locationId) ?? 0}
            timing={sessionTimingByLocation.get(location.locationId) ?? 'none'}
          />
        ))}
      </MapView>

      {visibleMarkers.length === 0 ? (
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
