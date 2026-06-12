import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type SeatPipsProps = {
  /** People already in the session. */
  going: number;
  /**
   * Total seats. Optional because the current data model has no capacity
   * field — when omitted, only filled pips and "N going" render.
   */
  capacity?: number;
  showLabel?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Pips cap (design-direction.md §6): beyond this, show "12 going" only. */
const MAX_PIPS = 8;

/**
 * Seat pips — dots are people at the table (design-direction.md §1).
 * Filled = going, hollow = open seats.
 */
export function SeatPips({ going, capacity, showLabel = true, style }: SeatPipsProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  const total = capacity ?? going;
  const spotsLeft = capacity !== undefined ? Math.max(capacity - going, 0) : undefined;
  const showPips = total > 0 && total <= MAX_PIPS;

  const label =
    spotsLeft === undefined
      ? `${going} going`
      : spotsLeft === 0
        ? `${going} going · Full`
        : `${going} going · ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`;

  return (
    <View style={[styles.row, style]} accessibilityLabel={label}>
      {showPips ? (
        <View style={styles.pips}>
          {Array.from({ length: total }, (_, index) => {
            const filled = index < going;
            return (
              <View
                key={index}
                style={[
                  styles.pip,
                  filled
                    ? { backgroundColor: palette.tint }
                    : { borderWidth: 1.5, borderColor: palette.outline },
                ]}
              />
            );
          })}
        </View>
      ) : null}
      {showLabel ? (
        <Text style={[TypeScale.caption, { color: palette.icon }]}>{label}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  pips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
