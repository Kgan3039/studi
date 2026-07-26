import { type Href } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ExternalLink } from '@/components/external-link';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import {
  STUDI_CONTACT_EMAIL,
  STUDI_SUPPORT_URL,
} from '@/constants/app-info';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const LAST_UPDATED = 'July 10, 2026';
const privacyEmailHref =
  `mailto:${STUDI_CONTACT_EMAIL}?subject=${encodeURIComponent('Studi Privacy Request')}` as Href &
    string;

function PolicySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={[styles.section, { borderTopColor: palette.border }]}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function PolicyText({ children }: { children: React.ReactNode }) {
  const palette = Colors[useColorScheme() ?? 'light'];
  return <Text style={[styles.body, { color: palette.secondaryText }]}>{children}</Text>;
}

function PolicyPoint({ children }: { children: React.ReactNode }) {
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={styles.point}>
      <IconSymbol name="checkmark.circle.fill" size={17} color={palette.tint} />
      <Text style={[styles.pointText, { color: palette.secondaryText }]}>{children}</Text>
    </View>
  );
}

export default function PrivacyScreen() {
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <ScreenTransition>
        <View style={styles.intro}>
          <Text style={[styles.title, { color: palette.text }]}>Your data on Studi</Text>
          <Text style={[styles.updated, { color: palette.tint }]}>Last updated {LAST_UPDATED}</Text>
          <Text style={[styles.lead, { color: palette.secondaryText }]}>
            Studi uses only the information needed to connect students, organize sessions, and
            surface useful places to study.
          </Text>
        </View>

        <PolicySection title="What we collect">
          <View style={styles.points}>
            <PolicyPoint>
              Account information, including your email address, display name, and sign-in
              provider details.
            </PolicyPoint>
            <PolicyPoint>
              Profile details you choose to add, including classes, major, year, pronouns, and a
              short bio. Optional profile details are visible to other verified students.
            </PolicyPoint>
            <PolicyPoint>
              Sessions, participation, messages, reports, blocks, and study location ratings you
              create in the app.
            </PolicyPoint>
            <PolicyPoint>
              Usage and diagnostic information, such as app opens, feature interactions, crash
              reports, and performance data.
            </PolicyPoint>
            <PolicyPoint>
              Technical data required to run Studi, including authentication state, timestamps,
              service logs, and push notification tokens if notifications are enabled.
            </PolicyPoint>
          </View>
        </PolicySection>

        <PolicySection title="How we use it">
          <View style={styles.points}>
            <PolicyPoint>Create and secure your account.</PolicyPoint>
            <PolicyPoint>Show sessions relevant to your classes.</PolicyPoint>
            <PolicyPoint>
              Show sessions, messages, ratings, and profile details to the students who need them
              for app features.
            </PolicyPoint>
            <PolicyPoint>
              Investigate reports, prevent abuse, debug issues, and keep Studi reliable.
            </PolicyPoint>
            <PolicyPoint>
              Deliver account, message, session, and app notifications when enabled.
            </PolicyPoint>
            <PolicyPoint>
              Understand app performance, usability, reliability, and feature quality.
            </PolicyPoint>
          </View>
        </PolicySection>

        <PolicySection title="Who handles your data">
          <PolicyText>
            Studi uses Firebase for authentication and cloud storage, PostHog for product
            analytics, Sentry for crash reporting and performance diagnostics, and Expo services
            for notifications. We share only what each provider needs to operate Studi. We do not
            sell personal information or share it with advertising networks or data brokers.
          </PolicyText>
        </PolicySection>

        <PolicySection title="Retention and deletion">
          <PolicyText>
            Account and profile data is retained while your account is active. Deleting your
            account removes its data from the app database and deletes the Firebase Authentication
            account. Limited records may be retained when required for security, abuse prevention,
            or legal reasons.
          </PolicyText>
        </PolicySection>

        <PolicySection title="Your choices">
          <View style={styles.points}>
            <PolicyPoint>Edit your profile and classes from the Profile tab.</PolicyPoint>
            <PolicyPoint>Control app notifications from Profile, then Settings.</PolicyPoint>
            <PolicyPoint>Delete your account from Profile, then Settings.</PolicyPoint>
            <PolicyPoint>
              Contact us for help with access, correction, deletion, or consent withdrawal.
            </PolicyPoint>
          </View>
        </PolicySection>

        <PolicySection title="Children and sensitive data">
          <PolicyText>
            Studi is intended for college students and is not directed to children under 13. Studi
            does not request HealthKit data, precise location tracking, payment card information,
            or government identifiers.
          </PolicyText>
        </PolicySection>

        <PolicySection title="Questions or requests">
          <PolicyText>
            Email the Studi team if you want to access, correct, or delete personal information, or
            if anything in this policy is unclear.
          </PolicyText>
          <View style={styles.actions}>
            <ExternalLink href={privacyEmailHref} asChild>
              <Button label="Email a privacy request" icon="envelope.fill" fullWidth />
            </ExternalLink>
            <ExternalLink href={STUDI_SUPPORT_URL as Href & string} asChild>
              <Button
                label="Visit support"
                icon="questionmark.circle.fill"
                variant="secondary"
                fullWidth
              />
            </ExternalLink>
          </View>
        </PolicySection>
      </ScreenTransition>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: Space.lg,
    paddingBottom: 64,
  },
  intro: {
    gap: Space.sm,
    paddingBottom: Space.xl,
  },
  title: {
    ...TypeScale.display,
    fontFamily: FontFamily.serifItalic,
  },
  updated: {
    ...TypeScale.meta,
    fontFamily: FontFamily.bodySemiBold,
  },
  lead: {
    ...TypeScale.body,
    maxWidth: 520,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Space.md,
    paddingVertical: Space.xl,
  },
  sectionTitle: {
    ...TypeScale.sectionTitle,
  },
  body: {
    ...TypeScale.body,
  },
  points: {
    gap: Space.md,
  },
  point: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Space.sm,
  },
  pointText: {
    ...TypeScale.body,
    flex: 1,
  },
  actions: {
    gap: Space.sm,
    paddingTop: Space.xs,
  },
});
