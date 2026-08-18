'use strict';

const SAFE_PROFILE_SAVE_ERROR = 'Unable to save your profile right now.';
const SAFE_PROFILE_SAVE_AUTH_ERROR =
  'Please sign in with your verified UW account and try again.';
const SAFE_PROFILE_SAVE_NETWORK_ERROR =
  'Unable to save your profile right now. Please try again.';
const SAFE_PROFILE_MODERATION_ERROR = 'Please revise this text before posting it.';

// Remove emoji bases and every formatting component that can remain after a
// composed sequence is split, including subdivision-flag tag characters.
const PROFILE_IDENTITY_EMOJI_PATTERN =
  /(?:[0-9#*]\uFE0F?\u20E3|[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}])/gu;

function stripProfileIdentityEmoji(value) {
  return typeof value === 'string' ? value.replace(PROFILE_IDENTITY_EMOJI_PATTERN, '') : '';
}

function getProfileSaveErrorMessage(error) {
  if (error && typeof error === 'object' && error.name === 'ObjectionableContentError') {
    return SAFE_PROFILE_MODERATION_ERROR;
  }

  const code =
    error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : '';

  if (
    code === 'unauthenticated' ||
    code === 'auth/user-disabled' ||
    code === 'auth/user-token-expired' ||
    code === 'auth/invalid-user-token'
  ) {
    return SAFE_PROFILE_SAVE_AUTH_ERROR;
  }

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'auth/network-request-failed'
  ) {
    return SAFE_PROFILE_SAVE_NETWORK_ERROR;
  }

  return SAFE_PROFILE_SAVE_ERROR;
}

module.exports = {
  SAFE_PROFILE_SAVE_AUTH_ERROR,
  SAFE_PROFILE_SAVE_ERROR,
  SAFE_PROFILE_SAVE_NETWORK_ERROR,
  SAFE_PROFILE_MODERATION_ERROR,
  getProfileSaveErrorMessage,
  stripProfileIdentityEmoji,
};
