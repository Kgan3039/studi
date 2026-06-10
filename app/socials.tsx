import { useRouter } from 'expo-router';
import type { User } from 'firebase/auth';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { getUserProfile, updateUserSocials, type Socials } from '@/lib/firestore';

type SocialField = {
  key: keyof Socials;
  label: string;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
};

const SOCIAL_FIELDS: SocialField[] = [
  {
    key: 'phone',
    label: 'Phone Number',
    placeholder: 'Enter phone number',
    keyboardType: 'phone-pad',
    autoCapitalize: 'none',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    placeholder: '@yourhandle',
    keyboardType: 'default',
    autoCapitalize: 'none',
  },
  {
    key: 'snapchat',
    label: 'Snapchat',
    placeholder: '@yourusername',
    keyboardType: 'default',
    autoCapitalize: 'none',
  },
  {
    key: 'discord',
    label: 'Discord',
    placeholder: 'username or server name',
    keyboardType: 'default',
    autoCapitalize: 'none',
  },
];

function isEmptyValue(value: string) {
  return value.trim().length === 0;
}

export default function SocialsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [socials, setSocials] = useState<Socials>({
    phone: '',
    instagram: '',
    snapchat: '',
    discord: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const user = currentUser;

    async function loadSocials() {
      try {
        const profile = await getUserProfile(user.uid);

        setSocials({
          phone: profile?.socials?.phone ?? '',
          instagram: profile?.socials?.instagram ?? '',
          snapchat: profile?.socials?.snapchat ?? '',
          discord: profile?.socials?.discord ?? '',
        });
      } catch (error) {
        console.warn('Unable to load socials:', error);
      }
    }

    loadSocials();
  }, [currentUser]);

  const filledCount = useMemo(
    () => SOCIAL_FIELDS.filter((field) => !isEmptyValue(socials[field.key])).length,
    [socials]
  );

  function updateSocialField(key: keyof Socials, value: string) {
    setSocials((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleCancel() {
    router.back();
  }

  async function handleSave() {
    if (!currentUser) {
      Alert.alert('Sign in required', 'Please sign in again before saving your socials.');
      return;
    }

    try {
      setIsSaving(true);

      const mergedSocials: Socials = {
        phone: socials.phone.trim(),
        instagram: socials.instagram.trim(),
        snapchat: socials.snapchat.trim(),
        discord: socials.discord.trim(),
      };

      await updateUserSocials(currentUser.uid, mergedSocials);
      router.back();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save socials right now.';
      Alert.alert('Socials Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
      keyboardShouldPersistTaps="handled">
      <ThemedView style={[styles.hero, { backgroundColor: palette.surface }]}> 
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Socials</ThemedText>
        <ThemedText type="subtitle">Add your contact links</ThemedText>
        <ThemedText style={styles.heroText}>
          Fill in whichever socials you want to share. You can leave any field blank.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[
          styles.card,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
          },
        ]}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionLabel}>Edit Socials</ThemedText>
          <View style={[styles.statusPill, { backgroundColor: palette.badge }]}> 
            <ThemedText type="defaultSemiBold">{filledCount} filled</ThemedText>
          </View>
        </View>

        <ThemedText style={styles.mutedText}>
          Keep the entries you want active. Save when you are done.
        </ThemedText>

        <View style={styles.fields}>
          {SOCIAL_FIELDS.map((field) => (
            <View
              key={field.key}
              style={[
                styles.fieldCard,
                { backgroundColor: palette.surfaceMuted, borderColor: palette.outline },
              ]}>
              <ThemedText type="defaultSemiBold" style={styles.fieldLabel}>
                {field.label}
              </ThemedText>

              <TextInput
                autoCapitalize={field.autoCapitalize ?? 'none'}
                editable={!isSaving}
                keyboardType={field.keyboardType}
                onChangeText={(value) => updateSocialField(field.key, value)}
                placeholder={field.placeholder}
                placeholderTextColor={colorScheme === 'dark' ? '#8aa1a8' : '#7a8f97'}
                style={[
                  styles.input,
                  {
                    borderColor: palette.outline,
                    color: palette.text,
                  },
                ]}
                value={socials[field.key]}
              />
            </View>
          ))}
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            disabled={isSaving || !currentUser}
            onPress={handleSave}
            style={[
              styles.primaryButton,
              {
                backgroundColor: palette.tint,
                opacity: isSaving || !currentUser ? 0.6 : 1,
              },
            ]}>
            {isSaving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
                Save
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            disabled={isSaving}
            onPress={handleCancel}
            style={[
              styles.secondaryButton,
              {
                borderColor: palette.outline,
                opacity: isSaving ? 0.6 : 1,
              },
            ]}>
            <ThemedText type="defaultSemiBold">Cancel</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
  },
  hero: {
    alignItems: 'center',
    borderRadius: 24,
    gap: 10,
    padding: 24,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  heroText: {
    lineHeight: 24,
    maxWidth: 420,
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 20,
    shadowColor: '#082431',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mutedText: {
    opacity: 0.8,
  },
  fields: {
    gap: 12,
  },
  fieldCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  fieldLabel: {
    fontSize: 16,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonRow: {
    gap: 12,
    marginTop: 4,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
});
