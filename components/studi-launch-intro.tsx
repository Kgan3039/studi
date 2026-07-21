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
            toValue: 1.35,
            duration: 120,
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
      Animated.delay(700),
    ]);

    const hapticTimeout = setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }, 620);

    animation.start(({ finished }) => {
      if (finished) {
        onFinish();
      }
    });

    return () => {
      clearTimeout(hapticTimeout);
      animation.stop();
    };
  }, [onFinish, pinOffset, pinOpacity, pinScale, ringOpacity, ringScale, wordmarkOffset, wordmarkOpacity]);

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
    borderWidth: 3,
    bottom: 2,
    height: 22,
    position: 'absolute',
    width: 76,
  },
  wordmark: {
    color: Brand.text,
    fontFamily: FontFamily.serifItalic,
    fontSize: 44,
    letterSpacing: -1.2,
    lineHeight: 50,
  },
});
