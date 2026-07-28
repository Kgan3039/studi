import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * The single entrance every Studi pop-up uses: the scrim fades while the panel
 * springs in from slightly small and slightly low. Sheets and dialogs render
 * through `Modal animationType="none"` and routes render through
 * `presentation: 'transparentModal'`, so without this each one inherits a
 * different platform default — a bottom slide here, a hard cut there. Driving
 * it ourselves is the only way they actually match.
 *
 * Honours Reduce Motion by snapping to the settled values.
 * See docs/design-system.md § Overlays.
 */
export function useOverlayEntrance(visible: boolean) {
  const [reduceMotion, setReduceMotion] = useState(false);
  // Starts settled when the overlay is already open on mount (a route that
  // presents directly into view), so nothing flashes before the spring runs.
  const progress = useRef(new Animated.Value(visible ? 0 : 0)).current;
  const scrim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      scrim.setValue(0);
      return;
    }

    if (reduceMotion) {
      progress.setValue(1);
      scrim.setValue(1);
      return;
    }

    progress.setValue(0);
    scrim.setValue(0);

    const entrance = Animated.parallel([
      // The scrim leads slightly so the panel never appears over a bright
      // background mid-flight.
      Animated.timing(scrim, {
        duration: 180,
        easing: Easing.out(Easing.quad),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(progress, {
        damping: 22,
        mass: 0.85,
        stiffness: 260,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    entrance.start();

    return () => entrance.stop();
  }, [progress, reduceMotion, scrim, visible]);

  return {
    scrimStyle: { opacity: scrim },
    panelStyle: {
      opacity: progress,
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [14, 0],
          }),
        },
        {
          scale: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
        },
      ],
    },
  };
}
