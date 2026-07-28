import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Brand, FontFamily, Space, TypeScale } from '@/constants/theme';

type SessionCreatedTransitionProps = {
  classId: string;
  locationName: string;
  onFinish: () => void;
  visible: boolean;
};

/**
 * A short, full-screen confirmation between posting and the new session.
 * The inverted brand colours make the state unmistakable without confetti,
 * gradients, or decorative motion.
 */
export function SessionCreatedTransition({
  classId,
  locationName,
  onFinish,
  visible,
}: SessionCreatedTransitionProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const checkOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0.72)).current;
  const copyOpacity = useRef(new Animated.Value(0)).current;
  const copyOffset = useRef(new Animated.Value(8)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }

    checkOpacity.setValue(0);
    checkScale.setValue(reduceMotion ? 1 : 0.72);
    copyOpacity.setValue(0);
    copyOffset.setValue(reduceMotion ? 0 : 8);
    screenOpacity.setValue(1);

    AccessibilityInfo.announceForAccessibility(
      `${classId} session posted at ${locationName}.`
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined
    );

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(checkOpacity, {
          duration: reduceMotion ? 0 : 120,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(checkScale, {
          damping: 11,
          mass: 0.72,
          stiffness: 210,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(copyOpacity, {
          duration: reduceMotion ? 0 : 220,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(copyOffset, {
          duration: reduceMotion ? 0 : 240,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(reduceMotion ? 450 : 850),
      Animated.timing(screenOpacity, {
        duration: reduceMotion ? 0 : 220,
        easing: Easing.out(Easing.quad),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) {
        onFinish();
      }
    });

    return () => animation.stop();
  }, [
    checkOpacity,
    checkScale,
    classId,
    copyOffset,
    copyOpacity,
    locationName,
    onFinish,
    reduceMotion,
    screenOpacity,
    visible,
  ]);

  return (
    <Modal
      animationType="none"
      onRequestClose={() => undefined}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}>
      <StatusBar backgroundColor={Brand.accent} barStyle="light-content" />
      <Animated.View style={[styles.screen, { opacity: screenOpacity }]}>
        <View style={styles.content}>
          <Animated.View
            style={[
              styles.check,
              {
                opacity: checkOpacity,
                transform: [{ scale: checkScale }],
              },
            ]}>
            <IconSymbol color={Brand.bg} name="checkmark" size={78} weight="semibold" />
          </Animated.View>
          <Animated.View
            style={[
              styles.copy,
              {
                opacity: copyOpacity,
                transform: [{ translateY: copyOffset }],
              },
            ]}>
            <Text style={styles.title}>Session posted</Text>
            <Text style={styles.detail} numberOfLines={2}>
              {classId} at {locationName}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: Brand.accent,
    flex: 1,
    justifyContent: 'center',
    padding: Space.xl,
  },
  content: {
    alignItems: 'center',
    gap: Space.lg,
    maxWidth: 360,
  },
  check: {
    alignItems: 'center',
    height: 92,
    justifyContent: 'center',
    width: 92,
  },
  copy: {
    alignItems: 'center',
    gap: Space.sm,
  },
  title: {
    color: Brand.bg,
    fontFamily: FontFamily.serifItalic,
    fontSize: 38,
    lineHeight: 43,
    textAlign: 'center',
  },
  detail: {
    ...TypeScale.bodyStrong,
    color: Brand.bg,
    textAlign: 'center',
  },
});
