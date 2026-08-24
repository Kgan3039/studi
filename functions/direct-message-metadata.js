function compareTimestamps(left, right) {
  if (
    Number.isInteger(left?.seconds)
    && Number.isInteger(left?.nanoseconds)
    && Number.isInteger(right?.seconds)
    && Number.isInteger(right?.nanoseconds)
  ) {
    if (left.seconds !== right.seconds) {
      return left.seconds < right.seconds ? -1 : 1;
    }
    if (left.nanoseconds !== right.nanoseconds) {
      return left.nanoseconds < right.nanoseconds ? -1 : 1;
    }
    return 0;
  }

  if (typeof left?.toMillis === 'function' && typeof right?.toMillis === 'function') {
    const leftMillis = left.toMillis();
    const rightMillis = right.toMillis();
    return leftMillis === rightMillis ? 0 : leftMillis < rightMillis ? -1 : 1;
  }

  return null;
}

function deriveDirectMessageMetadata(message, messageId, currentLastMessageAt, currentLastMessageId) {
  const senderId = typeof message?.senderId === 'string' ? message.senderId : '';
  const rawText = typeof message?.text === 'string' ? message.text.trim() : '';
  const text = message?.unsentAt && !rawText ? 'Message unsent' : rawText;
  const createdAt = message?.createdAt;

  if (
    !senderId
    || !text
    || typeof messageId !== 'string'
    || messageId.length === 0
    || typeof createdAt?.toMillis !== 'function'
  ) {
    return null;
  }

  const timestampOrder = compareTimestamps(currentLastMessageAt, createdAt);
  if (
    timestampOrder === 1
    || (
      timestampOrder === 0
      && typeof currentLastMessageId === 'string'
      && currentLastMessageId >= messageId
    )
  ) {
    return null;
  }

  return {
    lastMessagePreview: text.slice(0, 200),
    lastMessageAt: createdAt,
    lastMessageId: messageId,
    updatedAt: createdAt,
  };
}

function deriveDirectMessageUpdateMetadata(
  message,
  messageId,
  currentLastMessageId
) {
  if (
    typeof messageId !== 'string'
    || !messageId
    || currentLastMessageId !== messageId
    || typeof message?.senderId !== 'string'
    || typeof message?.createdAt?.toMillis !== 'function'
  ) {
    return null;
  }

  if (message.unsentAt && message.text === '') {
    return { lastMessagePreview: 'Message unsent' };
  }

  const editedText = typeof message?.text === 'string' ? message.text.trim() : '';
  if (!message?.unsentAt && !!message?.editedAt && editedText) {
    return { lastMessagePreview: editedText.slice(0, 200) };
  }

  return null;
}

module.exports = { deriveDirectMessageMetadata, deriveDirectMessageUpdateMetadata };
