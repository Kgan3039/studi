import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';

import { Brand, FontFamily } from '@/constants/theme';

type StudiLaunchIntroProps = {
  onFinish: () => void;
};

/**
 * A short brand moment that takes over from the native splash screen. The
 * pin lands in its ring first, then the Studi wordmark settles in beside it.
 */
export function StudiLaunchIntro({ onFinish }: StudiLaunchIntroProps) {
  const pinOffset = useRef(new Animated.Value(-180)).current;
  const pinOpacity = useRef(new Animated.Value(0)).current;
  const pinScale = useRef(new Animated.Value(0.92)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.6)).current;
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
        Animated.timing(ringOpacity, {
          toValue: 0.58,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(ringScale, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.12,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 1,
          duration: 360,
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
          Animated.timing(ringScale, {
            toValue: 1.16,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.spring(ringScale, {
            toValue: 1,
            damping: 10,
            stiffness: 180,
            mass: 0.7,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glowOpacity, {
            toValue: 0.25,
            duration: 90,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(glowOpacity, {
              toValue: 0.08,
              duration: 340,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(glowScale, {
              toValue: 1.38,
              duration: 340,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.timing(firstRippleOpacity, {
            toValue: 0.5,
            duration: 60,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(firstRippleOpacity, {
              toValue: 0,
              duration: 360,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(firstRippleScale, {
              toValue: 1.75,
              duration: 420,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(90),
          Animated.timing(secondRippleOpacity, {
            toValue: 0.3,
            duration: 60,
            useNativeDriver: true,
          }),
          Animated.parallel([
            Animated.timing(secondRippleOpacity, {
              toValue: 0,
              duration: 330,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(secondRippleScale, {
              toValue: 1.55,
              duration: 390,
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
    ringOpacity,
    ringScale,
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
      <View pointerEvents="none" style={styles.wash} />
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Animated.View
            style={[
              styles.glow,
              {
                opacity: glowOpacity,
                transform: [{ scaleX: glowScale }, { scaleY: Animated.multiply(glowScale, 0.42) }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.ripple,
              {
                opacity: firstRippleOpacity,
                transform: [
                  { scaleX: firstRippleScale },
                  { scaleY: Animated.multiply(firstRippleScale, 0.46) },
                ],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.ripple,
              {
                opacity: secondRippleOpacity,
                transform: [
                  { scaleX: secondRippleScale },
                  { scaleY: Animated.multiply(secondRippleScale, 0.46) },
                ],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.ring,
              {
                opacity: ringOpacity,
                transform: [{ scaleX: ringScale }, { scaleY: Animated.multiply(ringScale, 0.46) }],
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
  wash: {
    backgroundColor: Brand.accentSoft,
    borderRadius: 9999,
    height: 340,
    opacity: 0.65,
    position: 'absolute',
    transform: [{ scaleX: 1.65 }],
    width: 340,
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
  ring: {
    borderColor: Brand.accent,
    borderRadius: 9999,
    borderWidth: 2,
    bottom: 2,
    height: 18,
    position: 'absolute',
    width: 54,
  },
  glow: {
    backgroundColor: Brand.accent,
    borderRadius: 9999,
    bottom: -5,
    height: 36,
    position: 'absolute',
    width: 78,
  },
  ripple: {
    borderColor: Brand.accent,
    borderRadius: 9999,
    borderWidth: 1.5,
    bottom: 2,
    height: 18,
    position: 'absolute',
    width: 54,
  },
  wordmark: {
    color: Brand.text,
    fontFamily: FontFamily.serifItalic,
    fontSize: 44,
    letterSpacing: -1.2,
    lineHeight: 50,
  },
});
