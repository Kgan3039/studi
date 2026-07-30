import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CourseChip } from '@/components/ui/CourseChip';
import { Button } from '@/components/ui/Button';
import {
  CatalogRequestButton,
  CatalogRequestSheet,
} from '@/components/ui/CatalogRequestSheet';
import { Input } from '@/components/ui/Input';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StepDots } from '@/components/ui/StepDots';
import { Colors, FontFamily, Space, TypeScale } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { identifyUser, track } from '@/lib/analytics';
import { subscribeToAuthState } from '@/lib/auth';
import { UW_COURSE_CATALOG, formatCourseTitle, searchCourses } from '@/lib/catalog';
import { getUserProfile, invalidateProfileCache, updateUserClasses } from '@/lib/firestore';
import type { User } from 'firebase/auth';

export default function OnboardingClassesScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [courseQuery, setCourseQuery] = useState('');
  const [classes, setClasses] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [requestSheetOpen, setRequestSheetOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setCurrentUser(user);

      // Onboarding steps require a signed-in account; bail to welcome otherwise.
      if (!user) {
        router.replace('/welcome');
      }
    });

    return unsubscribe;
  }, [router]);

  useEffect(() => {
    if (!currentUser || !currentUser.emailVerified) {
      return;
    }

    getUserProfile(currentUser.uid)
      .then((profile) => {
        if (profile?.classes?.length) {
          setClasses(profile.classes);
        }
      })
      .catch(() => {});
  }, [currentUser]);

  const courseResults = useMemo(() => {
    if (courseQuery.trim().length < 2) {
      return [];
    }
    return searchCourses(courseQuery, classes, 8);
  }, [classes, courseQuery]);

  const courseTitlesByCode = useMemo(() => {
    const titles = new Map<string, string>();
    for (const course of UW_COURSE_CATALOG) {
      if (!titles.has(course.code.toUpperCase())) {
        titles.set(course.code.toUpperCase(), formatCourseTitle(course.title));
      }
    }
    return titles;
  }, []);

  function handleAddCourse(code: string) {
    setClasses((current) =>
      current.includes(code.toUpperCase()) ? current : [...current, code.toUpperCase()]
    );
    setCourseQuery('');
  }

  function handleRemoveCourse(code: string) {
    setClasses((current) => current.filter((classCode) => classCode !== code));
  }

  async function handleContinue() {
    if (!currentUser) {
      return;
    }

    if (classes.length === 0) {
      router.replace('/profile-setup');
      return;
    }

    try {
      setIsSaving(true);
      await updateUserClasses(currentUser.uid, classes);
      invalidateProfileCache(currentUser.uid);
      track('classes_saved', { count: classes.length });
      identifyUser(currentUser.uid, { classCount: classes.length });
      router.replace('/profile-setup');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save classes right now.';
      Alert.alert('Classes Error', message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + Space.sm }]}>
        <View style={styles.headerSpacer} />
        <StepDots total={4} filled={3} />
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          hitSlop={8}
          onPress={() => router.replace('/profile-setup')}>
          <Text style={[TypeScale.label, { color: palette.icon }]}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}>
        <Text style={[styles.question, { color: palette.text }]}>What are you taking?</Text>
        <Text style={[TypeScale.body, styles.subtext, { color: palette.icon }]}>
          We’ll only show sessions for your classes.
        </Text>

        <View style={styles.searchRow}>
          <Input
            autoCapitalize="characters"
            containerStyle={styles.searchField}
            editable={!isSaving}
            onChangeText={setCourseQuery}
            placeholder="Search by course code or title…"
            value={courseQuery}
          />
          <CatalogRequestButton
            type="course"
            onPress={() => setRequestSheetOpen(true)}
          />
        </View>

        {courseResults.length > 0 ? (
          <View style={styles.rows}>
            {courseResults.map((course) => (
              <Pressable
                key={`${course.code}-${course.title}`}
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => handleAddCourse(course.code)}
                style={({ pressed }) => [
                  styles.courseRow,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <View style={styles.courseInfo}>
                  <CourseChip code={course.code} size="sm" />
                  <Text
                    style={[TypeScale.bodyStrong, styles.courseTitle, { color: palette.text }]}
                    numberOfLines={1}>
                    {formatCourseTitle(course.title)}
                  </Text>
                </View>
                <View style={[styles.selectCircle, { borderColor: palette.outline }]} />
              </Pressable>
            ))}
          </View>
        ) : courseQuery.trim().length >= 2 ? (
          <View style={styles.noResultsBlock}>
            <Text style={[TypeScale.body, styles.noResults, { color: palette.icon }]}>
              No courses matched that search yet.
            </Text>
            <Button
              icon="plus.circle.fill"
              label="Request this course"
              onPress={() => setRequestSheetOpen(true)}
              size="sm"
              variant="secondary"
            />
          </View>
        ) : null}

        {classes.length > 0 ? (
          <View style={styles.selectedBlock}>
            <Text style={[TypeScale.sectionTitle, { color: palette.text }]}>Your classes</Text>
            <View style={styles.rows}>
              {classes.map((classCode) => (
                <Pressable
                  key={classCode}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${classCode}`}
                  disabled={isSaving}
                  onPress={() => handleRemoveCourse(classCode)}
                  style={({ pressed }) => [
                    styles.courseRow,
                    {
                      backgroundColor:
                        colorScheme === 'dark' ? `${palette.tint}26` : `${palette.tint}0D`,
                      borderColor: palette.tint,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}>
                  <View style={styles.courseInfo}>
                    <CourseChip code={classCode} size="sm" />
                    <Text
                      style={[TypeScale.bodyStrong, styles.courseTitle, { color: palette.text }]}
                      numberOfLines={1}>
                      {courseTitlesByCode.get(classCode) ?? 'UW Madison course'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.selectCircle,
                      styles.selectedCircle,
                      { backgroundColor: palette.tint, borderColor: palette.tint },
                    ]}>
                    <IconSymbol color="#FFFFFF" name="checkmark.circle.fill" size={19} />
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Space.lg) + Space.sm }]}>
        <Button
          label={
            classes.length > 0
              ? `Continue (${classes.length} selected)`
              : 'Continue'
          }
          size="lg"
          fullWidth
          loading={isSaving}
          onPress={handleContinue}
        />
      </View>
      <CatalogRequestSheet
        initialQuery={courseQuery}
        onClose={() => setRequestSheetOpen(false)}
        source="onboarding-classes"
        type="course"
        visible={requestSheetOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: Space.md,
    paddingHorizontal: Space.xl,
  },
  headerSpacer: {
    width: 28,
  },
  content: {
    paddingBottom: Space.xl,
    paddingHorizontal: Space.xl,
  },
  question: {
    fontFamily: FontFamily.serifItalic,
    fontSize: 32,
    lineHeight: 36,
    marginTop: Space.xs,
  },
  subtext: {
    marginTop: Space.sm,
  },
  search: {
    marginTop: Space.xl,
  },
  searchRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: Space.sm,
    marginTop: Space.xl,
  },
  searchField: {
    flex: 1,
    marginTop: 0,
  },
  rows: {
    gap: Space.sm,
    marginTop: Space.md,
  },
  courseRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    gap: Space.md,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: Space.md,
    paddingVertical: Space.md - 2,
  },
  courseInfo: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Space.md,
  },
  courseTitle: {
    flexShrink: 1,
  },
  selectCircle: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  selectedCircle: {
    borderWidth: 0,
  },
  noResults: {
    flex: 1,
  },
  noResultsBlock: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    marginTop: Space.md,
  },
  selectedBlock: {
    marginTop: Space.xl,
  },
  footer: {
    paddingHorizontal: Space.xl,
    paddingTop: Space.sm,
  },
});
