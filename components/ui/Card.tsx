import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { Colors, Radius, Space } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type CardProps = ViewProps & {
  tone?: 'surface' | 'muted';
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  tone = 'surface',
  bordered = false,
  style,
  ...viewProps
}: CardProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View
      {...viewProps}
      style={[
        styles.card,
        {
          backgroundColor: tone === 'muted' ? palette.mutedSurface : palette.surface,
          borderColor: palette.border,
          borderWidth: bordered ? StyleSheet.hairlineWidth * 2 : 0,
        },
        style,
      ]}
    />
  );
}

export type GroupedListProps = {
  children: ReactNode;
  tone?: CardProps['tone'];
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function GroupedList({
  children,
  tone = 'surface',
  bordered = true,
  style,
}: GroupedListProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const rows = Children.toArray(children);

  return (
    <Card tone={tone} bordered={bordered} style={[styles.groupedList, style]}>
      {rows.map((row, index) => {
        const rowKey = isValidElement(row) && row.key != null ? row.key : `row-${index}`;

        return (
          <Fragment key={rowKey}>
            {index > 0 ? (
              <View accessibilityElementsHidden style={[styles.separator, { backgroundColor: palette.border }]} />
            ) : null}
            {row}
          </Fragment>
        );
      })}
    </Card>
  );
}

export type GroupedListRowProps = ViewProps & {
  style?: StyleProp<ViewStyle>;
};

export function GroupedListRow({ style, ...viewProps }: GroupedListRowProps) {
  return <View {...viewProps} style={[styles.row, style]} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    padding: Space.lg,
  },
  groupedList: {
    overflow: 'hidden',
    paddingHorizontal: Space.lg + 4,
    paddingVertical: 0,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingVertical: Space.sm,
  },
});
