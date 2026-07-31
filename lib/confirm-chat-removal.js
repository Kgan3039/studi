"use strict";

const REMOVE_CHAT_TITLE = "Remove from my Messages?";
const REMOVE_CHAT_MESSAGE =
  "This hides the chat only for you. Messages and session membership will not change.";
const REMOVE_CHAT_FAILURE_TITLE = "Couldn't remove from Messages";
const REMOVE_CHAT_FAILURE_MESSAGE = "Please try again.";

function confirmChatRemoval({ platform, showNativeAlert, showWebConfirm, onConfirm }) {
  if (platform === "web") {
    const confirmed = showWebConfirm(`${REMOVE_CHAT_TITLE}\n\n${REMOVE_CHAT_MESSAGE}`);
    if (confirmed) {
      onConfirm();
    }
    return;
  }

  showNativeAlert(REMOVE_CHAT_TITLE, REMOVE_CHAT_MESSAGE, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: onConfirm },
  ]);
}

async function showChatRemovalFailure({ platform, showNativeAlert, showWebAlert }) {
  try {
    if (platform === "web") {
      await showWebAlert(
        `${REMOVE_CHAT_FAILURE_TITLE}\n\n${REMOVE_CHAT_FAILURE_MESSAGE}`
      );
      return;
    }

    await showNativeAlert(REMOVE_CHAT_FAILURE_TITLE, REMOVE_CHAT_FAILURE_MESSAGE);
  } catch {
    // Failure feedback must never replace the original handled write failure.
  }
}

module.exports = {
  REMOVE_CHAT_FAILURE_MESSAGE,
  REMOVE_CHAT_FAILURE_TITLE,
  REMOVE_CHAT_MESSAGE,
  REMOVE_CHAT_TITLE,
  confirmChatRemoval,
  showChatRemovalFailure,
};
