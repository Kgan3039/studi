import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type LoadingStateProps = {
  title?: string;
  body?: string;
  mode?: 'compact' | 'screen';
  style?: StyleProp<ViewStyle>;
};

export function LoadingState({
  title = 'Loading',
  body,
  mode = 'compact',
  style,
}: LoadingStateProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View
      accessibilityLabel={[title, body].filter(Boolean).join('. ')}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[styles.container, mode === 'screen' && styles.screen, style]}>
      <ActivityIndicator color={palette.accent} />
      <View style={styles.copy}>
        {title ? (
          <Text style={[TypeScale.bodyStrong, styles.text, { color: palette.primaryText }]}>
            {title}
          </Text>
        ) : null}
        {body ? (
          <Text style={[TypeScale.body, styles.text, { color: palette.secondaryText }]}>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Space.md,
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    paddingVertical: Space.xxl,
  },
  screen: {
    flex: 1,
    minHeight: 240,
  },
  copy: {
    alignItems: 'center',
    gap: Space.xs,
    maxWidth: 320,
  },
  text: {
    textAlign: 'center',
  },
});
