import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { FieldLabel, FormSection } from '@/components/ui/FormSection';
import { FilterChip } from '@/components/ui/FilterChip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useOverlayEntrance } from '@/components/ui/overlay-motion';
import { Brand, Colors, Elevation, Radius, Space, TypeScale } from '@/constants/theme';
import { LOCATION_RATING_TAG_GROUPS } from '@/data/location-rating-options';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { getStudyLocationDisplayName } from '@/lib/catalog';
import { getUserLocationRating, submitLocationRating } from '@/lib/firestore';
import type { User } from 'firebase/auth';

export default function RateLocationScreen() {
  const router = useRouter();
  const { locationId, locationName } = useLocalSearchParams<{
    locationId: string;
    locationName: string;
  }>();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const starActiveColor = isDark ? Brand.starDark : Brand.star;
  // Presented as a transparentModal route, so it drives its own entrance.
  const { panelStyle, scrimStyle } = useOverlayEntrance(true);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [selectedStars, setSelectedStars] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasExistingRating, setHasExistingRating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
      setAuthResolved(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (authResolved && !currentUser) {
      router.back();
    }
  }, [authResolved, currentUser, router]);

  const loadExistingRating = useCallback(async () => {
    if (!currentUser || !locationId) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const existing = await getUserLocationRating(locationId, currentUser.uid);
      if (existing) {
        setSelectedStars(existing.stars);
        setSelectedTags(existing.tags);
        setHasExistingRating(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentUser, locationId]);

  useEffect(() => {
    loadExistingRating();
  }, [loadExistingRating]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    if (!currentUser || !locationId || selectedStars === 0) return;

    setIsSubmitting(true);
    setStatusMessage('');

    try {
      await submitLocationRating(locationId, currentUser.uid, selectedStars, selectedTags);
      router.back();
    } catch {
      setStatusMessage('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  }

  const displayName = getStudyLocationDisplayName(locationId ?? '', locationName);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        onPress={() => router.back()}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.panel,
          Elevation.e3,
          panelStyle,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            marginTop: insets.top + Space.md,
          },
        ]}>
        <View style={[styles.panelHeader, { borderBottomColor: palette.border }]}>
          <View style={styles.panelHeaderCopy}>
            <Text style={[TypeScale.h2, { color: palette.text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[TypeScale.caption, { color: palette.icon }]} numberOfLines={1}>
              {hasExistingRating ? 'Update your rating' : 'Rate this spot'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: palette.surfaceMuted, opacity: pressed ? 0.6 : 1 },
            ]}>
            <IconSymbol name="xmark" size={17} color={palette.text} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={palette.tint} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: Space.lg }]}
            keyboardShouldPersistTaps="handled">
            <FormSection icon="star.fill" title="Your rating">
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    accessibilityLabel={`${star} out of 5 stars`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedStars === star }}
                    key={star}
                    onPress={() => setSelectedStars(star)}
                    style={({ pressed }) => [
                      styles.starButton,
                      pressed && { opacity: 0.6, transform: [{ scale: 0.88 }] },
                    ]}>
                    <IconSymbol
                      color={star <= selectedStars ? starActiveColor : palette.outline}
                      name="star.fill"
                      size={32}
                    />
                  </Pressable>
                ))}
              </View>
              <Text style={[TypeScale.caption, { color: palette.icon }]}>
                {selectedStars === 0 ? 'Tap a star to rate this spot.' : `${selectedStars} of 5 stars`}
              </Text>
            </FormSection>

            <FormSection icon="tag" title="Tags" caption="Optional">
              {LOCATION_RATING_TAG_GROUPS.map((group) => (
                <View key={group.label}>
                  <FieldLabel>{group.label}</FieldLabel>
                  <View style={styles.tagGrid}>
                    {group.tags.map((tag) => (
                      <FilterChip
                        key={tag}
                        label={tag}
                        onPress={() => toggleTag(tag)}
                        selected={selectedTags.includes(tag)}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </FormSection>

            {statusMessage ? (
              <Text style={[TypeScale.meta, styles.statusText, { color: palette.icon }]}>
                {statusMessage}
              </Text>
            ) : null}
          </ScrollView>
        )}

        <View
          style={[
            styles.footer,
            { borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, Space.md) },
          ]}>
          <Button
            label={hasExistingRating ? 'Update rating' : 'Submit rating'}
            fullWidth
            loading={isSubmitting}
            disabled={selectedStars === 0 || isLoading}
            onPress={handleSubmit}
          />
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  scrim: {
    backgroundColor: 'rgba(18, 24, 21, 0.32)',
  },
  panel: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    marginHorizontal: Space.md,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  panelHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    paddingBottom: Space.md,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  panelHeaderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xxl,
  },
  content: {
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingTop: Space.lg,
  },
  starRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  starButton: {
    padding: Space.xs,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
    marginTop: Space.sm,
  },
  statusText: {
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
  },
});
