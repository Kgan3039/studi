const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;
const MESSAGE_UNSEND_WINDOW_MS = 2 * 60 * 1000;
const MESSAGE_DOUBLE_TAP_WINDOW_MS = 320;

function timestampToMillis(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value && typeof value === 'object' && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return 0;
}

function isMessageUnsent(message) {
  return !!message?.unsentAt;
}

function normalizeMessageLikedByIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value.filter(
      (userId) => typeof userId === 'string' && userId.length > 0 && userId.length <= 128
    )
  )].slice(0, 20);
}

function isMessageDoubleTap(previousTapMs, currentTapMs) {
  return (
    Number.isFinite(previousTapMs)
    && Number.isFinite(currentTapMs)
    && previousTapMs > 0
    && currentTapMs >= previousTapMs
    && currentTapMs - previousTapMs <= MESSAGE_DOUBLE_TAP_WINDOW_MS
  );
}

function isWithinActionWindow(message, userId, windowMs, nowMs) {
  const createdAtMs = timestampToMillis(message?.createdAt);
  if (
    !userId
    || message?.senderId !== userId
    || message?.pending === true
    || isMessageUnsent(message)
    || createdAtMs <= 0
  ) {
    return false;
  }

  const ageMs = nowMs - createdAtMs;
  return ageMs >= -5_000 && ageMs <= windowMs;
}

function canEditMessage(message, userId, nowMs = Date.now()) {
  return isWithinActionWindow(message, userId, MESSAGE_EDIT_WINDOW_MS, nowMs);
}

function canUnsendMessage(message, userId, nowMs = Date.now()) {
  return isWithinActionWindow(message, userId, MESSAGE_UNSEND_WINDOW_MS, nowMs);
}

function hasMessageTextChanged(currentText, nextText) {
  const normalizedCurrent = typeof currentText === 'string' ? currentText.trim() : '';
  const normalizedNext = typeof nextText === 'string' ? nextText.trim() : '';
  return normalizedNext.length > 0 && normalizedNext !== normalizedCurrent;
}

function toggleSelectedMessageId(selectedMessageIds, messageId) {
  const next = new Set(selectedMessageIds ?? []);
  if (next.has(messageId)) {
    next.delete(messageId);
  } else {
    next.add(messageId);
  }
  return next;
}

function buildSelectedMessageCopy(messages, selectedMessageIds) {
  const selected = new Set(selectedMessageIds ?? []);

  return [...(messages ?? [])]
    .filter(
      (message) =>
        selected.has(message?.messageId)
        && !isMessageUnsent(message)
        && typeof message?.text === 'string'
        && message.text.trim().length > 0
    )
    .sort((left, right) => {
      const timestampDifference =
        timestampToMillis(left.createdAt) - timestampToMillis(right.createdAt);
      return timestampDifference || String(left.messageId).localeCompare(String(right.messageId));
    })
    .map((message) => message.text.trim())
    .join('\n');
}

module.exports = {
  MESSAGE_EDIT_WINDOW_MS,
  MESSAGE_DOUBLE_TAP_WINDOW_MS,
  MESSAGE_UNSEND_WINDOW_MS,
  buildSelectedMessageCopy,
  canEditMessage,
  canUnsendMessage,
  hasMessageTextChanged,
  isMessageUnsent,
  isMessageDoubleTap,
  normalizeMessageLikedByIds,
  timestampToMillis,
  toggleSelectedMessageId,
};
