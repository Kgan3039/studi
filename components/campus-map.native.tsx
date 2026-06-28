import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LatLng } from 'react-native-maps';

import {
  Brand,
  Colors,
  Elevation,
  FontFamily,
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

const TIMING_LABELS: { timing: Exclude<MapSessionTiming, 'none'>; label: string }[] = [
  { timing: 'live', label: 'Now' },
  { timing: 'soon', label: 'Soon' },
  { timing: 'later', label: 'Later' },
];

const CAMPUS_REGION = {
  latitude: 43.0747,
  latitudeDelta: 0.012,
  longitude: -89.414,
  longitudeDelta: 0.041,
};

const MAP_PADDING = { bottom: 24, left: 8, right: 8, top: 8 };
const PIN_EDGE_PADDING = { bottom: 48, left: 36, right: 36, top: 48 };

function markerCoordinate(location: StudyLocation): LatLng {
  if (location.locationId === 'college-library-cafe') {
    return {
      latitude: location.coordinates.latitude - 0.00022,
      longitude: location.coordinates.longitude + 0.00018,
    };
  }

  return location.coordinates;
}

export function CampusMap({
  locations,
  onOpenCampusMap,
  sessionTimingByLocation,
  sessionsByLocation,
}: CampusMapProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const mapRef = useRef<MapView | null>(null);
  const hasLaidOut = useRef(false);

  const fitVisiblePins = useCallback(
    (animated = true) => {
      const coordinates = locations.map(markerCoordinate);

      if (!mapRef.current || coordinates.length === 0) {
        return;
      }

      if (coordinates.length === 1) {
        return;
      }

      try {
        mapRef.current.fitToCoordinates(coordinates, {
          animated,
          edgePadding: PIN_EDGE_PADDING,
        });
      } catch (error) {
        console.warn('Unable to fit campus map pins.', error);
      }
    },
    [locations]
  );

  useEffect(() => {
    if (!hasLaidOut.current) {
      return;
    }

    const timeout = setTimeout(() => fitVisiblePins(), 80);
    return () => clearTimeout(timeout);
  }, [fitVisiblePins]);

  return (
    <View
      accessibilityLabel="Campus study spot map"
      style={[styles.frame, { backgroundColor: palette.surfaceMuted, borderColor: palette.border }]}>
      <MapView
        initialRegion={CAMPUS_REGION}
        loadingBackgroundColor={palette.surfaceMuted}
        loadingEnabled
        loadingIndicatorColor={palette.tint}
        mapPadding={MAP_PADDING}
        mapType="standard"
        maxZoomLevel={19}
        minZoomLevel={12}
        moveOnMarkerPress={false}
        onLayout={() => {
          hasLaidOut.current = true;
          fitVisiblePins(false);
        }}
        pitchEnabled={false}
        ref={mapRef}
        rotateEnabled={false}
        showsBuildings
        showsCompass={false}
        showsIndoors
        showsPointsOfInterest
        style={StyleSheet.absoluteFill}
        toolbarEnabled={false}
        userInterfaceStyle={colorScheme}>
        {locations.map((location) => {
          const sessionCount = sessionsByLocation.get(location.locationId) ?? 0;
          const timing = sessionTimingByLocation.get(location.locationId) ?? 'none';
          const timingColor =
            timing === 'live'
              ? palette.tint
              : timing === 'soon'
                ? Brand.warning
                : timing === 'later'
                  ? Brand.info
                  : palette.icon;

          return (
            <Marker
              accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}, ${timing === 'live' ? 'happening now' : timing === 'soon' ? 'starting soon' : timing === 'later' ? 'later' : 'no scheduled sessions'}`}
              coordinate={markerCoordinate(location)}
              identifier={location.locationId}
              key={location.locationId}
              pinColor={timingColor}
              tappable={false}
              zIndex={sessionCount > 0 ? 2 : 1}
            />
          );
        })}
      </MapView>

      <View
        accessible
        accessibilityLabel="Map colors: red is happening now, gold is starting soon, blue is later"
        style={[styles.legend, Elevation.e1, { backgroundColor: palette.surface }]}>
        {TIMING_LABELS.map(({ timing, label }) => (
          <View key={timing} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                {
                  backgroundColor:
                    timing === 'live'
                      ? palette.tint
                      : timing === 'soon'
                        ? Brand.warning
                        : Brand.info,
                },
              ]}
            />
            <Text style={[styles.legendText, { color: palette.icon }]}>{label}</Text>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityLabel="Show all visible study spots"
        accessibilityRole="button"
        onPress={() => fitVisiblePins()}
        style={({ pressed }) => [
          styles.mapButton,
          styles.recenterButton,
          Elevation.e1,
          { backgroundColor: palette.surface, opacity: pressed ? 0.72 : 1 },
        ]}>
        <MaterialIcons color={palette.text} name="center-focus-strong" size={20} />
      </Pressable>

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
  legend: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: Space.sm,
    left: Space.md,
    minHeight: 34,
    paddingHorizontal: Space.md,
    position: 'absolute',
    top: Space.md,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  legendDot: {
    borderRadius: Radius.pill,
    height: 7,
    width: 7,
  },
  legendText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 10,
    lineHeight: 13,
  },
  mapButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 42,
    justifyContent: 'center',
    position: 'absolute',
    width: 42,
  },
  recenterButton: {
    right: Space.md,
    top: Space.md,
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
