import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Motion } from '@/constants/theme';

type ScreenTransitionProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** A quiet focus transition that preserves spatial continuity between tabs. */
export function ScreenTransition({ children, style }: ScreenTransitionProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (reduceMotion) {
        progress.setValue(1);
        return;
      }

      progress.setValue(0);
      Animated.timing(progress, {
        duration: Motion.base,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start();
    }, [progress, reduceMotion])
  );

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}
