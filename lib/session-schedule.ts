export const MAX_DAYS_IN_FUTURE = 30;

type ParsedDate = {
  year: number;
  month: number;
  day: number;
};

type ParsedTime = {
  hour: number;
  minute: number;
};

export type SessionScheduleValidation =
  | {
      startTimeIso: string;
      endTimeIso: string;
    }
  | {
      error: string;
    };

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateInput(value: string): ParsedDate | null {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseTimeInput(value: string): ParsedTime | null {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

export function validateDateOnly(value: string): string | null {
  const parsedDate = parseDateInput(value);

  if (!parsedDate) {
    return 'Enter a valid date in YYYY-MM-DD format, like 2026-04-22.';
  }

  const date = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day);
  const now = new Date();
  const today = startOfDay(now);
  const selectedDay = startOfDay(date);
  const maxAllowedDay = startOfDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_DAYS_IN_FUTURE)
  );

  if (selectedDay < today) {
    return 'Dates in the past are not allowed. Choose today or a future date.';
  }

  if (selectedDay > maxAllowedDay) {
    return `Dates more than ${MAX_DAYS_IN_FUTURE} days in the future are not viable. Choose a date within the next ${MAX_DAYS_IN_FUTURE} days.`;
  }

  return null;
}

export function validateSessionSchedule(
  dateValue: string,
  startValue: string,
  endValue: string
): SessionScheduleValidation {
  const parsedDate = parseDateInput(dateValue);

  if (!parsedDate) {
    return { error: 'Enter a valid date in YYYY-MM-DD format, like 2026-04-22.' };
  }

  const parsedStartTime = parseTimeInput(startValue);
  const parsedEndTime = parseTimeInput(endValue);

  if (!parsedStartTime || !parsedEndTime) {
    return { error: 'Use 24-hour time in HH:MM format, like 18:30 or 09:15.' };
  }

  const sessionStart = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    parsedStartTime.hour,
    parsedStartTime.minute
  );
  const sessionEnd = new Date(
    parsedDate.year,
    parsedDate.month - 1,
    parsedDate.day,
    parsedEndTime.hour,
    parsedEndTime.minute
  );

  if (sessionEnd <= sessionStart) {
    return { error: 'Set an end time that is after the start time.' };
  }

  const now = new Date();
  const today = startOfDay(now);
  const selectedDay = startOfDay(sessionStart);
  const maxAllowedDay = startOfDay(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + MAX_DAYS_IN_FUTURE)
  );

  if (selectedDay < today) {
    return { error: 'Dates in the past are not allowed. Choose today or a future date.' };
  }

  if (selectedDay.getTime() === today.getTime() && sessionStart <= now) {
    return { error: "For today's sessions, choose a start time later than the current time." };
  }

  if (selectedDay > maxAllowedDay) {
    return {
      error: `Dates more than ${MAX_DAYS_IN_FUTURE} days in the future are not viable. Choose a date within the next ${MAX_DAYS_IN_FUTURE} days.`,
    };
  }

  return {
    startTimeIso: sessionStart.toISOString(),
    endTimeIso: sessionEnd.toISOString(),
  };
}
