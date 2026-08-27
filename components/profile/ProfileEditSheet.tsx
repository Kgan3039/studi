import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Brand, Colors, Radius, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  PROFILE_BIO_MAX_LENGTH,
  PROFILE_MAJOR_MAX_LENGTH,
  PROFILE_PRONOUNS_MAX_LENGTH,
  invalidateProfileCache,
  updateUserDisplayName,
  updateUserProfileDetails,
  USER_YEARS,
  type UserYear,
} from '@/lib/firestore';
import { track } from '@/lib/analytics';
import { getProfileSaveErrorMessage, stripProfileIdentityEmoji } from '@/lib/profile-edit';
import type { User } from 'firebase/auth';

export type ProfileEditValues = {
  displayName: string;
  year: UserYear | null;
  major: string;
  pronouns: string;
  bio: string;
};

type ProfileEditSheetProps = {
  currentUser: User | null;
  initialValues: ProfileEditValues;
  onClose: () => void;
  onSaved: (values: ProfileEditValues) => void;
  visible: boolean;
};

function splitDisplayName(displayName: string) {
  const normalized = displayName.trim();

  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName, ...rest] = normalized.split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

export function ProfileEditSheet({
  currentUser,
  initialValues,
  onClose,
  onSaved,
  visible,
}: ProfileEditSheetProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [isSaving, setIsSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [major, setMajor] = useState('');
  const [year, setYear] = useState<UserYear | null>(null);
  const [pronouns, setPronouns] = useState('');
  const [bio, setBio] = useState('');
  const [isBioFocused, setIsBioFocused] = useState(false);
  const [bioLayout, setBioLayout] = useState<{ y: number; height: number } | null>(null);
  const [savedFields, setSavedFields] = useState<ProfileEditValues>(initialValues);
  const [nameStatus, setNameStatus] = useState('Save your name so Studi looks more personal.');
  const lastInitialValuesKey = useRef<string | null>(null);
  const initialValuesKey = [
    initialValues.displayName,
    initialValues.year ?? '',
    initialValues.major,
    initialValues.pronouns,
    initialValues.bio,
  ].join('\u0000');

  useEffect(() => {
    if (lastInitialValuesKey.current === initialValuesKey) {
      return;
    }

    lastInitialValuesKey.current = initialValuesKey;
    const savedName = splitDisplayName(initialValues.displayName);
    setFirstName(savedName.firstName);
    setLastName(savedName.lastName);
    setMajor(initialValues.major);
    setYear(initialValues.year);
    setPronouns(initialValues.pronouns);
    setBio(initialValues.bio);
    setSavedFields(initialValues);
    setNameStatus(
      initialValues.displayName
        ? `Saved as ${initialValues.displayName}.`
        : 'Add your first and last name to personalize Studi.'
    );
  }, [initialValues, initialValuesKey]);

  function handleClose() {
    setIsBioFocused(false);
    setBioLayout(null);
    onClose();
  }

  async function handleSave() {
    if (!currentUser) {
      return;
    }

    const cleanFirstName = stripProfileIdentityEmoji(firstName).trim();
    const cleanLastName = stripProfileIdentityEmoji(lastName).trim();
    const displayName = `${cleanFirstName} ${cleanLastName}`.trim();

    if (!cleanFirstName || !cleanLastName) {
      setNameStatus('Enter both your first and last name.');
      Alert.alert('Profile Error', 'Please enter both your first and last name.');
      return;
    }

    const details = {
      year,
      major: stripProfileIdentityEmoji(major).trim(),
      pronouns: stripProfileIdentityEmoji(pronouns).trim(),
      bio: bio.trim(),
    };
    const nameChanged = displayName !== savedFields.displayName;
    const detailsChanged =
      details.year !== savedFields.year ||
      details.major !== savedFields.major ||
      details.pronouns !== savedFields.pronouns ||
      details.bio !== savedFields.bio;
    const fieldsChanged =
      Number(nameChanged) +
      Number(details.year !== savedFields.year) +
      Number(details.major !== savedFields.major) +
      Number(details.pronouns !== savedFields.pronouns) +
      Number(details.bio !== savedFields.bio);

    try {
      setIsSaving(true);
      if (nameChanged) {
        await updateUserDisplayName(currentUser.uid, displayName);
      }
      if (detailsChanged) {
        await updateUserProfileDetails(currentUser.uid, details);
      }
      if (fieldsChanged > 0) {
        invalidateProfileCache(currentUser.uid);
        track('profile_updated', { fieldsChanged });
      }

      const nextValues = { displayName, ...details };
      setSavedFields(nextValues);
      setFirstName(cleanFirstName);
      setLastName(cleanLastName);
      setMajor(details.major);
      setPronouns(details.pronouns);
      setBio(details.bio);
      setNameStatus(`Saved as ${displayName}.`);
      onSaved(nextValues);
      handleClose();
    } catch (error) {
      const message = getProfileSaveErrorMessage(error);
      setNameStatus(message);
      Alert.alert('Profile Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  const placeholderColor = colorScheme === 'dark' ? '#8A8174' : Brand.textSubtle;
  const inputColors = {
    backgroundColor: palette.surfaceMuted,
    borderColor: palette.border,
    color: palette.text,
  };

  return (
    <Sheet
      keyboardScrollTarget={isBioFocused ? bioLayout : null}
      onClose={handleClose}
      title="Edit Profile"
      subtitle={nameStatus}
      visible={visible}
      footer={
        <Button label="Save profile" fullWidth loading={isSaving} onPress={handleSave} />
      }>
      <View style={styles.inlineRow}>
        <TextInput
          autoCapitalize="words"
          editable={!isSaving}
          onChangeText={(value) => setFirstName(stripProfileIdentityEmoji(value))}
          onFocus={() => setIsBioFocused(false)}
          placeholder="First name"
          placeholderTextColor={placeholderColor}
          style={[styles.input, styles.flexInput, inputColors]}
          value={firstName}
        />

        <TextInput
          autoCapitalize="words"
          editable={!isSaving}
          onChangeText={(value) => setLastName(stripProfileIdentityEmoji(value))}
          onFocus={() => setIsBioFocused(false)}
          placeholder="Last name"
          placeholderTextColor={placeholderColor}
          style={[styles.input, styles.flexInput, inputColors]}
          value={lastName}
        />
      </View>

      <TextInput
        autoCapitalize="words"
        editable={!isSaving}
        maxLength={PROFILE_MAJOR_MAX_LENGTH}
        onChangeText={(value) => setMajor(stripProfileIdentityEmoji(value))}
        onFocus={() => setIsBioFocused(false)}
        placeholder="Major (e.g. Computer Science)"
        placeholderTextColor={placeholderColor}
        style={[styles.input, inputColors]}
        value={major}
      />

      <View style={styles.yearRow}>
        {USER_YEARS.map((yearOption) => {
          const selected = year === yearOption;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={isSaving}
              key={yearOption}
              onPress={() => setYear(selected ? null : yearOption)}
              style={({ pressed }) => [
                styles.yearChip,
                {
                  backgroundColor: selected ? palette.tint : palette.surfaceMuted,
                  borderColor: selected ? palette.tint : palette.border,
                  opacity: isSaving || pressed ? 0.7 : 1,
                },
              ]}>
              <Text style={[TypeScale.label, { color: selected ? '#FFFFFF' : palette.text }]}>
                {yearOption}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        autoCapitalize="none"
        editable={!isSaving}
        maxLength={PROFILE_PRONOUNS_MAX_LENGTH}
        onChangeText={(value) => setPronouns(stripProfileIdentityEmoji(value))}
        onFocus={() => setIsBioFocused(false)}
        placeholder="Pronouns (e.g. she/her)"
        placeholderTextColor={placeholderColor}
        style={[styles.input, inputColors]}
        value={pronouns}
      />

      <View
        onLayout={(event) => {
          const { height, y } = event.nativeEvent.layout;
          setBioLayout((current) =>
            current && current.height === height && current.y === y ? current : { height, y }
          );
        }}>
        <TextInput
          autoCapitalize="sentences"
          editable={!isSaving}
          maxLength={PROFILE_BIO_MAX_LENGTH}
          multiline
          onBlur={() => setIsBioFocused(false)}
          onChangeText={setBio}
          onFocus={() => setIsBioFocused(true)}
          placeholder="What are you studying toward?"
          placeholderTextColor={placeholderColor}
          style={[styles.input, styles.bioInput, inputColors]}
          value={bio}
        />
        <Text style={[TypeScale.caption, styles.bioCounter, { color: palette.icon }]}>
          {bio.length}/{PROFILE_BIO_MAX_LENGTH}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  yearRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  yearChip: {
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.sm,
  },
  bioInput: {
    minHeight: 88,
    paddingTop: Space.md,
    textAlignVertical: 'top',
  },
  bioCounter: {
    marginTop: Space.xs,
    textAlign: 'right',
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm + 2,
  },
  flexInput: {
    flex: 1,
  },
  input: {
    borderRadius: Radius.chip + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
});
