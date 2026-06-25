import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Callout, Marker, type LatLng } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { UW_STUDY_LOCATIONS } from '@/data/uw-study-locations';
import { useColorScheme } from '@/hooks/use-color-scheme';

type DebugStage =
  | 'minimal'
  | 'real-data'
  | 'timing-colors'
  | 'selected-state'
  | 'bottom-card'
  | 'delayed-selection'
  | 'callout';

type DebugMarker = {
  id: string;
  coordinate: LatLng;
  name: string;
  timing: 'live' | 'soon' | 'later' | 'none';
};

const CAMPUS_REGION = {
  latitude: 43.0747,
  latitudeDelta: 0.012,
  longitude: -89.414,
  longitudeDelta: 0.041,
};

const STAGES: { id: DebugStage; label: string; detail: string }[] = [
  {
    id: 'minimal',
    label: '1. Minimal',
    detail: 'Three hardcoded default markers with direct onPress setState.',
  },
  {
    id: 'real-data',
    label: '2. Real data',
    detail: 'UW locations, default markers, direct onPress setState.',
  },
  {
    id: 'timing-colors',
    label: '3. Colors',
    detail: 'Real locations with default marker pinColor.',
  },
  {
    id: 'selected-state',
    label: '4. Selected',
    detail: 'Adds selected marker color/zIndex only. No custom marker children.',
  },
  {
    id: 'bottom-card',
    label: '5. Card',
    detail: 'Updates a local bottom card when marker is pressed.',
  },
  {
    id: 'delayed-selection',
    label: '6. Delayed',
    detail: 'Defers selection state with requestAnimationFrame.',
  },
  {
    id: 'callout',
    label: '7. Callout',
    detail: 'Uses native Callout instead of an app bottom-card update.',
  },
];

const MINIMAL_MARKERS: DebugMarker[] = [
  {
    id: 'minimal-college',
    coordinate: { latitude: 43.0766969, longitude: -89.4013466 },
    name: 'College Library',
    timing: 'live',
  },
  {
    id: 'minimal-wendt',
    coordinate: { latitude: 43.0714672, longitude: -89.4086535 },
    name: 'Wendt Commons',
    timing: 'soon',
  },
  {
    id: 'minimal-union',
    coordinate: { latitude: 43.0718561, longitude: -89.4080738 },
    name: 'Union South',
    timing: 'later',
  },
];

function timingForIndex(index: number): DebugMarker['timing'] {
  return index % 4 === 0 ? 'live' : index % 4 === 1 ? 'soon' : index % 4 === 2 ? 'later' : 'none';
}

function markerColor(
  timing: DebugMarker['timing'],
  selected: boolean,
  tint: string
) {
  if (selected) {
    return tint;
  }

  switch (timing) {
    case 'live':
      return tint;
    case 'soon':
      return '#B7791F';
    case 'later':
      return '#2563EB';
    default:
      return '#6B7280';
  }
}

export default function DebugMapPinsNative() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<DebugStage>('minimal');
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [tapCount, setTapCount] = useState(0);
  const [lastEvent, setLastEvent] = useState('No marker taps yet.');

  const markers = useMemo<DebugMarker[]>(() => {
    if (stage === 'minimal') {
      return MINIMAL_MARKERS;
    }

    return UW_STUDY_LOCATIONS.map((location, index) => ({
      id: location.locationId,
      coordinate:
        location.locationId === 'college-library-cafe'
          ? {
              latitude: location.coordinates.latitude - 0.00022,
              longitude: location.coordinates.longitude + 0.00018,
            }
          : location.coordinates,
      name: location.name,
      timing: timingForIndex(index),
    }));
  }, [stage]);

  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
  const stageConfig = STAGES.find((item) => item.id === stage) ?? STAGES[0];
  const usesTimingColors =
    stage === 'timing-colors' ||
    stage === 'selected-state' ||
    stage === 'bottom-card' ||
    stage === 'delayed-selection' ||
    stage === 'callout';
  const usesSelectedVisual =
    stage === 'selected-state' || stage === 'bottom-card' || stage === 'delayed-selection';

  function recordMarkerPress(marker: DebugMarker) {
    const nextTapCount = tapCount + 1;
    setTapCount(nextTapCount);
    setLastEvent(`${nextTapCount}. ${marker.name}`);

    if (stage === 'callout') {
      return;
    }

    if (stage === 'delayed-selection') {
      requestAnimationFrame(() => setSelectedMarkerId(marker.id));
      return;
    }

    setSelectedMarkerId(marker.id);
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Space.md }]}>
      <View style={styles.header}>
        <Text style={[TypeScale.title, { color: palette.text }]}>Map pin crash debugger</Text>
        <Text style={[TypeScale.body, { color: palette.icon }]}>
          Tap every marker repeatedly at each step. The first crashing step identifies the unstable
          behavior.
        </Text>
      </View>

      <View style={styles.stageGrid}>
        {STAGES.map((item) => {
          const isSelected = item.id === stage;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              key={item.id}
              onPress={() => {
                setStage(item.id);
                setSelectedMarkerId(null);
                setTapCount(0);
                setLastEvent(`Switched to ${item.label}`);
              }}
              style={({ pressed }) => [
                styles.stageButton,
                {
                  backgroundColor: isSelected ? palette.tint : palette.surface,
                  borderColor: isSelected ? palette.tint : palette.border,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}>
              <Text style={[TypeScale.label, { color: isSelected ? '#FFFFFF' : palette.text }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text style={[TypeScale.bodyStrong, { color: palette.text }]}>{stageConfig.label}</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{stageConfig.detail}</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>Last event: {lastEvent}</Text>
      </View>

      <View style={[styles.mapFrame, { borderColor: palette.border }]}>
        <MapView
          initialRegion={CAMPUS_REGION}
          mapType="standard"
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
          {markers.map((marker) => {
            const isSelected = marker.id === selectedMarkerId;

            return (
              <Marker
                coordinate={marker.coordinate}
                identifier={marker.id}
                key={marker.id}
                onPress={() => recordMarkerPress(marker)}
                pinColor={usesTimingColors ? markerColor(marker.timing, isSelected, palette.tint) : undefined}
                title={marker.name}
                zIndex={usesSelectedVisual && isSelected ? 2 : 1}>
                {stage === 'callout' ? (
                  <Callout>
                    <View style={styles.callout}>
                      <Text>{marker.name}</Text>
                    </View>
                  </Callout>
                ) : null}
              </Marker>
            );
          })}
        </MapView>
      </View>

      {stage === 'bottom-card' || stage === 'delayed-selection' ? (
        <View style={[styles.panel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Selected marker</Text>
          <Text style={[TypeScale.heading, { color: palette.text }]}>
            {selectedMarker?.name ?? 'Tap a marker'}
          </Text>
          <Text style={[TypeScale.caption, { color: palette.icon }]}>
            This card intentionally mirrors the production bottom-sheet state update.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: Space.md,
    padding: Space.lg,
    paddingBottom: Space.xxl,
  },
  header: {
    gap: Space.xs,
  },
  stageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  stageButton: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    minHeight: 38,
    paddingHorizontal: Space.md,
    justifyContent: 'center',
  },
  panel: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: Space.xs,
    padding: Space.md,
  },
  mapFrame: {
    borderRadius: Radius.xxl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 420,
    overflow: 'hidden',
  },
  callout: {
    maxWidth: 180,
    padding: Space.xs,
  },
});
