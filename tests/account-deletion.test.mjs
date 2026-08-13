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
  DELETION_PROJECT_ID,
  boundedErrorCode,
  classifyDeletionRequest,
  createAccountDeletionRunner,
  isResumableJob,
  isValidDeletionUid,
  validateResumableJob,
  validateResumeScriptArgs,
} = deletion;

const UID = 'aliceUid';

const EXPECTED_STEP_ORDER = [
  'hosted-sessions',
  'joined-sessions',
  'conversations',
  'sent-messages',
  'user-blocks',
  'friend-requests',
  'friendships',
  'location-ratings',
  'push-token-owners',
  'push-token-installations',
  'catalog-requests',
  'user-tree',
];

// Minimal fakes for the Firestore/Auth surface the runner touches. Queries
// always come back empty (each cleanup step is exercised as a no-op pass);
// a named collection can be made to throw to simulate a mid-run failure.
function createFakes({
  catalogRequests = [],
  pushTokenOwners = [],
  pushTokenInstallations = [],
  transferOwnerOnTransaction = null,
} = {}) {
  const ops = [];
  const jobWrites = [];
  const storedCatalogRequests = new Map(
    catalogRequests.map((request) => [request.id, { ...request }])
  );
  const storedPushTokenOwners = new Map(
    pushTokenOwners.map((owner) => [owner.id, { ...owner }])
  );
  const storedPushTokenInstallations = new Map(
    pushTokenInstallations.map((installation) => [installation.id, { ...installation }])
  );
  let jobData = null;
  let authUserExists = true;
  // failures.collection: named query throws; failures.jobWriteStatus: the
  // job-doc write carrying that status throws; failures.disableAccount:
  // auth.updateUser throws.
  const failures = { collection: null, jobWriteStatus: null, disableAccount: false };

  const jobDoc = {
    async set(fields) {
      if (failures.jobWriteStatus && fields.status === failures.jobWriteStatus) {
        const error = new Error(`job write rejected (${fields.status})`);
        error.code = 'job-write-denied';
        throw error;
      }
      jobWrites.push(fields);
      ops.push(`job:${fields.status ?? `step:${fields.lastStep}`}`);
      jobData = { ...(jobData ?? {}), ...fields };
    },
    async get() {
      return { exists: jobData !== null, data: () => jobData };
    },
  };

  function makeQuery(name, field, value) {
    let max = Infinity;
    const query = {
      where: () => query,
      limit: (value) => {
        max = value;
        return query;
      },
      async get() {
        if (failures.collection === name) {
          const error = new Error(`${name} query failed`);
          error.code = 'unavailable';
          throw error;
        }
        if (name === 'catalogRequests') {
          const docs = [...storedCatalogRequests.values()]
            .filter((request) => request[field] === value)
            .map((request) => ({
              ref: { collection: name, id: request.id },
            }));
          const page = docs.slice(0, max);
          return { empty: page.length === 0, docs: page };
        }
        if (name === 'pushTokenOwners') {
          const docs = [...storedPushTokenOwners.values()]
            .filter((owner) => owner[field] === value)
            .map((owner) => ({
              ref: { collection: name, id: owner.id },
              data: () => ({ ...owner }),
            }));
          const page = docs.slice(0, max);
          return { empty: page.length === 0, docs: page };
        }
        if (name === 'pushTokenInstallations') {
          const docs = [...storedPushTokenInstallations.values()]
            .filter((installation) => installation[field] === value)
            .map((installation) => ({
              ref: { collection: name, id: installation.id },
              data: () => ({ ...installation }),
            }));
          const page = docs.slice(0, max);
          return { empty: page.length === 0, docs: page };
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
        where: (field, _operator, value) => makeQuery(name, field, value),
      };
    },
    collectionGroup(name) {
      return { where: () => makeQuery(`cg:${name}`) };
    },
    batch() {
      const updates = [];
      const deletes = [];
      return {
        update(ref, fields) {
          updates.push({ ref, fields });
        },
        delete(ref) {
          deletes.push(ref);
        },
        async commit() {
          for (const { ref, fields } of updates) {
            if (ref.collection !== 'catalogRequests') continue;
            const request = storedCatalogRequests.get(ref.id);
            if (!request) continue;
            Object.entries(fields).forEach(([key, value]) => {
              if (value === 'delete-field') {
                delete request[key];
              } else {
                request[key] = value;
              }
            });
          }
          deletes.forEach((ref) => {
            if (ref.collection === 'pushTokenOwners') {
              storedPushTokenOwners.delete(ref.id);
            }
          });
        },
      };
    },
    async runTransaction(callback) {
      if (transferOwnerOnTransaction) {
        const owner = storedPushTokenOwners.get(transferOwnerOnTransaction.id);
        if (owner) owner.userId = transferOwnerOnTransaction.userId;
        transferOwnerOnTransaction = null;
      }
      const deletes = [];
      await callback({
        async get(ref) {
          const value = ref.collection === 'pushTokenOwners'
            ? storedPushTokenOwners.get(ref.id)
            : ref.collection === 'pushTokenInstallations'
              ? storedPushTokenInstallations.get(ref.id)
              : undefined;
          return {
            exists: value !== undefined,
            ref,
            data: () => value && ({ ...value }),
          };
        },
        delete(ref) {
          deletes.push(ref);
        },
      });
      deletes.forEach((ref) => {
        if (ref.collection === 'pushTokenOwners') storedPushTokenOwners.delete(ref.id);
        if (ref.collection === 'pushTokenInstallations') {
          storedPushTokenInstallations.delete(ref.id);
        }
      });
    },
    async recursiveDelete() {
      ops.push('recursiveDelete');
    },
  };

  const auth = {
    async updateUser() {
      if (failures.disableAccount) {
        const error = new Error('auth disable failed');
        error.code = 'auth/internal-error';
        throw error;
      }
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
    delete: () => 'delete-field',
  };

  return {
    ops,
    jobWrites,
    failures,
    getCatalogRequests: () => [...storedCatalogRequests.values()],
    getPushTokenOwners: () => [...storedPushTokenOwners.values()],
    getPushTokenInstallations: () => [...storedPushTokenInstallations.values()],
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

  it('anonymizes catalog requests so none remain linked to the deleted uid', async () => {
    const fakes = createFakes({
      catalogRequests: [
        {
          id: 'owned-request',
          requesterUserId: UID,
          type: 'location',
          name: 'Science Hall',
          details: 'Second floor',
        },
        {
          id: 'other-request',
          requesterUserId: 'bobUid',
          type: 'course',
          name: 'COMPSCI 999',
          details: '',
        },
      ],
    });

    await fakes.runner.runCleanup(UID);

    const requests = fakes.getCatalogRequests();
    const owned = requests.find((request) => request.id === 'owned-request');
    const other = requests.find((request) => request.id === 'other-request');

    assert.equal(
      requests.some((request) => request.requesterUserId === UID),
      false
    );
    assert.equal('requesterUserId' in owned, false);
    assert.equal(owned.anonymized, true);
    assert.equal(owned.anonymizedAt, 'server-ts');
    assert.equal(owned.name, 'Science Hall');
    assert.equal(owned.details, 'Second floor');
    assert.equal(other.requesterUserId, 'bobUid');
    assert.equal(other.anonymized, undefined);
  });

  it('removes token ownership records linked to the deleted uid', async () => {
    const fakes = createFakes({
      pushTokenOwners: [
        { id: 'owned-token-hash', userId: UID },
        { id: 'other-token-hash', userId: 'bobUid' },
      ],
      pushTokenInstallations: [
        { id: 'owned-installation', userId: UID },
        { id: 'other-installation', userId: 'bobUid' },
      ],
    });
    await fakes.runner.runCleanup(UID);
    assert.deepEqual(fakes.getPushTokenOwners(), [
      { id: 'other-token-hash', userId: 'bobUid' },
    ]);
    assert.deepEqual(fakes.getPushTokenInstallations(), [
      { id: 'other-installation', userId: 'bobUid' },
    ]);
  });

  it('preserves a registry transferred before deletion cleanup commits', async () => {
    const fakes = createFakes({
      pushTokenOwners: [{ id: 'shared-token-hash', userId: UID }],
      transferOwnerOnTransaction: { id: 'shared-token-hash', userId: 'bobUid' },
    });
    await fakes.runner.runCleanup(UID);
    assert.deepEqual(fakes.getPushTokenOwners(), [
      { id: 'shared-token-hash', userId: 'bobUid' },
    ]);
  });

  it('removes owned registries across bounded cleanup pages', async () => {
    const pushTokenOwners = Array.from({ length: 205 }, (_, index) => ({
      id: `owned-token-${index}`,
      userId: UID,
    }));
    const fakes = createFakes({ pushTokenOwners });
    await fakes.runner.runCleanup(UID);
    assert.deepEqual(fakes.getPushTokenOwners(), []);
  });

  it('a failed step persists the failing phase and leaves the job resumable', async () => {
    const fakes = createFakes();
    fakes.failures.collection = 'conversations';

    await assert.rejects(() => fakes.runner.runCleanup(UID));

    const job = fakes.getJobData();
    assert.equal(job.status, 'failed');
    assert.equal(job.lastStep, 'conversations'); // the phase that broke
    assert.equal(job.errorCode, 'unavailable');
    assert.equal(isResumableJob(job), true);
    // The last COMPLETED step was still durably recorded along the way.
    const stepWrites = fakes.jobWrites.map((w) => w.lastStep).filter(Boolean);
    assert.ok(stepWrites.includes('joined-sessions'));
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

describe('full-lifecycle failure persistence', () => {
  it('a lockAccount failure persists failed status + errorCode on the job', async () => {
    const fakes = createFakes();
    fakes.failures.disableAccount = true;

    await assert.rejects(() => fakes.runner.runCleanup(UID), /auth disable failed/);

    const job = fakes.getJobData();
    assert.equal(job.status, 'failed');
    assert.equal(job.lastStep, 'lock-account');
    assert.equal(job.errorCode, 'auth/internal-error');
    // attemptCount was never incremented — the run died before `running`.
    assert.equal('attemptCount' in job, false);
    assert.equal(isResumableJob(job), true);
  });

  it("beginDeletion's lock phase cannot fail silently", async () => {
    const fakes = createFakes();
    fakes.failures.disableAccount = true;

    await assert.rejects(() => fakes.runner.beginDeletion(UID), /auth disable failed/);

    const job = fakes.getJobData();
    // Intent was recorded, the lock failure landed on the doc, and the job
    // is resumable — the marker keeps attemptCount at its initial 0.
    assert.equal(job.status, 'failed');
    assert.equal(job.lastStep, 'lock-account');
    assert.equal(job.attemptCount, 0);
    assert.equal(isResumableJob(job), true);
  });

  it('an initial running-write failure is persisted without masking the error', async () => {
    const fakes = createFakes();
    fakes.failures.jobWriteStatus = 'running';

    await assert.rejects(() => fakes.runner.runCleanup(UID), /job write rejected \(running\)/);

    const job = fakes.getJobData();
    assert.equal(job.status, 'failed');
    assert.equal(job.lastStep, 'mark-running');
    assert.equal(job.errorCode, 'job-write-denied');
  });

  it('a failure-state write failure does not hide the original error', async () => {
    const fakes = createFakes();
    fakes.failures.collection = 'conversations';
    fakes.failures.jobWriteStatus = 'failed'; // the failure write itself breaks

    // The rejection is the ORIGINAL step error, not the write error.
    await assert.rejects(() => fakes.runner.runCleanup(UID), /conversations query failed/);
    // And nothing pretended to succeed: the job never reached 'failed'.
    assert.notEqual(fakes.getJobData().status, 'failed');
  });

  it('a retry after a pre-step (lock) failure resumes idempotently to complete', async () => {
    const fakes = createFakes();
    fakes.failures.disableAccount = true;
    await assert.rejects(() => fakes.runner.runCleanup(UID));

    fakes.failures.disableAccount = false;
    await fakes.runner.runCleanup(UID);

    assert.equal(fakes.getJobData().status, 'complete');
  });
});

describe('ops resume script preflight (shared helpers)', () => {
  const GOOD_UID = 'AbC123_x-9';

  it('rejects empty, padded, path-like, and malformed uids before any Firebase use', () => {
    for (const bad of [
      undefined,
      null,
      '',
      '   ',
      ` ${GOOD_UID}`,
      `${GOOD_UID} `,
      'a/b',
      '../x',
      'users/aliceUid',
      'a.b',
      'a%2Fb',
      'a b',
      'x'.repeat(129),
      42,
    ]) {
      assert.equal(isValidDeletionUid(bad), false, `expected invalid: ${String(bad)}`);
      assert.equal(
        validateResumeScriptArgs({ uid: bad, projectId: DELETION_PROJECT_ID }).reason,
        'invalid-uid'
      );
    }
    assert.equal(isValidDeletionUid(GOOD_UID), true);
    assert.equal(isValidDeletionUid('x'.repeat(128)), true);
  });

  it('rejects any project other than the pinned studi-b02c3', () => {
    assert.equal(DELETION_PROJECT_ID, 'studi-b02c3');
    for (const project of ['studi-prod', 'demo-studi-b02c3', '', undefined]) {
      assert.deepEqual(validateResumeScriptArgs({ uid: GOOD_UID, projectId: project }), {
        ok: false,
        reason: 'wrong-project',
      });
    }
    assert.deepEqual(
      validateResumeScriptArgs({ uid: GOOD_UID, projectId: DELETION_PROJECT_ID }),
      { ok: true }
    );
  });

  it('job validation: missing, malformed, mismatched, complete, and unknown-status jobs are rejected', () => {
    assert.equal(validateResumableJob(null, UID).reason, 'missing-job');
    assert.equal(validateResumableJob('running', UID).reason, 'missing-job');
    assert.equal(validateResumableJob({ status: 'running' }, UID).reason, 'malformed-job');
    assert.equal(validateResumableJob({ userId: UID }, UID).reason, 'malformed-job');
    assert.equal(
      validateResumableJob({ userId: 'someoneElse', status: 'running' }, UID).reason,
      'user-mismatch'
    );
    assert.equal(
      validateResumableJob({ userId: UID, status: 'complete' }, UID).reason,
      'already-complete'
    );
    assert.equal(
      validateResumableJob({ userId: UID, status: 'archived' }, UID).reason,
      'unknown-status'
    );
    for (const status of ['pending', 'running', 'failed']) {
      assert.deepEqual(validateResumableJob({ userId: UID, status }, UID), { ok: true });
    }
  });
});
