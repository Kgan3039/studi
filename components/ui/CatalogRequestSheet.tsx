import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { SuccessToast, useSuccessToast } from '@/components/ui/Toast';
import { Brand, Colors, FontFamily, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
import { catalogRequestErrorMessage } from '@/lib/catalog-request';
import {
  submitCatalogRequest,
  type CatalogRequestType,
} from '@/lib/firestore';
import { track } from '@/lib/analytics';
import type { User } from 'firebase/auth';

type CatalogRequestSheetProps = {
  initialQuery?: string;
  source: string;
  type: CatalogRequestType;
  visible: boolean;
  onClose: () => void;
};

type CatalogRequestLinkProps = {
  context?: 'catalog' | 'search';
  onPress: () => void;
  type: CatalogRequestType;
};

export function CatalogRequestLink({
  context = 'search',
  onPress,
  type,
}: CatalogRequestLinkProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const question =
    type === 'course'
      ? 'Can’t find a class?'
      : context === 'catalog'
        ? 'Can’t find a study spot?'
        : 'Can’t find this spot?';
  const label = `${question} Send a request`;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.requestLink,
        { opacity: pressed ? 0.62 : 1 },
      ]}>
      <Text style={[TypeScale.caption, styles.requestLinkText, { color: palette.icon }]}>
        {question}{' '}
        <Text style={[styles.requestLinkAction, { color: palette.tint }]}>Send a request</Text>
      </Text>
    </Pressable>
  );
}

export function CatalogRequestSheet({
  initialQuery = '',
  source,
  type,
  visible,
  onClose,
}: CatalogRequestSheetProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isLocation = type === 'location';
  const { toast, show: showToast } = useSuccessToast();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState(setCurrentUser);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setName(initialQuery.trim());
    setDetails('');
    setError('');
  }, [initialQuery, visible]);

  function handleClose() {
    if (!isSubmitting) {
      onClose();
    }
  }

  async function handleSubmit() {
    const trimmedName = name.trim();

    if (trimmedName.length < 2) {
      setError(`Enter the ${isLocation ? 'location' : 'course'} name first.`);
      return;
    }

    if (!currentUser) {
      setError('You need to be signed in to submit a request.');
      return;
    }

    if (!currentUser.emailVerified) {
      setError('Verify your UW email before submitting a request.');
      return;
    }

    try {
      setError('');
      setIsSubmitting(true);
      await submitCatalogRequest(currentUser.uid, {
        type,
        name: trimmedName,
        searchQuery: initialQuery,
        details,
        source,
      });
      track('catalog_request_submitted', { type, source });
      onClose();
      showToast(
        'Request sent',
        `We’ll review this ${isLocation ? 'study spot' : 'course'} before it appears for everyone.`
      );
    } catch (requestError) {
      setError(catalogRequestErrorMessage(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
    <Sheet
      visible={visible}
      onClose={handleClose}
      title={isLocation ? 'Suggest a study spot' : 'Suggest a course'}
      subtitle={
        isLocation
          ? 'Help us keep campus locations current.'
          : 'Help us keep the course list current.'
      }
      footer={
        <Button
          fullWidth
          label="Submit request"
          loading={isSubmitting}
          onPress={handleSubmit}
        />
      }>
      <View style={styles.form}>
        <Input
          autoCapitalize={isLocation ? 'words' : 'characters'}
          editable={!isSubmitting}
          error={error}
          label={isLocation ? 'Location name' : 'Course name or code'}
          maxLength={120}
          onChangeText={(value) => {
            setName(value);
            if (error) {
              setError('');
            }
          }}
          placeholder={isLocation ? 'Example: Science Hall' : 'Example: CS 540'}
          value={name}
        />

        <Input
          editable={!isSubmitting}
          helper="Optional"
          label="Additional details"
          maxLength={500}
          multiline
          numberOfLines={4}
          onChangeText={setDetails}
          placeholder={
            isLocation
              ? 'Tell us anything useful about this spot.'
              : 'Add the department, title, or term if you know it.'
          }
          textAlignVertical="top"
          value={details}
        />

        <View
          style={[
            styles.note,
            { backgroundColor: colorScheme === 'dark' ? `${Brand.info}20` : `${Brand.info}0D` },
          ]}>
          <IconSymbol color={Brand.info} name="info.circle" size={17} />
          <Text style={[TypeScale.caption, styles.noteText, { color: palette.icon }]}>
            We’ll review requests before they appear for everyone.
          </Text>
        </View>
      </View>
    </Sheet>
    <SuccessToast toast={toast} />
    </>
  );
}

const styles = StyleSheet.create({
  requestLink: {
    alignSelf: 'flex-start',
    paddingVertical: Space.xs,
  },
  requestLinkText: {
    lineHeight: 20,
  },
  requestLinkAction: {
    fontFamily: FontFamily.bodySemiBold,
    textDecorationLine: 'underline',
  },
  form: {
    gap: Space.lg,
  },
  note: {
    alignItems: 'flex-start',
    borderRadius: Radius.lg,
    flexDirection: 'row',
    gap: Space.sm,
    padding: Space.md,
  },
  noteText: {
    flex: 1,
    lineHeight: 19,
  },
});
