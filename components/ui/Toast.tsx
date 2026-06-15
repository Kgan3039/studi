import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Elevation, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ToastContent = {
  headline: string;
  body?: string;
};

const TOAST_DURATION_MS = 3500;

/**
 * Success-toast state (handoff §2 toast): non-blocking confirmation that
 * replaces Alert.alert success popups ("You're in.", "Session posted").
 * Errors keep alerts — only the happy path goes quiet.
 */
export function useSuccessToast() {
  const [toast, setToast] = useState<ToastContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((headline: string, body?: string) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setToast({ headline, body });
    timer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  return { toast, show };
}

export function SuccessToast({
  toast,
  /** Extra bottom offset when a sticky bar sits under the toast. */
  bottomOffset = 0,
}: {
  toast: ToastContent | null;
  bottomOffset?: number;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  if (!toast) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, Space.lg) + bottomOffset },
      ]}>
      <View
        style={[
          styles.card,
          Elevation.e3,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}>
        <View style={[styles.check, { backgroundColor: palette.tint }]}>
          <Text style={styles.checkGlyph}>✓</Text>
        </View>
        <View style={styles.copy}>
          <Text style={[styles.headline, { color: palette.text }]} numberOfLines={1}>
            {toast.headline}
          </Text>
          {toast.body ? (
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {toast.body}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Space.lg + 4,
    right: Space.lg + 4,
    alignItems: 'center',
  },
  card: {
    alignItems: 'center',
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    maxWidth: 420,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    width: '100%',
  },
  check: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  checkGlyph: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bodySemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  copy: {
    flex: 1,
    gap: 1,
  },
  headline: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 18,
    lineHeight: 23,
  },
});
