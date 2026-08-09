const SAFE_CREATE_SESSION_ERROR = 'Unable to create the study session right now.';

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

module.exports = {
  CreateSessionValidationError,
  SAFE_CREATE_SESSION_ERROR,
  createWithStaleVerificationRetry,
  getCreateSessionErrorMessage,
};
