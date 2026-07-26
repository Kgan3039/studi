import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Colors, Space, TypeScale } from '@/constants/theme';
import { IconButton } from '@/components/ui/IconButton';
import { NotificationCenterButton } from '@/components/ui/NotificationCenterButton';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  status?: string;
  action?: ReactNode;
  showNotifications?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  align?: 'start' | 'center';
  titleStyle?: StyleProp<TextStyle>;
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
  showNotifications = false,
  onRefresh,
  refreshing = false,
  align = 'start',
  titleStyle,
  style,
}: ScreenHeaderProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const centered = align === 'center';
  const [actionWidth, setActionWidth] = useState(0);
  const hasActions = !!action || !!onRefresh || showNotifications;

  function handleActionLayout(event: LayoutChangeEvent) {
    if (!centered) {
      return;
    }

    setActionWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={[styles.container, centered && styles.centered, style]}>
      <View style={[styles.headingRow, centered && styles.centeredHeadingRow]}>
        {centered && hasActions ? (
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
              titleStyle,
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
        {hasActions ? (
          <View
            onLayout={centered ? handleActionLayout : undefined}
            style={styles.actions}>
            {/* Button sets alignSelf: 'flex-start', which would pin it to the
                top of this row next to the taller icon buttons. Wrapping it
                lets the row centre it like everything else. */}
            {action ? <View style={styles.actionSlot}>{action}</View> : null}
            {onRefresh ? (
              <IconButton
                accessibilityLabel={`Refresh ${title.toLowerCase()}`}
                disabled={refreshing}
                icon="arrow.clockwise"
                loading={refreshing}
                onPress={onRefresh}
              />
            ) : null}
            {showNotifications ? <NotificationCenterButton /> : null}
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
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: Space.xs,
    // Matches the screen title's line height so actions centre against the
    // title itself rather than floating above a multi-line copy block.
    minHeight: 36,
  },
  actionSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
