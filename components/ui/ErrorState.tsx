import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ErrorStateProps = {
  title?: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  mode?: 'compact' | 'screen';
  style?: StyleProp<ViewStyle>;
};

export function ErrorState({
  title = 'Something went off-script.',
  body,
  onRetry,
  retryLabel = 'Try again',
  mode = 'compact',
  style,
}: ErrorStateProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.container, mode === 'screen' && styles.screen, style]}>
      <View style={styles.copy}>
        {title ? (
          <Text style={[TypeScale.heading, styles.text, { color: palette.primaryText }]}>
            {title}
          </Text>
        ) : null}
        {body ? (
          <Text style={[TypeScale.body, styles.text, { color: palette.secondaryText }]}>
            {body}
          </Text>
        ) : null}
      </View>
      {onRetry ? (
        <Button label={retryLabel} variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Space.lg,
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
