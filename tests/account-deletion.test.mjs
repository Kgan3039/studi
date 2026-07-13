// tests/account-deletion.test.mjs
// Run: npm run test:deletion  (plain mocha — no emulator needed)
// Unit tests for the account-deletion state machine and cleanup runner in
// functions/account-deletion.js. The runner takes its Firebase handles by
// injection, so these tests drive the exact code the deleteUserAccount
// callable and scripts/resume-account-deletion.js run — with fakes recording
// operation order. Remaining live QA (documented in docs/push-notifications.md):
// one end-to-end deletion against a dev project, since the repo has no Cloud
// Functions integration harness.

import { strict as assert } from 'node:assert';
import deletion from '../functions/account-deletion.js';

const {
  classifyDeletionRequest,
  createAccountDeletionRunner,
  isResumableJob,
  boundedErrorCode,
} = deletion;

const UID = 'aliceUid';

const EXPECTED_STEP_ORDER = [
  'hosted-sessions',
  'joined-sessions',
  'conversations',
  'sent-messages',
  'user-blocks',
  'location-ratings',
  'user-tree',
];

// Minimal fakes for the Firestore/Auth surface the runner touches. Queries
// always come back empty (each cleanup step is exercised as a no-op pass);
// a named collection can be made to throw to simulate a mid-run failure.
function createFakes() {
  const ops = [];
  const jobWrites = [];
  let jobData = null;
  let authUserExists = true;
  const failures = { collection: null };

  const jobDoc = {
    async set(fields) {
      jobWrites.push(fields);
      ops.push(`job:${fields.status ?? `step:${fields.lastStep}`}`);
      jobData = { ...(jobData ?? {}), ...fields };
    },
    async get() {
      return { exists: jobData !== null, data: () => jobData };
    },
  };

  function makeQuery(name) {
    const query = {
      where: () => query,
      limit: () => query,
      async get() {
        if (failures.collection === name) {
          const error = new Error(`${name} query failed`);
          error.code = 'unavailable';
          throw error;
        }
        return { empty: true, docs: [] };
      },
    };
    return query;
  }

  const db = {
    collection(name) {
      return {
        doc: () => (name === 'accountDeletionJobs' ? jobDoc : { path: `${name}/doc` }),
        where: () => makeQuery(name),
      };
    },
    collectionGroup(name) {
      return { where: () => makeQuery(`cg:${name}`) };
    },
    batch() {
      return { update() {}, delete() {}, async commit() {} };
    },
    async recursiveDelete() {
      ops.push('recursiveDelete');
    },
  };

  const auth = {
    async updateUser() {
      ops.push('auth:disable');
    },
    async revokeRefreshTokens() {
      ops.push('auth:revoke');
    },
    async deleteUser() {
      if (!authUserExists) {
        const error = new Error('user not found');
        error.code = 'auth/user-not-found';
        throw error;
      }
      authUserExists = false;
      ops.push('auth:deleteUser');
    },
  };

  const FieldValue = {
    serverTimestamp: () => 'server-ts',
    increment: (n) => ({ increment: n }),
    arrayRemove: (v) => ({ arrayRemove: v }),
  };

  return {
    ops,
    jobWrites,
    failures,
    getJobData: () => jobData,
    runner: createAccountDeletionRunner({ db, auth, FieldValue }),
  };
}

