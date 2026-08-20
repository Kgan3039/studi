function deriveDirectMessageMetadata(message, currentLastMessageAt) {
  const senderId = typeof message?.senderId === 'string' ? message.senderId : '';
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  const createdAt = message?.createdAt;

  if (!senderId || !text || typeof createdAt?.toMillis !== 'function') {
    return null;
  }
  const currentIsNewer =
    Number.isInteger(currentLastMessageAt?.seconds)
    && Number.isInteger(currentLastMessageAt?.nanoseconds)
    && Number.isInteger(createdAt?.seconds)
    && Number.isInteger(createdAt?.nanoseconds)
      ? currentLastMessageAt.seconds > createdAt.seconds
        || (
          currentLastMessageAt.seconds === createdAt.seconds
          && currentLastMessageAt.nanoseconds > createdAt.nanoseconds
        )
      : typeof currentLastMessageAt?.toMillis === 'function'
        && currentLastMessageAt.toMillis() > createdAt.toMillis();
  if (currentIsNewer) {
    return null;
  }

  return {
    lastMessagePreview: text.slice(0, 200),
    lastMessageAt: createdAt,
    updatedAt: createdAt,
  };
}

module.exports = { deriveDirectMessageMetadata };
