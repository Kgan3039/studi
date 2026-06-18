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

type CampusMapProps = {
  locations: StudyLocation[];
  onOpenCampusMap: () => void;
  onSelectLocation: (locationId: string) => void;
  selectedLocationId: string | null;
  sessionsByLocation: Map<string, number>;
};

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
  onSelectLocation,
  selectedLocationId,
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
        mapRef.current.animateToRegion(
          {
            ...coordinates[0],
            latitudeDelta: 0.006,
            longitudeDelta: 0.006,
          },
          animated ? 260 : 0
        );
        return;
      }

      mapRef.current.fitToCoordinates(coordinates, {
        animated,
        edgePadding: PIN_EDGE_PADDING,
      });
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

  function handleSelectLocation(location: StudyLocation) {
    onSelectLocation(location.locationId);
    mapRef.current?.animateToRegion(
      {
        ...markerCoordinate(location),
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      },
      220
    );
  }

  return (
    <View
      accessibilityLabel="Interactive campus study spot map"
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
          const isSelected = selectedLocationId === location.locationId;
          const sessionCount = sessionsByLocation.get(location.locationId) ?? 0;
          const isEmphasized = isSelected || sessionCount > 0;

          return (
            <Marker
              accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}`}
              coordinate={markerCoordinate(location)}
              identifier={location.locationId}
              key={location.locationId}
              onPress={() => handleSelectLocation(location)}
              zIndex={isSelected ? 3 : sessionCount > 0 ? 2 : 1}>
              <View style={styles.markerWrap}>
                <View
                  style={[
                    styles.marker,
                    isEmphasized ? styles.markerLarge : styles.markerSmall,
                    Elevation.e2,
                    {
                      backgroundColor: isSelected
                        ? palette.tint
                        : sessionCount > 0
                          ? Brand.text
                          : palette.surface,
                      borderColor: isSelected ? palette.tint : palette.surface,
                      transform: [{ scale: isSelected ? 1.12 : 1 }],
                    },
                  ]}>
                  <Text
                    style={[
                      styles.markerText,
                      { color: isSelected || sessionCount > 0 ? '#FFFFFF' : palette.icon },
                    ]}>
                    {sessionCount > 0 ? sessionCount : '·'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.markerStem,
                    !isEmphasized && styles.markerStemSmall,
                    {
                      backgroundColor: isSelected
                        ? palette.tint
                        : sessionCount > 0
                          ? Brand.text
                          : palette.icon,
                    },
                  ]}
                />
              </View>
            </Marker>
          );
        })}
      </MapView>

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
  markerWrap: {
    alignItems: 'center',
    minWidth: 38,
    paddingBottom: 2,
  },
  marker: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 2,
    justifyContent: 'center',
  },
  markerLarge: {
    height: 34,
    minWidth: 34,
    paddingHorizontal: Space.sm,
  },
  markerSmall: {
    height: 24,
    minWidth: 24,
    paddingHorizontal: Space.xs,
  },
  markerText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  markerStem: {
    borderRadius: Radius.pill,
    height: 9,
    marginTop: -1,
    width: 3,
  },
  markerStemSmall: {
    height: 6,
    width: 2,
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
