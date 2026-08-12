"use strict";

const FRIEND_REQUEST_ERROR_TITLE = "Friend Request";
const FRIEND_REQUEST_ERROR_COPY = Object.freeze({
  cooldown: "Please wait a few seconds before sending another friend request.",
  relationship: "This friend request is no longer available.",
  network: "Unable to send the friend request right now. Please try again.",
  auth: "Please sign in with your verified UW account and try again.",
  generic: "Unable to send the friend request right now.",
});

class FriendRequestCooldownError extends Error {
  constructor() {
    super(FRIEND_REQUEST_ERROR_COPY.cooldown);
    this.name = "FriendRequestCooldownError";
    this.code = "friend-request/cooldown";
  }
}

class FriendRequestAuthError extends Error {
  constructor() {
    super(FRIEND_REQUEST_ERROR_COPY.auth);
    this.name = "FriendRequestAuthError";
    this.code = "friend-request/auth";
  }
}

function errorCode(error) {
  return error && typeof error === "object" && typeof error.code === "string"
    ? error.code.toLowerCase()
    : "";
}

function mapFriendRequestError(error) {
  const code = errorCode(error);

  if (code === "friend-request/cooldown") return FRIEND_REQUEST_ERROR_COPY.cooldown;
  if (code === "friend-request/auth") return FRIEND_REQUEST_ERROR_COPY.auth;
  if (
    code === "already-exists" ||
    code === "failed-precondition" ||
    code === "friend-request/relationship-changed"
  ) {
    return FRIEND_REQUEST_ERROR_COPY.relationship;
  }
  if (
    code === "unavailable" ||
    code === "firestore/unavailable" ||
    code === "deadline-exceeded" ||
    code === "firestore/deadline-exceeded" ||
    code === "auth/network-request-failed"
  ) {
    return FRIEND_REQUEST_ERROR_COPY.network;
  }
  if (
    code === "unauthenticated" ||
    code === "auth/user-disabled" ||
    code === "auth/user-token-expired" ||
    code === "auth/invalid-user-token"
  ) {
    return FRIEND_REQUEST_ERROR_COPY.auth;
  }

  // permission-denied is intentionally generic. Rules use it for cooldown,
  // blocks, stale verification, and relationship races; the raw code alone is
  // not trusted evidence of which condition occurred.
  return FRIEND_REQUEST_ERROR_COPY.generic;
}

async function showFriendRequestFailure({
  error,
  platform,
  showNativeAlert,
  showWebAlert,
}) {
  const message = mapFriendRequestError(error);
  try {
    if (platform === "web") {
      await showWebAlert(`${FRIEND_REQUEST_ERROR_TITLE}\n\n${message}`);
    } else {
      await showNativeAlert(FRIEND_REQUEST_ERROR_TITLE, message);
    }
  } catch {
    // Feedback failure must never turn an already-handled write failure into
    // an unhandled rejection or trigger a retry.
  }
  return message;
}

module.exports = {
  FRIEND_REQUEST_ERROR_COPY,
  FRIEND_REQUEST_ERROR_TITLE,
  FriendRequestAuthError,
  FriendRequestCooldownError,
  mapFriendRequestError,
  showFriendRequestFailure,
};
