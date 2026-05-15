import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { getUserLocationRating, submitLocationRating } from '@/lib/firestore';
import type { User } from 'firebase/auth';

const LOCATION_TAGS = [
  'Quiet',
  'Loud',
  'Crowded',
  'Spacious',
  'Good WiFi',
  'Poor WiFi',
  'Comfortable',
  'Outlets Available',
  'Natural Light',
  'Open Late',
  'Group Friendly',
  'Solo Focused',
  'Food Nearby',
  'Cold Inside',
  'Warm Inside',
  'Reservable Rooms',
];

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

  useEffect(() => {
    if (!currentUser || !locationId) return;

    async function loadExistingRating() {
      if (!currentUser || !locationId) return;
      try {
        const existing = await getUserLocationRating(locationId, currentUser.uid);
        if (existing) {
          setSelectedStars(existing.stars);
          setSelectedTags(existing.tags);
          setHasExistingRating(true);
        }
      } finally {
        setIsLoading(false);
      }
    }

    loadExistingRating();
  }, [currentUser, locationId]);

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
            <Pressable key={star} onPress={() => setSelectedStars(star)} style={styles.starButton}>
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
        <ThemedText style={styles.hintText}>Select any that apply to this location.</ThemedText>
        <View style={styles.tagGrid}>
          {LOCATION_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <Pressable
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
    fontSize: 42,
  },
  hintText: {
    opacity: 0.65,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
