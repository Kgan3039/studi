function createVerifiedAuthStateSubscriber({ subscribeToAuthState, getCurrentUser }) {
  return function subscribeToVerifiedAuthState(listener) {
    let generation = 0;
    let tokenVerified = false;
    let forcedRefreshUid = null;
    let lastUid = null;

    const unsubscribe = subscribeToAuthState((user) => {
      const currentGeneration = ++generation;

      if (!user) {
        tokenVerified = false;
        forcedRefreshUid = null;
        lastUid = null;
        listener(null, 'unverified');
        return;
      }

      if (lastUid !== user.uid) {
        lastUid = user.uid;
        tokenVerified = false;
        forcedRefreshUid = null;
      }

      if (!user.emailVerified) {
        tokenVerified = false;
        forcedRefreshUid = null;
        listener(user, 'unverified');
        return;
      }

      if (!tokenVerified) {
        listener(user, 'pending');
      }

      void (async () => {
        try {
          let { claims } = await user.getIdTokenResult();

          if (claims.email_verified !== true && forcedRefreshUid !== user.uid) {
            forcedRefreshUid = user.uid;
            await user.getIdToken(true);
            claims = (await user.getIdTokenResult()).claims;
          }

          if (currentGeneration !== generation || getCurrentUser()?.uid !== user.uid) {
            return;
          }

          tokenVerified = claims.email_verified === true;
          listener(user, tokenVerified ? 'verified' : 'unverified');
        } catch {
          if (currentGeneration !== generation || getCurrentUser()?.uid !== user.uid) {
            return;
          }

          forcedRefreshUid = null;
          tokenVerified = false;
          listener(user, 'unverified');
        }
      })();
    });

    return () => {
      generation += 1;
      unsubscribe();
    };
  };
}

function getRootAuthAccess({ authRestored, authState }) {
  return {
    mountNavigator: authRestored,
    allowProtectedRoutes: authRestored && authState === 'signed-in',
  };
}

module.exports = {
  createVerifiedAuthStateSubscriber,
  getRootAuthAccess,
};
