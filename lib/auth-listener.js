function subscribeToIdTokenState(auth, onIdTokenChanged, listener) {
  return onIdTokenChanged(auth, listener);
}

module.exports = {
  subscribeToIdTokenState,
};
