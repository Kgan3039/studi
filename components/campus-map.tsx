import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MapSessionTiming } from '@/components/campus-map.types';
import { Brand, Colors, Elevation, FontFamily, Radius, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StudyLocation } from '@/lib/firestore';

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

const CAMPUS_BUILDINGS = [
  { height: '15%', left: '5%', top: '17%', width: '18%' },
  { height: '11%', left: '29%', top: '12%', width: '15%' },
  { height: '18%', left: '51%', top: '15%', width: '20%' },
  { height: '12%', left: '76%', top: '12%', width: '17%' },
  { height: '13%', left: '14%', top: '47%', width: '17%' },
  { height: '15%', left: '40%', top: '42%', width: '16%' },
  { height: '18%', left: '67%', top: '48%', width: '14%' },
  { height: '12%', left: '8%', top: '73%', width: '20%' },
  { height: '13%', left: '37%', top: '72%', width: '17%' },
  { height: '12%', left: '73%', top: '75%', width: '19%' },
] as const;

function getSafeMapPosition(position: StudyLocation['mapPosition']) {
  const xPercent = Number.isFinite(position.xPercent)
    ? Math.min(100, Math.max(0, position.xPercent))
    : 50;
  const yPercent = Number.isFinite(position.yPercent)
    ? Math.min(100, Math.max(0, position.yPercent))
    : 50;

  return { xPercent, yPercent };
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
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  return (
    <View
      accessibilityLabel="Campus study spot map"
      style={[
        styles.map,
        {
          backgroundColor: isDark ? '#29251E' : '#EEE8D8',
          borderColor: palette.border,
        },
      ]}>
      <View style={[styles.lake, { backgroundColor: isDark ? '#263238' : '#DCE8E4' }]} />
      <Text style={[styles.lakeLabel, { color: isDark ? '#718087' : '#8DA09A' }]}>LAKE MENDOTA</Text>

      {CAMPUS_BUILDINGS.map((building, index) => (
        <View
          key={index}
          style={[
            styles.building,
            building,
            { backgroundColor: isDark ? '#3B342A' : '#DCD3BC' },
          ]}
        />
      ))}

      <View style={[styles.road, styles.roadOne, { backgroundColor: isDark ? '#575044' : '#D1C6A9' }]} />
      <View style={[styles.road, styles.roadTwo, { backgroundColor: isDark ? '#575044' : '#D1C6A9' }]} />
      <View style={[styles.road, styles.roadThree, { backgroundColor: isDark ? '#575044' : '#D1C6A9' }]} />
      <View style={[styles.road, styles.roadFour, { backgroundColor: isDark ? '#575044' : '#D1C6A9' }]} />
      <View style={[styles.park, { backgroundColor: isDark ? '#354235' : '#CEDBC2' }]} />

      <Pressable
        accessibilityRole="link"
        onPress={onOpenCampusMap}
        style={({ pressed }) => [
          styles.campusLabel,
          { backgroundColor: palette.surface, opacity: pressed ? 0.72 : 1 },
        ]}>
        <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>UW LAYERS</Text>
        <MaterialIcons color={palette.icon} name="open-in-new" size={13} />
      </Pressable>

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

      {locations.map((location) => {
        const isSelected = selectedLocationId === location.locationId;
        const sessionCount = sessionsByLocation.get(location.locationId) ?? 0;
        const timing = sessionTimingByLocation.get(location.locationId) ?? 'none';
        const timingColor = getTimingColor(timing, palette.tint, palette.icon);
        const position = getSafeMapPosition(location.mapPosition);

        return (
          <Pressable
            accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}, ${timing === 'live' ? 'happening now' : timing === 'soon' ? 'starting soon' : timing === 'later' ? 'later' : 'no scheduled sessions'}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            hitSlop={8}
            key={location.locationId}
            onPress={() => onSelectLocation(location.locationId)}
            style={({ pressed }) => [
              styles.markerWrap,
              {
                left: `${position.xPercent}%`,
                opacity: pressed ? 0.72 : 1,
                top: `${position.yPercent}%`,
                zIndex: isSelected ? 4 : sessionCount > 0 ? 3 : 2,
              },
            ]}>
            <View
              style={[
                styles.markerHalo,
                isSelected && styles.markerHaloSelected,
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
          </Pressable>
        );
      })}

      {locations.length === 0 ? (
        <View
          pointerEvents="none"
          style={[styles.emptyOverlay, Elevation.e1, { backgroundColor: palette.surface }]}>
          <Text style={[TypeScale.label, { color: palette.text }]}>No matching pins</Text>
          <Text style={[TypeScale.caption, styles.emptyOverlayText, { color: palette.icon }]}>
            Clear search or try another filter.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    borderRadius: Radius.xxl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    height: 388,
    overflow: 'hidden',
    position: 'relative',
  },
  lake: {
    borderBottomLeftRadius: 80,
    borderBottomRightRadius: 120,
    height: '12%',
    left: '-4%',
    position: 'absolute',
    right: '-4%',
    top: 0,
  },
  lakeLabel: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 8,
    left: 18,
    letterSpacing: 1.4,
    position: 'absolute',
    top: 12,
  },
  building: {
    borderRadius: Radius.sm,
    position: 'absolute',
  },
  road: {
    borderRadius: Radius.pill,
    position: 'absolute',
  },
  roadOne: {
    height: 3,
    left: '-8%',
    top: '36%',
    transform: [{ rotate: '-5deg' }],
    width: '116%',
  },
  roadTwo: {
    height: 3,
    left: '-8%',
    top: '67%',
    transform: [{ rotate: '4deg' }],
    width: '116%',
  },
  roadThree: {
    height: '110%',
    left: '34%',
    top: '-4%',
    transform: [{ rotate: '-3deg' }],
    width: 3,
  },
  roadFour: {
    height: '110%',
    left: '64%',
    top: '-4%',
    transform: [{ rotate: '2deg' }],
    width: 3,
  },
  park: {
    borderRadius: Radius.pill,
    height: '18%',
    left: '34%',
    position: 'absolute',
    top: '45%',
    transform: [{ rotate: '-5deg' }],
    width: '28%',
  },
  campusLabel: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    bottom: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
    flexDirection: 'row',
    gap: 4,
  },
  emptyOverlay: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: Radius.xl,
    gap: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    top: 16,
    zIndex: 6,
  },
  emptyOverlayText: {
    textAlign: 'center',
  },
  legend: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: 8,
    left: 12,
    minHeight: 34,
    paddingHorizontal: 12,
    position: 'absolute',
    top: 12,
    zIndex: 5,
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
  markerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -22,
    marginTop: -22,
    minHeight: 44,
    position: 'absolute',
    width: 44,
  },
  markerHalo: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  markerHaloSelected: {
    transform: [{ scale: 1.06 }],
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
  markerStatus: {
    borderRadius: Radius.pill,
    height: 7,
    width: 7,
  },
  markerStatusSelected: {
    height: 9,
    width: 9,
  },
});
