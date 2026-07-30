import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { FirebaseError } from 'firebase/app';

import { Button } from '@/components/ui/Button';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Input } from '@/components/ui/Input';
import { Sheet } from '@/components/ui/Sheet';
import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeToAuthState } from '@/lib/auth';
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

type CatalogRequestButtonProps = {
  onPress: () => void;
  type: CatalogRequestType;
};

export function CatalogRequestButton({ onPress, type }: CatalogRequestButtonProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const label = type === 'course' ? 'Suggest a course' : 'Suggest a study spot';

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.trigger,
        {
          backgroundColor: palette.surfaceMuted,
          borderColor: palette.outline,
          opacity: pressed ? 0.65 : 1,
        },
      ]}>
      <IconSymbol color={palette.tint} name="plus.circle.fill" size={21} />
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
      Alert.alert(
        'Request sent',
        `Thanks. We’ll review this ${isLocation ? 'study spot' : 'course'} and add it if it belongs in Studi.`
      );
    } catch (requestError) {
      const message =
        requestError instanceof FirebaseError && requestError.code === 'permission-denied'
          ? 'You can submit only one course or study spot request every 10 minutes. Please try again later.'
          : requestError instanceof Error
            ? requestError.message
            : 'Unable to submit your request right now.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
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
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
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
