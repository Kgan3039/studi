import { type Href } from 'expo-router';
import type React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  STUDI_APP_NAME,
  STUDI_CONTACT_EMAIL,
  STUDI_SUPPORT_URL,
} from '@/constants/app-info';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const LAST_UPDATED = 'July 10, 2026';

function buildMailtoHref(subject: string) {
  return `mailto:${STUDI_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` as Href & string;
}

export default function PrivacyPolicyScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <ThemedView style={[styles.hero, { backgroundColor: palette.hero }]}>
        <ThemedText style={[styles.eyebrow, { color: palette.tint }]}>
          Privacy Policy
        </ThemedText>
        <ThemedText type="title">{STUDI_APP_NAME}</ThemedText>
        <ThemedText style={styles.heroText}>
          Last updated {LAST_UPDATED}. This policy explains what Studi collects, why it is used,
          and how students can manage or delete account data.
        </ThemedText>
      </ThemedView>

      <PolicySection title="Overview">
        <ThemedText style={styles.bodyText}>
          Studi helps UW-Madison students find study partners, coordinate study sessions, and browse
          campus study locations. We collect only the information needed to provide those features.
          Studi does not sell personal information and does not use third-party advertising or
          cross-app tracking.
        </ThemedText>
      </PolicySection>

      <PolicySection title="Information We Collect">
        <Bullet text="Account information, including email address, display name, and sign-in provider details." />
        <Bullet text="Profile information you choose to add, including your display name, classes, and optional profile details such as your major, year, pronouns, and a short bio. Optional profile details are visible to other verified students in the app." />
        <Bullet text="Study activity you create in the app, including sessions, session participation, messages, reports, blocks, and study location ratings." />
        <Bullet text="Analytics and usage information, such as app opens, screen interactions, feature usage, engagement metrics, and diagnostic or crash-related data." />
        <Bullet text="Technical data needed to operate the app, such as authentication state, timestamps, Firebase service logs, and device push identifiers or push notification tokens if you enable notifications." />
      </PolicySection>

      <PolicySection title="How We Use Information">
        <Bullet text="Create and secure your account." />
        <Bullet text="Show study sessions relevant to your classes." />
        <Bullet text="Show sessions, messages, location ratings, and profile details to the people who need them for app features." />
        <Bullet text="Investigate reports, prevent abuse, debug issues, and keep the service reliable." />
        <Bullet text="Send account, message, session, and app-related notifications if you enable notifications." />
        <Bullet text="Understand app performance, usability, reliability, and feature quality." />
      </PolicySection>

      <PolicySection title="Sharing and Service Providers">
        <ThemedText style={styles.bodyText}>
          Studi uses Firebase services from Google for authentication and cloud data storage. Studi
          uses PostHog for product analytics and usage insights, and Sentry for crash reporting and
          performance diagnostics. Push notification support may use Expo Push Service to deliver
          notifications. Data is shared with service providers only as needed to operate Studi. We do
          not share personal information with advertising networks or data brokers.
        </ThemedText>
      </PolicySection>

      <PolicySection title="Retention and Deletion">
        <ThemedText style={styles.bodyText}>
          Account and profile data is retained while your account is active. If you delete your
          account from Profile, Studi removes your account data from the app database and deletes the
          Firebase Authentication account. Some limited records may be retained if required for
          security, abuse prevention, or legal reasons.
        </ThemedText>
      </PolicySection>

      <PolicySection title="Your Choices">
        <Bullet text="You can edit or remove your display name, classes, and optional profile details (major, year, pronouns, bio) from Profile at any time." />
        <Bullet text="You can delete your account from Profile > Account actions > Delete Account." />
        <Bullet text="You can control notifications through your device settings." />
        <Bullet text="You can contact us to request access, correction, deletion, or consent withdrawal help." />
      </PolicySection>

      <PolicySection title="Children and Sensitive Data">
        <ThemedText style={styles.bodyText}>
          Studi is intended for college students and is not directed to children under 13. Studi does
          not request HealthKit data, precise location tracking, payment card information, or
          government identifiers.
        </ThemedText>
      </PolicySection>

      <PolicySection title="Contact">
        <ThemedText style={styles.bodyText}>
          For privacy questions or data requests, contact {STUDI_CONTACT_EMAIL}.
        </ThemedText>
        <View style={styles.buttonRow}>
          <ExternalLink href={buildMailtoHref('Studi Privacy Request')} asChild>
            <Pressable style={[styles.linkButton, { borderColor: palette.outline }]}>
              <ThemedText type="defaultSemiBold">Email Privacy Request</ThemedText>
            </Pressable>
          </ExternalLink>
          <ExternalLink href={STUDI_SUPPORT_URL as Href & string} asChild>
            <Pressable style={[styles.linkButton, { borderColor: palette.outline }]}>
              <ThemedText type="defaultSemiBold">Support Page</ThemedText>
            </Pressable>
          </ExternalLink>
        </View>
      </PolicySection>
    </ScrollView>
  );
}

function PolicySection({ children, title }: { children: React.ReactNode; title: string }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <ThemedView style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <ThemedText style={styles.sectionLabel}>{title}</ThemedText>
      {children}
    </ThemedView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <ThemedText style={styles.bulletMark}>•</ThemedText>
      <ThemedText style={[styles.bodyText, styles.bulletText]}>{text}</ThemedText>
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
    gap: 10,
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
  bulletRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bulletMark: {
    lineHeight: 24,
    opacity: 0.7,
  },
  bulletText: {
    flex: 1,
  },
  buttonRow: {
    gap: 10,
  },
  linkButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 16,
  },
});
