import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ActionRowProps = {
  label: string;
  description?: string;
  value?: string;
  icon?: IconSymbolName;
  accessory?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  divided?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** A scan-friendly settings/navigation row with a predictable icon and accessory column. */
export function ActionRow({
  label,
  description,
  value,
  icon,
  accessory,
  onPress,
  showChevron = !!onPress,
  divided = true,
  destructive = false,
  style,
}: ActionRowProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const labelColor = destructive ? palette.destructive : palette.text;
  const content = (
    <>
      {icon ? (
        <View style={styles.iconColumn}>
          <IconSymbol color={destructive ? palette.destructive : palette.tint} name={icon} size={21} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text style={[TypeScale.bodyStrong, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[TypeScale.meta, styles.value, { color: palette.icon }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {showChevron ? <IconSymbol color={palette.icon} name="chevron.right" size={18} /> : null}
    </>
  );
  const rowStyle = [
    styles.row,
    divided && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
    style,
  ];

  if (!onPress) {
    return <View style={rowStyle}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.55 : 1 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 60,
    paddingHorizontal: Space.xs,
    paddingVertical: Space.sm,
  },
  iconColumn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  value: {
    flexShrink: 1,
    maxWidth: '42%',
    textAlign: 'right',
  },
});
