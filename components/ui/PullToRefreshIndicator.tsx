import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type PullToRefreshIndicatorProps = {
  pullDistance?: Animated.Value;
  refreshing: boolean;
};

function pullOffsetForDistance(distance: number) {
  const clamped = Math.max(0, Math.min(distance, 120));

  if (clamped <= 18) {
    return -70 + clamped;
  }
  if (clamped <= 72) {
    return -52 + ((clamped - 18) / 54) * 44;
  }
  return -8 + ((clamped - 72) / 48) * 34;
}

function pullScaleForDistance(distance: number) {
  const clamped = Math.max(0, Math.min(distance, 120));
  return clamped <= 72
    ? 0.86 + (clamped / 72) * 0.08
    : 0.94 + ((clamped - 72) / 48) * 0.06;
}

export function usePullToRefreshDistance() {
  const pullDistance = useRef(new Animated.Value(0)).current;
  const onPullScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      pullDistance.setValue(Math.max(0, -event.nativeEvent.contentOffset.y));
    },
    [pullDistance],
  );

  return { onPullScroll, pullDistance };
}

/**
 * The Studi pin follows the user's pull, settles while refreshing, and drops
 * away once new content arrives. It stays deliberately unadorned so the motion
 * is the feedback instead of a second spinner or decorative ring.
 */
export function PullToRefreshIndicator({ pullDistance, refreshing }: PullToRefreshIndicatorProps) {
  const insets = useSafeAreaInsets();
  const palette = Colors[useColorScheme() ?? 'light'];
  const [reduceMotion, setReduceMotion] = useState(false);
  const [settling, setSettling] = useState(false);
  const fallbackPullDistance = useRef(new Animated.Value(0)).current;
  const activePullDistance = pullDistance ?? fallbackPullDistance;
  const lastPullDistanceRef = useRef(0);
  const wasRefreshingRef = useRef(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const pinOffset = useRef(new Animated.Value(18)).current;
  const pinScale = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const listenerId = activePullDistance.addListener(({ value }) => {
      lastPullDistanceRef.current = Math.max(0, value);
    });

    return () => activePullDistance.removeListener(listenerId);
  }, [activePullDistance]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const values = [opacity, pinOffset, pinScale, pulse];
    values.forEach((value) => value.stopAnimation());

    if (!refreshing) {
      if (!wasRefreshingRef.current) {
        opacity.setValue(0);
        pulse.setValue(0);
        return;
      }

      wasRefreshingRef.current = false;
      setSettling(true);
      const exit = Animated.parallel([
        Animated.timing(opacity, {
          delay: reduceMotion ? 0 : 50,
          duration: reduceMotion ? 0 : 230,
          toValue: 0,
          useNativeDriver: true,
        }),
        Animated.timing(pinOffset, {
          duration: reduceMotion ? 0 : 240,
          easing: Easing.out(Easing.cubic),
          toValue: 58,
          useNativeDriver: true,
        }),
        Animated.timing(pinScale, {
          duration: reduceMotion ? 0 : 210,
          easing: Easing.out(Easing.quad),
          toValue: 0.94,
          useNativeDriver: true,
        }),
      ]);
      exit.start(() => {
        setSettling(false);
        pulse.setValue(0);
      });
      return () => exit.stop();
    }

    wasRefreshingRef.current = true;
    setSettling(false);
    opacity.setValue(1);
    // Continue from the pin's pull position instead of resetting it before
    // the refresh settles. The release now flows into the live state.
    pinOffset.setValue(
      reduceMotion ? 18 : pullOffsetForDistance(lastPullDistanceRef.current),
    );
    pinScale.setValue(
      reduceMotion ? 1 : pullScaleForDistance(lastPullDistanceRef.current),
    );

    const entrance = Animated.parallel([
      Animated.spring(pinOffset, {
        damping: 18,
        mass: 0.72,
        stiffness: 160,
        toValue: 18,
        useNativeDriver: true,
      }),
      Animated.spring(pinScale, {
        damping: 18,
        mass: 0.7,
        stiffness: 160,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    if (reduceMotion) {
      pulse.setValue(0);
      entrance.start();
      return () => entrance.stop();
    }

    // Keep the pin grounded while work is in progress. The small, even pulse
    // provides a calm live state without turning the brand mark into a spinner.
    pulse.setValue(0);
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 960,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 960,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    entrance.start(({ finished }) => {
      if (finished) {
        breathing.start();
      }
    });

    return () => {
      entrance.stop();
      breathing.stop();
    };
  }, [opacity, pinOffset, pinScale, pulse, reduceMotion, refreshing]);

  const pullOpacity = activePullDistance.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, 18, 44],
    outputRange: [0, 0.3, 1],
  });
  const pullOffset = activePullDistance.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, 18, 72, 120],
    outputRange: [-70, -52, -8, 26],
  });
  const pullScale = activePullDistance.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, 72, 120],
    outputRange: [0.86, 0.94, 1],
  });
  const refreshPulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.99, 1.015],
  });
  // A soft wash behind the pin so the gesture registers against the page
  // instead of a lone icon drifting over content.
  const washOpacity = activePullDistance.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, 24, 90],
    outputRange: [0, 0.42, 1],
  });
  const isRefreshTransition = refreshing || settling;

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wash,
          { height: insets.top + 132, opacity: isRefreshTransition ? opacity : washOpacity },
        ]}>
        <LinearGradient
          // Deliberately concentrated near the top: stronger than a faint
          // tint, but it still dissolves before it can read like a banner.
          colors={[`${palette.tint}30`, `${palette.tint}14`, 'transparent']}
          locations={[0, 0.46, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        accessible={refreshing}
        accessibilityElementsHidden={!refreshing}
        accessibilityLabel="Refreshing"
        accessibilityLiveRegion="polite"
        pointerEvents="none"
        style={[
          styles.wrap,
          {
            opacity: isRefreshTransition ? opacity : pullOpacity,
            top: insets.top - 2,
            transform: [
              {
                translateY: reduceMotion ? 18 : isRefreshTransition ? pinOffset : pullOffset,
              },
              {
                scale: reduceMotion ? 1 : isRefreshTransition ? pinScale : pullScale,
              },
              { scale: reduceMotion || !isRefreshTransition ? 1 : refreshPulseScale },
            ],
          },
        ]}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={require('../../assets/images/studi-logo.png')}
          style={styles.pin}
        />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  wash: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 29,
  },
  wrap: {
    alignItems: 'center',
    height: 58,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 30,
  },
  pin: {
    height: 56,
    width: 56,
  },
});
