import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemedText } from './themed-text';

const MINUTES_IN_DAY = 24 * 60;
const TIME_STEP_MINUTES = 30;

export const TIME_OPTIONS = Array.from({ length: MINUTES_IN_DAY / TIME_STEP_MINUTES }, (_, index) => {
  const totalMinutes = index * TIME_STEP_MINUTES;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
});

export function formatTimeLabel(time: string) {
  const [hourValue, minuteValue] = time.split(':').map(Number);
  const period = hourValue >= 12 ? 'PM' : 'AM';
  const displayHour = hourValue % 12 === 0 ? 12 : hourValue % 12;
  return `${displayHour}:${minuteValue.toString().padStart(2, '0')} ${period}`;
}

type TimeDropdownProps = {
  disabled?: boolean;
  disabledOption?: (time: string) => boolean;
  label: string;
  onChange: (time: string) => void;
  placeholder?: string;
  value: string;
};

export function TimeDropdown({
  disabled = false,
  disabledOption,
  label,
  onChange,
  placeholder = 'Select time',
  value,
}: TimeDropdownProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = value ? formatTimeLabel(value) : placeholder;

  function handleSelect(time: string) {
    onChange(time);
    setIsOpen(false);
  }

  return (
    <View style={styles.container}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <Pressable
        disabled={disabled}
        onPress={() => setIsOpen((currentValue) => !currentValue)}
        style={[
          styles.trigger,
          {
            backgroundColor: palette.surface,
            borderColor: palette.outline,
            opacity: disabled ? 0.5 : 1,
          },
        ]}>
        <ThemedText type="defaultSemiBold">{selectedLabel}</ThemedText>
        <ThemedText style={styles.chevron}>{isOpen ? '^' : 'v'}</ThemedText>
      </Pressable>

      {isOpen ? (
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          contentContainerStyle={styles.menuContent}
          style={[
            styles.menu,
            {
              backgroundColor: palette.surface,
              borderColor: palette.outline,
            },
          ]}>
          {TIME_OPTIONS.map((time) => {
            const isSelected = value === time;
            const isDisabled = disabledOption?.(time) ?? false;

            return (
              <Pressable
                disabled={isDisabled}
                key={time}
                onPress={() => handleSelect(time)}
                style={[
                  styles.option,
                  {
                    backgroundColor: isSelected ? palette.tint : 'transparent',
                    opacity: isDisabled ? 0.35 : 1,
                  },
                ]}>
                <ThemedText
                  type="defaultSemiBold"
                  lightColor={isSelected ? '#ffffff' : undefined}
                  darkColor={isSelected ? '#ffffff' : undefined}>
                  {formatTimeLabel(time)}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chevron: {
    fontSize: 12,
    opacity: 0.7,
  },
  container: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    letterSpacing: 1,
    opacity: 0.72,
    textTransform: 'uppercase',
  },
  menu: {
    borderRadius: 14,
    borderWidth: 1,
    maxHeight: 320,
  },
  menuContent: {
    paddingVertical: 4,
  },
  option: {
    borderRadius: 12,
    marginHorizontal: 6,
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  trigger: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 14,
  },
});
