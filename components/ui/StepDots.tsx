import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type StepDotsProps = {
  total: number;
  /** Number of segments filled, counting from the left. */
  filled: number;
  style?: StyleProp<ViewStyle>;
};

/** Onboarding progress segments (boards OnboardClassesScreen etc.). */
export function StepDots({ total, filled, style }: StepDotsProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.row, style]}>
      {Array.from({ length: total }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.segment,
            {
              backgroundColor:
                index < filled
                  ? palette.tint
                  : colorScheme === 'dark'
                    ? 'rgba(255, 255, 255, 0.14)'
                    : 'rgba(31, 27, 22, 0.10)',
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    borderRadius: Radius.pill,
    height: 4,
    width: 24,
  },
});
