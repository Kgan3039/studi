import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LatLng } from 'react-native-maps';

import {
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
  sessionTimingByLocation,
  sessionsByLocation,
}: CampusMapProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const markers = useMemo(
    () =>
      locations.map((location) => ({
        coordinate: markerCoordinate(location),
        location,
        sessionCount: sessionsByLocation.get(location.locationId) ?? 0,
        timing: sessionTimingByLocation.get(location.locationId) ?? 'none',
      })),
    [locations, sessionTimingByLocation, sessionsByLocation]
  );

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
          return (
            <Marker
              accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}, ${timing === 'live' ? 'happening now' : timing === 'soon' ? 'starting soon' : timing === 'later' ? 'later' : 'no scheduled sessions'}`}
              coordinate={coordinate}
              identifier={location.locationId}
              key={location.locationId}
              onPress={() => onSelectLocation(location.locationId)}
              title={location.name}>
            </Marker>
          );
        })}
      </MapView>

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
