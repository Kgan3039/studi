import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  status?: string;
  action?: ReactNode;
  align?: 'start' | 'center';
  style?: StyleProp<ViewStyle>;
};

/**
 * Canonical Studi top-level header. Titles always use the shared serif role;
 * supporting copy and actions remain compact sans-serif utility UI.
 */
export function ScreenHeader({
  title,
  subtitle,
  status,
  action,
  align = 'start',
  style,
}: ScreenHeaderProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const centered = align === 'center';
  const [actionWidth, setActionWidth] = useState(0);

  function handleActionLayout(event: LayoutChangeEvent) {
    if (!centered) {
      return;
    }

    setActionWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={[styles.container, centered && styles.centered, style]}>
      <View style={[styles.headingRow, centered && styles.centeredHeadingRow]}>
        {centered && action ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.actionMirror, { width: actionWidth }]}
          />
        ) : null}
        <View style={[styles.copy, centered && styles.centeredCopy]}>
          <Text
            accessibilityRole="header"
            style={[
              TypeScale.screenTitle,
              styles.title,
              centered && styles.centeredText,
              { color: palette.primaryText },
            ]}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                TypeScale.body,
                styles.supportingText,
                centered && styles.centeredText,
                { color: palette.secondaryText },
              ]}>
              {subtitle}
            </Text>
          ) : null}
          {status ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                TypeScale.meta,
                styles.supportingText,
                centered && styles.centeredText,
                { color: palette.secondaryText },
              ]}>
              {status}
            </Text>
          ) : null}
        </View>
        {action ? (
          <View onLayout={centered ? handleActionLayout : undefined} style={styles.action}>
            {action}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Space.xs,
    width: '100%',
  },
  centered: {
    alignItems: 'center',
  },
  headingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    width: '100%',
  },
  centeredHeadingRow: {
    justifyContent: 'center',
  },
  actionMirror: {
    flexShrink: 0,
  },
  copy: {
    flex: 1,
    gap: Space.xs,
    minWidth: 0,
  },
  centeredCopy: {
    alignItems: 'center',
  },
  title: {
    flexShrink: 1,
  },
  centeredText: {
    textAlign: 'center',
  },
  supportingText: {
    flexShrink: 1,
  },
  action: {
    flexShrink: 0,
    paddingTop: Space.xs,
  },
});
