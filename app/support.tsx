import { type Href } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { ExternalLink } from '@/components/external-link';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { ScreenTransition } from '@/components/ui/ScreenTransition';
import {
  STUDI_CONTACT_EMAIL,
  STUDI_PRIVACY_POLICY_URL,
  STUDI_SUPPORT_EMAIL,
} from '@/constants/app-info';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const supportEmailHref =
  `mailto:${STUDI_SUPPORT_EMAIL}?subject=${encodeURIComponent('Studi Support Request')}` as Href &
    string;
const privacyEmailHref =
  `mailto:${STUDI_CONTACT_EMAIL}?subject=${encodeURIComponent('Studi Privacy Request')}` as Href &
    string;

function HelpItem({
  icon,
  title,
  children,
}: {
  icon: IconSymbolName;
  title: string;
  children: React.ReactNode;
}) {
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <View style={styles.helpItem}>
      <View style={[styles.helpIcon, { backgroundColor: palette.hero }]}>
        <IconSymbol name={icon} size={20} color={palette.tint} />
      </View>
      <View style={styles.helpCopy}>
        <Text style={[styles.helpTitle, { color: palette.text }]}>{title}</Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>{children}</Text>
      </View>
    </View>
  );
}

export default function SupportScreen() {
  const palette = Colors[useColorScheme() ?? 'light'];

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <ScreenTransition>
        <View style={styles.intro}>
          <Text style={[styles.title, { color: palette.text }]}>How can we help?</Text>
          <Text style={[styles.lead, { color: palette.secondaryText }]}>
            Tell us what happened and we will get back to you.
          </Text>
          <ExternalLink href={supportEmailHref} asChild>
            <Button label="Email Studi support" icon="envelope.fill" fullWidth />
          </ExternalLink>
        </View>

        <View style={[styles.section, { borderTopColor: palette.border }]}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Common help</Text>
          <View style={styles.helpList}>
            <HelpItem icon="trash.fill" title="Delete your account">
              Open Profile, choose Settings, then Delete account. Studi removes your account data
              after you confirm.
            </HelpItem>
            <HelpItem icon="square.and.pencil" title="Update your profile">
              Open Profile to change your name, classes, and other account details.
            </HelpItem>
            <HelpItem icon="calendar" title="Sessions and attendance">
              Refresh Sessions if a new event is missing. Contact support if a session still looks
              wrong.
            </HelpItem>
            <HelpItem icon="hand.raised.fill" title="Safety and reports">
              Open a student profile to block or report them. Include a short description so we can
              review it quickly.
            </HelpItem>
          </View>
        </View>

        <View style={[styles.section, { borderTopColor: palette.border }]}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>Privacy</Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Read how Studi handles account, session, message, and analytics data, or email us with
            a specific request.
          </Text>
          <View style={styles.actions}>
            <ExternalLink href={STUDI_PRIVACY_POLICY_URL as Href & string} asChild>
              <Button
                label="Read the privacy policy"
                icon="lock.shield.fill"
                variant="secondary"
                fullWidth
              />
            </ExternalLink>
            <ExternalLink href={privacyEmailHref} asChild>
              <Button
                label="Email a privacy request"
                icon="envelope.fill"
                variant="ghost"
                fullWidth
              />
            </ExternalLink>
          </View>
        </View>
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
    gap: Space.md,
    paddingBottom: Space.xl,
  },
  title: {
    ...TypeScale.display,
    fontFamily: FontFamily.serifItalic,
  },
  lead: {
    ...TypeScale.body,
    maxWidth: 520,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Space.lg,
    paddingVertical: Space.xl,
  },
  sectionTitle: {
    ...TypeScale.sectionTitle,
  },
  body: {
    ...TypeScale.body,
  },
  helpList: {
    gap: Space.xl,
  },
  helpItem: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Space.md,
  },
  helpIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  helpCopy: {
    flex: 1,
    gap: Space.xs,
  },
  helpTitle: {
    ...TypeScale.bodyStrong,
  },
  actions: {
    gap: Space.sm,
  },
});
