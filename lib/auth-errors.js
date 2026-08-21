class TrustedAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrustedAuthError';
  }
}

module.exports = { TrustedAuthError };
