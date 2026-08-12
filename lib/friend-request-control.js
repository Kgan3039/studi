"use strict";

const FRIEND_REQUEST_COOLDOWN_SECONDS = 10;
const FRIEND_REQUEST_COOLDOWN_MS = FRIEND_REQUEST_COOLDOWN_SECONDS * 1000;

const cooldownEndsAtByUserId = new Map();
const inFlightUserIds = new Set();
const listenersByUserId = new Map();

function notifyUser(userId) {
  const listeners = listenersByUserId.get(userId);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

function getFriendRequestCooldownSeconds(userId, now = Date.now()) {
  if (typeof userId !== "string" || userId.length === 0) return 0;
  const deadline = cooldownEndsAtByUserId.get(userId) ?? 0;
  if (deadline <= now) {
    cooldownEndsAtByUserId.delete(userId);
    return 0;
  }
  return Math.ceil((deadline - now) / 1000);
}

function startFriendRequestCooldown(userId, now = Date.now()) {
  if (typeof userId !== "string" || userId.length === 0) return;
  cooldownEndsAtByUserId.set(userId, now + FRIEND_REQUEST_COOLDOWN_MS);
  notifyUser(userId);
}

function subscribeToFriendRequestCooldown(userId, listener) {
  if (typeof userId !== "string" || userId.length === 0) return () => {};
  const listeners = listenersByUserId.get(userId) ?? new Set();
  listeners.add(listener);
  listenersByUserId.set(userId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByUserId.delete(userId);
  };
}

function isFriendRequestSendInFlight(userId) {
  return inFlightUserIds.has(userId);
}

function canAttemptFriendRequest(userId, now = Date.now()) {
  return (
    typeof userId === "string" &&
    userId.length > 0 &&
    !isFriendRequestSendInFlight(userId) &&
    getFriendRequestCooldownSeconds(userId, now) === 0
  );
}

async function runFriendRequestSend({ userId, send, now = Date.now }) {
  if (!canAttemptFriendRequest(userId, now())) {
    return {
      status: isFriendRequestSendInFlight(userId) ? "ignored" : "cooldown",
    };
  }

  // Claimed synchronously before send() or any await. Every screen shares this
  // set, so rapid taps across two mounted surfaces still produce one write.
  inFlightUserIds.add(userId);
  try {
    await send();
    startFriendRequestCooldown(userId, now());
    return { status: "sent" };
  } finally {
    inFlightUserIds.delete(userId);
  }
}

function __resetFriendRequestControlForTests() {
  cooldownEndsAtByUserId.clear();
  inFlightUserIds.clear();
  listenersByUserId.clear();
}

module.exports = {
  FRIEND_REQUEST_COOLDOWN_MS,
  FRIEND_REQUEST_COOLDOWN_SECONDS,
  __resetFriendRequestControlForTests,
  canAttemptFriendRequest,
  getFriendRequestCooldownSeconds,
  isFriendRequestSendInFlight,
  runFriendRequestSend,
  startFriendRequestCooldown,
  subscribeToFriendRequestCooldown,
};