describe('deletion request classification', () => {
  it('moderation-disabled account without a job never enters cleanup', () => {
    assert.equal(
      classifyDeletionRequest({ callerUid: UID, job: null, authDisabled: true }),
      'reject-disabled-no-job'
    );
  });

  it('enabled account without a job is a fresh request (full gates apply)', () => {
    assert.equal(
      classifyDeletionRequest({ callerUid: UID, job: null, authDisabled: false }),
      'fresh'
    );
  });

  it('an active job resumes, whatever its intermediate status', () => {
    for (const status of ['pending', 'running', 'failed']) {
      assert.equal(
        classifyDeletionRequest({
          callerUid: UID,
          job: { userId: UID, status },
          authDisabled: true,
        }),
        'resume'
      );
    }
  });

  it('a completed job can never rerun destructively', () => {
    assert.equal(
      classifyDeletionRequest({
        callerUid: UID,
        job: { userId: UID, status: 'complete' },
        authDisabled: true,
      }),
      'reject-complete'
    );
    assert.equal(isResumableJob({ userId: UID, status: 'complete' }), false);
    assert.equal(isResumableJob(null), false);
    assert.equal(isResumableJob({ userId: UID, status: 'pending' }), true);
  });

  it("one user cannot resume another user's job", () => {
    assert.equal(
      classifyDeletionRequest({
        callerUid: 'malloryUid',
        job: { userId: UID, status: 'running' },
        authDisabled: false,
      }),
      'reject-not-owner'
    );
  });

  it('error codes stored on the job are bounded and non-sensitive', () => {
    assert.equal(boundedErrorCode({ code: 'unavailable' }), 'unavailable');
    assert.equal(boundedErrorCode(new Error('x'.repeat(500))).length <= 64, true);
    assert.equal(boundedErrorCode(undefined), 'unknown');
  });
});

describe('deletion runner (same code path as callable + ops script)', () => {
  it('beginDeletion writes the job marker BEFORE disabling the account', async () => {
    const fakes = createFakes();
    await fakes.runner.beginDeletion(UID);

    assert.deepEqual(fakes.ops, ['job:pending', 'auth:disable', 'auth:revoke']);
    assert.equal(fakes.jobWrites[0].status, 'pending');
    assert.equal(fakes.jobWrites[0].attemptCount, 0);
    assert.equal(fakes.jobWrites[0].userId, UID);
    assert.ok(fakes.jobWrites[0].requestedAt);
    assert.ok(fakes.jobWrites[0].createdAt);
  });

  it('runCleanup re-locks, runs every step in order, deletes auth last, then marks complete', async () => {
    const fakes = createFakes();
    await fakes.runner.runCleanup(UID);

    // Lock precedes any destructive work.
    assert.deepEqual(fakes.ops.slice(0, 3), ['auth:disable', 'auth:revoke', 'job:running']);
    // Durable per-step progress, in the documented order.
    const stepWrites = fakes.jobWrites
      .map((write) => write.lastStep)
      .filter((step) => step !== undefined);
    assert.deepEqual(stepWrites, EXPECTED_STEP_ORDER);
    // Auth deletion only after all cleanup; completion only after that.
    const deleteIndex = fakes.ops.indexOf('auth:deleteUser');
    assert.ok(deleteIndex > fakes.ops.indexOf('job:step:user-tree'));
    assert.equal(fakes.ops[fakes.ops.length - 1], 'job:complete');
    assert.equal(fakes.getJobData().status, 'complete');
  });

  it('a failed step persists partial progress and leaves the job resumable', async () => {
    const fakes = createFakes();
    fakes.failures.collection = 'conversations';

    await assert.rejects(() => fakes.runner.runCleanup(UID));

    const job = fakes.getJobData();
    assert.equal(job.status, 'failed');
    assert.equal(job.lastStep, 'joined-sessions'); // last step that finished
    assert.equal(job.errorCode, 'unavailable');
    assert.equal(isResumableJob(job), true);
    // The auth user was never deleted on the failed run.
    assert.equal(fakes.ops.includes('auth:deleteUser'), false);
  });

  it('a retry after failure resumes idempotently and completes — no request context needed', async () => {
    const fakes = createFakes();
    fakes.failures.collection = 'conversations';
    await assert.rejects(() => fakes.runner.runCleanup(UID));

    // Ops-style resume: just the uid, no user token, no callable request.
    fakes.failures.collection = null;
    await fakes.runner.runCleanup(UID);

    assert.equal(fakes.getJobData().status, 'complete');
  });

  it('repeated full runs stay idempotent even after the auth user is gone', async () => {
    const fakes = createFakes();
    await fakes.runner.runCleanup(UID);
    // Second run: deleteUser throws auth/user-not-found — swallowed.
    await fakes.runner.runCleanup(UID);

    assert.equal(fakes.getJobData().status, 'complete');
    assert.equal(fakes.ops.filter((op) => op === 'auth:deleteUser').length, 1);
  });
});
