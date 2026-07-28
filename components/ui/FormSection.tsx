import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Colors, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type FormSectionProps = {
  icon: IconSymbolName;
  title: string;
  caption?: string;
  children: ReactNode;
};

/**
 * One block of a long form (new session, rate a spot). A rule and generous
 * space separate sections instead of a card — the form is one scrollable
 * flow, not a stack of nested containers. Shared so every multi-part form
 * reads the same way instead of each screen styling its own headings.
 */
export function FormSection({ icon, title, caption, children }: FormSectionProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return (
    <View style={[styles.section, { borderTopColor: palette.border }]}>
      <View style={styles.header}>
        <IconSymbol color={palette.tint} name={icon} size={19} />
        <Text style={[TypeScale.sectionTitle, styles.title, { color: palette.text }]}>
          {title}
        </Text>
        {caption ? <Text style={[TypeScale.caption, { color: palette.icon }]}>{caption}</Text> : null}
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** Quiet label for a group inside a section (e.g. "Duration" under Time). */
export function FieldLabel({ children }: { children: ReactNode }) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];

  return <Text style={[TypeScale.label, styles.fieldLabel, { color: palette.icon }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: 1,
    gap: Space.md,
    paddingTop: Space.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  title: {
    marginRight: Space.xs,
  },
  body: {
    gap: Space.md,
  },
  fieldLabel: {
    marginBottom: -Space.xs,
  },
});
