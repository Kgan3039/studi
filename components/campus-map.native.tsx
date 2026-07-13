import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { StudyLocation } from '@/lib/firestore';
import type { MapSessionTiming } from '@/components/campus-map.types';

type CampusMapProps = {
  locations: StudyLocation[];
  onOpenCampusMap: () => void;
  onSelectLocation: (locationId: string) => void;
  selectedLocationId: string | null;
  sessionTimingByLocation: Map<string, MapSessionTiming>;
  sessionsByLocation: Map<string, number>;
};

const CAMPUS_REGION = {
  latitude: 43.0747,
  latitudeDelta: 0.012,
  longitude: -89.414,
  longitudeDelta: 0.041,
};

const MAP_PADDING = { bottom: 24, left: 8, right: 8, top: 8 };
const FIT_PADDING = { bottom: 64, left: 44, right: 44, top: 64 };

function isUsableCoordinate(coordinate: StudyLocation['coordinates'] | undefined) {
  const latitude = coordinate?.latitude;
  const longitude = coordinate?.longitude;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return false;
  }

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

function markerCoordinate(location: StudyLocation): LatLng | null {
  if (!isUsableCoordinate(location.coordinates)) {
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

export function CampusMap({
  locations,
  onOpenCampusMap,
  onSelectLocation,
  selectedLocationId,
  sessionTimingByLocation,
  sessionsByLocation,
}: CampusMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [isMapReady, setIsMapReady] = useState(false);
  const markers = useMemo(
    () =>
      locations.flatMap((location) => {
        const coordinate = markerCoordinate(location);

        if (!coordinate) {
          return [];
        }

        return [
          {
            coordinate,
            location,
            sessionCount: sessionsByLocation.get(location.locationId) ?? 0,
            timing: sessionTimingByLocation.get(location.locationId) ?? 'none',
          },
        ];
      }),
    [locations, sessionTimingByLocation, sessionsByLocation]
  );

  const fitVisibleMarkers = useCallback(() => {
    if (!isMapReady || markers.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      try {
        if (markers.length === 1) {
          mapRef.current?.animateToRegion(
            {
              ...markers[0].coordinate,
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            },
            180
          );
          return;
        }

        mapRef.current?.fitToCoordinates(
          markers.map((marker) => marker.coordinate),
          { animated: true, edgePadding: FIT_PADDING }
        );
      } catch {
        // Native maps can reject camera updates while mounting or unmounting;
        // leaving the current region is safer than letting search/filter crash.
      }
    });
  }, [isMapReady, markers]);

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
        {markers.map(({ coordinate, location, sessionCount, timing }) => {
          const isSelected = selectedLocationId === location.locationId;
          const timingColor = getTimingColor(timing, palette.tint, palette.icon);

          return (
            <Marker
              anchor={{ x: 0.5, y: 0.5 }}
              accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}, ${timing === 'live' ? 'happening now' : timing === 'soon' ? 'starting soon' : timing === 'later' ? 'later' : 'no scheduled sessions'}`}
              coordinate={coordinate}
              identifier={location.locationId}
              key={`${location.locationId}-${isSelected ? 'selected' : 'idle'}-${timing}`}
              onPress={() => onSelectLocation(location.locationId)}
              tracksViewChanges={false}
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
        })}
      </MapView>

      {markers.length === 0 ? (
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
