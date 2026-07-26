import { type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type SectionHeaderProps = {
  /** Uppercase tracked eyebrow above the title. */
  eyebrow?: string;
  title?: string;
  /** Right-aligned action ("See all", "Edit"). */
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Sentence-case section heading with an optional supporting label and action. */
export function SectionHeader({ eyebrow, title, action, style }: SectionHeaderProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.row, style]}>
      <View style={styles.titles}>
        {eyebrow ? (
          <Text
            style={[
              title ? TypeScale.micro : TypeScale.sectionTitle,
              { color: title ? palette.icon : palette.text },
            ]}>
            {eyebrow}
          </Text>
        ) : null}
        {title ? (
          <Text style={[TypeScale.heading, { color: palette.text }]}>{title}</Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  titles: {
    flexShrink: 1,
    gap: Space.xs,
  },
});
