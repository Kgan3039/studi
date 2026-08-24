function normalizedLikedByIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((userId) => typeof userId === "string" && userId))];
}

function classifyMessageUpdate(before = {}, after = {}) {
  const messageSenderId = typeof after.senderId === "string" ? after.senderId : "";
  if (!messageSenderId) {
    return null;
  }

  const beforeLikes = new Set(normalizedLikedByIds(before.likedByIds));
  const afterLikes = normalizedLikedByIds(after.likedByIds);
  const addedLikes = afterLikes.filter((userId) => !beforeLikes.has(userId));
  if (addedLikes.length === 1 && afterLikes.length === beforeLikes.size + 1) {
    return { actorId: addedLikes[0], kind: "liked", messageSenderId };
  }

  if (!before.unsentAt && after.unsentAt && after.text === "") {
    return { actorId: messageSenderId, kind: "unsent", messageSenderId };
  }

  if (!after.unsentAt && after.editedAt && before.text !== after.text) {
    return { actorId: messageSenderId, kind: "edited", messageSenderId };
  }

  return null;
}

function isMessageUpdateStillCurrent(update, currentMessage = {}) {
  if (!update) {
    return false;
  }
  if (currentMessage.senderId !== update.messageSenderId) {
    return false;
  }
  if (update.kind === "liked") {
    return normalizedLikedByIds(currentMessage.likedByIds).includes(update.actorId);
  }
  if (update.kind === "unsent") {
    return !!currentMessage.unsentAt && currentMessage.text === "";
  }
  return !currentMessage.unsentAt && !!currentMessage.editedAt;
}

function possessive(name) {
  const normalized = typeof name === "string" && name.trim() ? name.trim() : "Student";
  return normalized.endsWith("s") ? `${normalized}'` : `${normalized}'s`;
}

function formatMessageUpdateBody({
  actorName,
  messageSenderName,
  recipientId,
  update,
}) {
  const actor = typeof actorName === "string" && actorName.trim() ? actorName.trim() : "Someone";
  if (update.kind === "edited") {
    return `${actor} edited their message.`;
  }
  if (update.kind === "unsent") {
    return `${actor} unsent a message.`;
  }
  if (recipientId === update.messageSenderId) {
    return `${actor} liked your message.`;
  }
  if (update.actorId === update.messageSenderId) {
    return `${actor} liked their message.`;
  }
  return `${actor} liked ${possessive(messageSenderName)} message.`;
}

module.exports = {
  classifyMessageUpdate,
  formatMessageUpdateBody,
  isMessageUpdateStillCurrent,
  normalizedLikedByIds,
  possessive,
};
