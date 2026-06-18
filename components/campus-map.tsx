import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Brand, Colors, Elevation, FontFamily, Radius, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StudyLocation } from '@/lib/firestore';

type CampusMapProps = {
  locations: StudyLocation[];
  onOpenCampusMap: () => void;
  onSelectLocation: (locationId: string) => void;
  selectedLocationId: string | null;
  sessionsByLocation: Map<string, number>;
};

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

export function CampusMap({
  locations,
  onOpenCampusMap,
  onSelectLocation,
  selectedLocationId,
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

      {locations.map((location) => {
        const isSelected = selectedLocationId === location.locationId;
        const sessionCount = sessionsByLocation.get(location.locationId) ?? 0;

        return (
          <Pressable
            accessibilityLabel={`${location.name}, ${sessionCount} upcoming ${sessionCount === 1 ? 'session' : 'sessions'}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            hitSlop={8}
            key={location.locationId}
            onPress={() => onSelectLocation(location.locationId)}
            style={({ pressed }) => [
              styles.markerWrap,
              {
                left: `${location.mapPosition.xPercent}%`,
                opacity: pressed ? 0.72 : 1,
                top: `${location.mapPosition.yPercent}%`,
                zIndex: isSelected ? 4 : sessionCount > 0 ? 3 : 2,
              },
            ]}>
            <View
              style={[
                styles.marker,
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
                  {
                    color:
                      isSelected || sessionCount > 0
                        ? '#FFFFFF'
                        : palette.icon,
                  },
                ]}>
                {sessionCount > 0 ? sessionCount : '·'}
              </Text>
            </View>
            <View
              style={[
                styles.markerStem,
                {
                  backgroundColor: isSelected
                    ? palette.tint
                    : sessionCount > 0
                      ? Brand.text
                      : palette.icon,
                },
              ]}
            />
          </Pressable>
        );
      })}
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
  markerWrap: {
    alignItems: 'center',
    marginLeft: -20,
    marginTop: -20,
    position: 'absolute',
    width: 40,
  },
  marker: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    minWidth: 34,
    paddingHorizontal: 8,
  },
  markerText: {
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  markerStem: {
    borderRadius: Radius.pill,
    height: 8,
    marginTop: -1,
    width: 3,
  },
});
