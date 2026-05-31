import { useRouter } from 'expo-router';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  STUDI_APP_NAME,
  STUDI_PRIVACY_EMAIL,
  STUDI_PRIVACY_POLICY_URL,
  STUDI_SUPPORT_EMAIL,
  STUDI_SUPPORT_URL,
} from '@/constants/app-info';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

async function openExternalUrl(url: string) {
  try {
    const canOpen = await Linking.canOpenURL(url);

    if (!canOpen) {
      throw new Error('Unable to open this link.');
    }

    await Linking.openURL(url);
  } catch {
    Alert.alert('Link Unavailable', 'Please try again later or contact support from this screen.');
  }
}

function buildEmailUrl(email: string, subject: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

export default function PrivacySupportScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>
          Privacy and support
        </ThemedText>
        <ThemedText type="title">Help with {STUDI_APP_NAME}</ThemedText>
        <ThemedText style={styles.heroText}>
          Review privacy details, contact support, and manage account data from one place.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Privacy</ThemedText>
        <ThemedText type="subtitle">Privacy Policy</ThemedText>
        <ThemedText style={styles.mutedText}>
          The policy covers data collection, use, third-party services, retention, consent choices,
          and deletion requests.
        </ThemedText>
        <ThemedText style={styles.linkText}>{STUDI_PRIVACY_POLICY_URL}</ThemedText>
        <Pressable
          accessibilityRole="link"
          onPress={() => openExternalUrl(STUDI_PRIVACY_POLICY_URL)}
          style={[styles.primaryButton, { backgroundColor: palette.tint }]}>
          <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
            Open Privacy Policy
          </ThemedText>
        </Pressable>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Support</ThemedText>
        <ThemedText type="subtitle">Contact Studi</ThemedText>
        <View style={styles.infoRows}>
          <View>
            <ThemedText type="defaultSemiBold">Support email</ThemedText>
            <ThemedText style={styles.mutedText}>{STUDI_SUPPORT_EMAIL}</ThemedText>
          </View>
          <View>
            <ThemedText type="defaultSemiBold">Support page</ThemedText>
            <ThemedText style={styles.mutedText}>{STUDI_SUPPORT_URL}</ThemedText>
          </View>
        </View>
        <View style={styles.buttonStack}>
          <Pressable
            accessibilityRole="link"
            onPress={() => openExternalUrl(buildEmailUrl(STUDI_SUPPORT_EMAIL, 'Studi Support'))}
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Email Support</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => openExternalUrl(STUDI_SUPPORT_URL)}
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Open Support Page</ThemedText>
          </Pressable>
        </View>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Account and data</ThemedText>
        <ThemedText type="subtitle">Data requests and deletion</ThemedText>
        <ThemedText style={styles.mutedText}>
          You can delete your account from Profile. For privacy questions, data access, correction,
          or consent withdrawal requests, contact the privacy inbox.
        </ThemedText>
        <View style={styles.buttonStack}>
          <Pressable
            onPress={() => router.push('/profile')}
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Manage Account</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              openExternalUrl(buildEmailUrl(STUDI_PRIVACY_EMAIL, 'Studi Privacy Request'))
            }
            style={[styles.secondaryButton, { borderColor: palette.outline }]}>
            <ThemedText type="defaultSemiBold">Email Privacy Request</ThemedText>
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
    lineHeight: 28,
    maxWidth: 520,
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
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  mutedText: {
    opacity: 0.8,
  },
  linkText: {
    fontSize: 13,
    opacity: 0.72,
  },
  infoRows: {
    gap: 12,
  },
  buttonStack: {
    gap: 10,
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
