function createReportSubmitGuard() {
  let state = 'idle';

  return {
    acquire() {
      if (state !== 'idle') {
        return false;
      }
      state = 'submitting';
      return true;
    },
    markSubmitted() {
      if (state === 'submitting') {
        state = 'submitted';
      }
    },
    releaseAfterFailure() {
      if (state === 'submitting') {
        state = 'idle';
      }
    },
  };
}

module.exports = { createReportSubmitGuard };
