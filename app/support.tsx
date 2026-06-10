import { type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  STUDI_APP_NAME,
  STUDI_CONTACT_EMAIL,
  STUDI_PRIVACY_POLICY_URL,
  STUDI_SUPPORT_EMAIL,
} from '@/constants/app-info';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

function buildMailtoHref(subject: string) {
  return `mailto:${STUDI_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` as Href & string;
}

export default function SupportScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>Support</ThemedText>
        <ThemedText type="title">Contact {STUDI_APP_NAME}</ThemedText>
        <ThemedText style={styles.heroText}>
          Get help with your account, study sessions, messages, location ratings, or privacy
          requests.
        </ThemedText>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Contact</ThemedText>
        <ThemedText type="subtitle">Support email</ThemedText>
        <ThemedText style={styles.bodyText}>{STUDI_SUPPORT_EMAIL}</ThemedText>
        <ExternalLink href={buildMailtoHref('Studi Support Request')} asChild>
          <Pressable style={[styles.primaryButton, { backgroundColor: palette.tint }]}>
            <ThemedText lightColor="#ffffff" darkColor="#ffffff" type="defaultSemiBold">
              Email Support
            </ThemedText>
          </Pressable>
        </ExternalLink>
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Common Help</ThemedText>
        <HelpItem
          title="Account deletion"
          text="Open Profile, scroll to Account actions, and choose Delete Account. The app will remove your Studi account data and Firebase Authentication account."
        />
        <HelpItem
          title="Profile updates"
          text="Use Profile to update your display name, classes, availability, and optional social/contact links."
        />
        <HelpItem
          title="Study sessions"
          text="Use Sessions to browse open study sessions, join available sessions, or create a new session with a real campus study location."
        />
        <HelpItem
          title="Safety and reports"
          text="Use the report and block actions in the app if another user misuses Studi or makes you feel unsafe."
        />
      </ThemedView>

      <ThemedView
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <ThemedText style={styles.sectionLabel}>Privacy</ThemedText>
        <ThemedText type="subtitle">Data and privacy requests</ThemedText>
        <ThemedText style={styles.bodyText}>
          For data access, correction, deletion, or consent withdrawal help, contact{' '}
          {STUDI_CONTACT_EMAIL}.
        </ThemedText>
        <View style={styles.buttonStack}>
          <ExternalLink href={STUDI_PRIVACY_POLICY_URL as Href & string} asChild>
            <Pressable style={[styles.secondaryButton, { borderColor: palette.outline }]}>
              <ThemedText type="defaultSemiBold">Privacy Policy</ThemedText>
            </Pressable>
          </ExternalLink>
          <ExternalLink
            href={`mailto:${STUDI_CONTACT_EMAIL}?subject=${encodeURIComponent(
              'Studi Privacy Request'
            )}` as Href & string}
            asChild>
            <Pressable style={[styles.secondaryButton, { borderColor: palette.outline }]}>
              <ThemedText type="defaultSemiBold">Email Privacy Request</ThemedText>
            </Pressable>
          </ExternalLink>
        </View>
      </ThemedView>
    </ScrollView>
  );
}

function HelpItem({ text, title }: { text: string; title: string }) {
  return (
    <View style={styles.helpItem}>
      <ThemedText type="defaultSemiBold">{title}</ThemedText>
      <ThemedText style={styles.bodyText}>{text}</ThemedText>
    </View>
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
    maxWidth: 640,
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
  bodyText: {
    lineHeight: 24,
    opacity: 0.84,
  },
  helpItem: {
    gap: 4,
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
    minHeight: 52,
    paddingHorizontal: 16,
  },
});
