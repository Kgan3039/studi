const SAFE_CREATE_SESSION_ERROR = 'Unable to create the study session right now.';
const SAFE_EDIT_SESSION_ERROR = 'Unable to update the study session right now.';
const SAFE_EDIT_SESSION_AUTH_ERROR =
  'Please sign in with your verified UW account and try again.';
const SAFE_EDIT_SESSION_NETWORK_ERROR =
  'Unable to update the study session right now. Please try again.';

class CreateSessionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CreateSessionValidationError';
  }
}

async function createWithStaleVerificationRetry({
  attempt,
  expectedUid,
  getCurrentUser,
  isPermissionDenied,
}) {
  try {
    return await attempt();
  } catch (initialError) {
    if (!isPermissionDenied(initialError)) {
      throw initialError;
    }

    const user = getCurrentUser();
    if (!user || user.uid !== expectedUid || !user.emailVerified) {
      throw initialError;
    }

    try {
      const initialToken = await user.getIdTokenResult();
      if (initialToken.claims.email_verified === true) {
        throw initialError;
      }

      await user.getIdToken(true);

      if (getCurrentUser()?.uid !== expectedUid) {
        throw initialError;
      }

      const refreshedToken = await user.getIdTokenResult();
      if (
        refreshedToken.claims.email_verified !== true ||
        getCurrentUser()?.uid !== expectedUid
      ) {
        throw initialError;
      }
    } catch {
      throw initialError;
    }

    return attempt();
  }
}

function getCreateSessionErrorMessage(error) {
  return error instanceof CreateSessionValidationError
    ? error.message
    : SAFE_CREATE_SESSION_ERROR;
}

function getEditSessionErrorMessage(error) {
  if (error instanceof CreateSessionValidationError) {
    return error.message;
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
    return SAFE_EDIT_SESSION_AUTH_ERROR;
  }

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'auth/network-request-failed'
  ) {
    return SAFE_EDIT_SESSION_NETWORK_ERROR;
  }

  return SAFE_EDIT_SESSION_ERROR;
}

module.exports = {
  CreateSessionValidationError,
  SAFE_CREATE_SESSION_ERROR,
  SAFE_EDIT_SESSION_AUTH_ERROR,
  SAFE_EDIT_SESSION_ERROR,
  SAFE_EDIT_SESSION_NETWORK_ERROR,
  createWithStaleVerificationRetry,
  getCreateSessionErrorMessage,
  getEditSessionErrorMessage,
};
