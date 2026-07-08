import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BadgeChip } from '@/components/ui/BadgeChip';
import { Button } from '@/components/ui/Button';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { LOCATION_RATING_TAG_GROUPS } from '@/data/location-rating-options';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
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
  const starActiveColor = isDark ? '#D9A45C' : Brand.warning;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [selectedStars, setSelectedStars] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
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
      router.replace('/');
    }
  }, [authResolved, currentUser, router]);

  const loadExistingRating = useCallback(async (options?: { showInitialLoader?: boolean }) => {
    if (!currentUser || !locationId) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    try {
      if (options?.showInitialLoader ?? true) {
        setIsLoading(true);
      }
      const existing = await getUserLocationRating(locationId, currentUser.uid);
      if (existing) {
        setSelectedStars(existing.stars);
        setSelectedTags(existing.tags);
        setHasExistingRating(true);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
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
      setHasExistingRating(true);
      setStatusMessage(hasExistingRating ? 'Rating updated.' : 'Rating submitted!');
    } catch {
      setStatusMessage('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRefresh() {
    if (!currentUser || !locationId) {
      return;
    }

    setIsRefreshing(true);
    await loadExistingRating({ showInitialLoader: false });
  }

  if (!authResolved || !currentUser || isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.tint} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={palette.tint} />
      }
      contentContainerStyle={[
        styles.content,
        { paddingTop: Space.lg, paddingBottom: insets.bottom + Space.xxl },
      ]}>
      <View style={styles.header}>
        <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>Reviewing</Text>
        <Text style={[TypeScale.title, { color: palette.text }]}>{locationName}</Text>
        {hasExistingRating ? (
          <View style={styles.noticeRow}>
            <BadgeChip label="Already rated" tone="info" />
            <Text style={[TypeScale.caption, styles.noticeText, { color: palette.icon }]}>
              Submitting will update your rating.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={[styles.question, { color: palette.text }]}>Your rating</Text>
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
              <Text
                style={[
                  styles.starChar,
                  { color: star <= selectedStars ? starActiveColor : palette.outline },
                ]}>
                ★
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>
          {selectedStars === 0 ? 'Tap a star to rate this spot.' : `${selectedStars} of 5 stars`}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.question, { color: palette.text }]}>Tags</Text>
        <Text style={[TypeScale.caption, { color: palette.icon }]}>
          Select any that apply. These help other students filter study spots.
        </Text>
        {LOCATION_RATING_TAG_GROUPS.map((group) => (
          <View key={group.label} style={styles.tagGroup}>
            <Text style={[TypeScale.eyebrow, { color: palette.icon }]}>{group.label}</Text>
            <View style={styles.tagGrid}>
              {group.tags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={({ pressed }) => [
                      styles.tagChip,
                      isSelected
                        ? {
                            backgroundColor: isDark ? `${palette.tint}26` : Brand.accentSoft,
                            borderColor: palette.tint,
                          }
                        : {
                            backgroundColor: palette.surface,
                            borderColor: palette.border,
                          },
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}>
                    <Text
                      style={[
                        TypeScale.label,
                        { color: isSelected ? palette.tint : palette.icon },
                      ]}>
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      {statusMessage ? (
        <Text style={[TypeScale.meta, styles.statusText, { color: palette.icon }]}>
          {statusMessage}
        </Text>
      ) : null}

      <Button
        label={hasExistingRating ? 'Update rating' : 'Submit rating'}
        size="lg"
        fullWidth
        loading={isSubmitting}
        disabled={selectedStars === 0}
        onPress={handleSubmit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  screen: {
    flex: 1,
  },
  content: {
    gap: Space.xl,
    padding: Space.lg + 4,
  },
  header: {
    gap: Space.xs,
  },
  noticeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.xs,
  },
  noticeText: {
    flexShrink: 1,
  },
  section: {
    gap: Space.md,
  },
  question: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 24,
    lineHeight: 29,
  },
  starRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  starButton: {
    padding: Space.xs,
  },
  starChar: {
    fontSize: 34,
    lineHeight: 40,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  tagGroup: {
    gap: Space.sm,
    marginTop: Space.xs,
  },
  tagChip: {
    alignItems: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  statusText: {
    textAlign: 'center',
  },
});
