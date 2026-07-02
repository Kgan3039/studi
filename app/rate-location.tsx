import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
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
  const insets = useSafeAreaInsets();

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
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.cardLabel}>Reviewing</ThemedText>
        <ThemedText type="title">{locationName}</ThemedText>
        {hasExistingRating && (
          <ThemedView style={[styles.noticePill, { backgroundColor: palette.surfaceMuted }]}>
            <ThemedText>
              You already rated this spot. Submitting will update your rating.
            </ThemedText>
          </ThemedView>
        )}
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText type="subtitle">Your rating</ThemedText>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable
              accessibilityLabel={`${star} out of 5 stars`}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedStars === star }}
              key={star}
              onPress={() => setSelectedStars(star)}
              style={styles.starButton}>
              <ThemedText
                style={[
                  styles.starChar,
                  { color: star <= selectedStars ? '#F5A623' : palette.outline },
                ]}>
                ★
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {selectedStars === 0 && (
          <ThemedText style={styles.hintText}>Tap a star to rate this spot.</ThemedText>
        )}
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText type="subtitle">Tags</ThemedText>
        <ThemedText style={styles.hintText}>
          Select any that apply. These help other students filter study spots.
        </ThemedText>
        {LOCATION_RATING_TAG_GROUPS.map((group) => (
          <View key={group.label} style={styles.tagGroup}>
            <ThemedText style={styles.tagGroupLabel}>{group.label}</ThemedText>
            <View style={styles.tagGrid}>
              {group.tags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={[
                      styles.tagChip,
                      {
                        backgroundColor: isSelected ? palette.tint : palette.surfaceMuted,
                        borderColor: isSelected ? palette.tint : palette.outline,
                      },
                    ]}>
                    <ThemedText
                      lightColor={isSelected ? '#ffffff' : undefined}
                      darkColor={isSelected ? '#ffffff' : undefined}
                      type="defaultSemiBold">
                      {tag}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ThemedView>

      {statusMessage ? (
        <ThemedView
          style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ThemedText>{statusMessage}</ThemedText>
        </ThemedView>
      ) : null}

      <Pressable
        onPress={handleSubmit}
        disabled={selectedStars === 0 || isSubmitting}
        style={[
          styles.submitButton,
          {
            backgroundColor: palette.tint,
            opacity: selectedStars === 0 || isSubmitting ? 0.5 : 1,
          },
        ]}>
        {isSubmitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            {hasExistingRating ? 'Update Rating' : 'Submit Rating'}
          </ThemedText>
        )}
      </Pressable>
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
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 20,
    shadowColor: '#082431',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  cardLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.65,
    textTransform: 'uppercase',
  },
  noticePill: {
    borderRadius: 12,
    padding: 12,
  },
  starRow: {
    flexDirection: 'row',
    gap: 4,
  },
  starButton: {
    padding: 4,
  },
  starChar: {
    fontSize: 40,
    lineHeight: 50,
  },
  hintText: {
    opacity: 0.65,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tagGroup: {
    gap: 8,
    marginTop: 4,
  },
  tagGroupLabel: {
    fontSize: 12,
    letterSpacing: 0.8,
    opacity: 0.65,
    textTransform: 'uppercase',
  },
  tagChip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  submitButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
});
