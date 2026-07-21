import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

import { Brand, FontFamily } from '@/constants/theme';

type StudiLaunchIntroProps = {
  onFinish: () => void;
};

/**
 * A short brand moment that takes over from the native splash screen. The
 * pin lands on its target first, then the Studi wordmark settles in beside it.
 */
export function StudiLaunchIntro({ onFinish }: StudiLaunchIntroProps) {
  const pinOffset = useRef(new Animated.Value(-180)).current;
  const pinOpacity = useRef(new Animated.Value(0)).current;
  const pinScale = useRef(new Animated.Value(0.92)).current;
  const targetOpacity = useRef(new Animated.Value(0)).current;
  const targetScale = useRef(new Animated.Value(0.7)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(0.7)).current;
  const firstRippleOpacity = useRef(new Animated.Value(0)).current;
  const firstRippleScale = useRef(new Animated.Value(0.75)).current;
  const secondRippleOpacity = useRef(new Animated.Value(0)).current;
  const secondRippleScale = useRef(new Animated.Value(0.75)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkOffset = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(pinOpacity, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(targetOpacity, {
          toValue: 0.68,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(targetScale, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.055,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(pinOffset, {
        toValue: 8,
        duration: 500,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.spring(pinOffset, {
          toValue: 0,
          damping: 9,
          stiffness: 210,
          mass: 0.72,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 0.9,
            duration: 75,
            useNativeDriver: true,
          }),
          Animated.spring(targetScale, {
            toValue: 1,
            damping: 11,
            stiffness: 220,
            mass: 0.6,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.13,
            duration: 80,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(glowOpacity, {
              toValue: 0.08,
              duration: 180,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(glowScale, {
              toValue: 1.38,
              duration: 280,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.timing(firstRippleOpacity, {
            toValue: 0.34,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(firstRippleOpacity, {
              toValue: 0,
              duration: 300,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(firstRippleScale, {
              toValue: 2.15,
              duration: 350,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(75),
          Animated.timing(secondRippleOpacity, {
            toValue: 0.2,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(secondRippleOpacity, {
              toValue: 0,
              duration: 280,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(secondRippleScale, {
              toValue: 1.7,
              duration: 330,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.timing(pinScale, {
            toValue: 1.04,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.spring(pinScale, {
            toValue: 1,
            damping: 10,
            stiffness: 200,
            mass: 0.65,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.parallel([
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkOffset, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(520),
    ]);

    const hapticTimeout = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }, 875);

    animation.start(({ finished }) => {
      if (finished) {
        onFinish();
      }
    });

    return () => {
      clearTimeout(hapticTimeout);
      animation.stop();
    };
  }, [
    firstRippleOpacity,
    firstRippleScale,
    glowOpacity,
    glowScale,
    onFinish,
    pinOffset,
    pinOpacity,
    pinScale,
    targetOpacity,
    targetScale,
    secondRippleOpacity,
    secondRippleScale,
    wordmarkOffset,
    wordmarkOpacity,
  ]);

  return (
    <View
      accessibilityLabel="Studi is loading"
      accessibilityRole="progressbar"
      style={styles.screen}>
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Animated.View
            style={[
              styles.landingGlow,
              {
                opacity: glowOpacity,
                transform: [{ scale: glowScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.landingRipple,
              {
                opacity: firstRippleOpacity,
                transform: [{ scale: firstRippleScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.landingRipple,
              {
                opacity: secondRippleOpacity,
                transform: [{ scale: secondRippleScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.landingTarget,
              {
                opacity: targetOpacity,
                transform: [{ scale: targetScale }],
              },
            ]}
          />
          <Animated.View
            style={{
              opacity: pinOpacity,
              transform: [{ translateY: pinOffset }, { scale: pinScale }],
            }}>
            <Image
              accessibilityIgnoresInvertColors
              source={require('../assets/images/studi-logo.png')}
              style={styles.pin}
            />
          </Animated.View>
        </View>
        <Animated.Text
          style={[
            styles.wordmark,
            {
              opacity: wordmarkOpacity,
              transform: [{ translateY: wordmarkOffset }],
            },
          ]}>
          Studi
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: Brand.bg,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 100,
  },
  brand: {
    alignItems: 'center',
    gap: 18,
  },
  mark: {
    alignItems: 'center',
    height: 132,
    justifyContent: 'flex-end',
    position: 'relative',
    width: 120,
  },
  pin: {
    height: 118,
    resizeMode: 'contain',
    width: 118,
  },
  landingTarget: {
    backgroundColor: Brand.surface,
    borderColor: Brand.accent,
    borderRadius: 9999,
    borderWidth: 1.5,
    bottom: -10,
    height: 28,
    position: 'absolute',
    width: 28,
  },
  landingGlow: {
    backgroundColor: Brand.accent,
    borderRadius: 9999,
    bottom: -18,
    height: 44,
    position: 'absolute',
    width: 44,
  },
  landingRipple: {
    borderColor: Brand.accent,
    borderRadius: 9999,
    borderWidth: 1,
    bottom: -10,
    height: 28,
    position: 'absolute',
    width: 28,
  },
  wordmark: {
    color: Brand.text,
    fontFamily: FontFamily.serifItalic,
    fontSize: 44,
    letterSpacing: -1.2,
    lineHeight: 50,
  },
});
