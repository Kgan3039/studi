const DOMAIN_COPY = {
  accountDeletion: 'Unable to delete your account right now. Please try again.',
  auth: 'Unable to continue right now. Please try again.',
  classes: 'Unable to save classes right now. Please try again.',
  conversation: 'Unable to update this conversation right now.',
  friend: 'Unable to update this study buddy right now.',
  message: 'Unable to send message right now.',
  passwordReset: 'Unable to send a reset email right now. Please try again.',
  profile: 'Unable to save your profile right now. Please try again.',
  profileLoad: 'Unable to load your profile right now.',
  rating: 'Unable to save your rating right now. Please try again.',
  report: 'Unable to submit the report right now. Please try again.',
  sessionJoin: 'Unable to join this session right now.',
  sessionLoad: 'Unable to load sessions right now.',
  settings: 'Unable to update settings right now. Please try again.',
  signOut: 'Unable to sign out right now. Please try again.',
  spots: 'The campus map could not load. Please try again.',
  verification: 'Unable to check verification right now. Please try again.',
  verificationEmail: 'Unable to resend the email right now. Please try again.',
};

function errorCode(error) {
  return error && typeof error === 'object' && typeof error.code === 'string'
    ? error.code.replace(/^firebase\//u, '')
    : '';
}

function getUserFacingErrorMessage(error, domain) {
  const fallback = DOMAIN_COPY[domain] ?? 'Unable to complete that action right now.';
  const code = errorCode(error);

  if (
    code === 'network-request-failed' ||
    code === 'unavailable' ||
    code === 'auth/network-request-failed'
  ) {
    return 'Check your connection and try again.';
  }

  if (
    code === 'unauthenticated' ||
    code === 'auth/user-disabled' ||
    code === 'auth/user-token-expired' ||
    code === 'auth/invalid-user-token'
  ) {
    return 'Please sign in with your verified UW account and try again.';
  }

  return fallback;
}

module.exports = { getUserFacingErrorMessage };
