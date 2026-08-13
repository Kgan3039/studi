import { strict as assert } from 'node:assert';

import ownership from '../functions/push-token-ownership.js';
import stateModule from '../lib/push-registration-state.js';

const {
  PushTokenOwnershipConflictError,
  claimPushTokenOwnership,
  isValidOptionalClientGeneration,
  releasePushTokenOwnership,
} = ownership;
const {
  cleanupCurrentPushRegistration,
  cleanupPushRegistration,
  createPushRegistrationState,
  settleWithin,
} = stateModule;

class Ref {
  constructor(path) { this.path = path; }
}

class Snapshot {
  constructor(ref, data) {
    this.ref = ref;
    this.exists = data !== undefined;
    this.value = data === undefined ? undefined : structuredClone(data);
  }
  data() { return this.value; }
}

function createFirestore(seed = {}) {
  const data = new Map(Object.entries(seed).map(([path, value]) => [path, structuredClone(value)]));
  let transactionTail = Promise.resolve();
  let failNextCommit = false;

  function querySnapshot(query) {
    const docs = [];
    for (const [path, value] of data) {
      const parts = path.split('/');
      if (
        parts[parts.length - 2] === query.group &&
        value?.[query.field] === query.value
      ) {
        docs.push(new Snapshot(new Ref(path), value));
      }
    }
    return { docs: docs.slice(0, query.max) };
  }

  const db = {
    doc(path) { return new Ref(path); },
    collectionGroup(group) {
      return {
        where(field, operator, value) {
          assert.equal(operator, '==');
          return {
            limit(max) { return { kind: 'query', group, field, value, max }; },
          };
        },
      };
    },
    runTransaction(callback) {
      const run = async () => {
        const writes = [];
        const tx = {
          async get(target) {
            if (target.kind === 'query') return querySnapshot(target);
            return new Snapshot(target, data.get(target.path));
          },
          set(ref, fields, options) { writes.push({ kind: 'set', ref, fields, options }); },
          update(ref, fields) { writes.push({ kind: 'update', ref, fields }); },
          delete(ref) { writes.push({ kind: 'delete', ref }); },
        };
        const callbackResult = await callback(tx);
        if (failNextCommit) {
          failNextCommit = false;
          throw new Error('commit-failed');
        }
        for (const write of writes) {
          if (write.kind === 'delete') {
            data.delete(write.ref.path);
          } else if (write.kind === 'set') {
            data.set(write.ref.path, write.options?.merge
              ? { ...(data.get(write.ref.path) ?? {}), ...write.fields }
              : { ...write.fields });
          } else {
            assert.equal(data.has(write.ref.path), true, `missing update ${write.ref.path}`);
            data.set(write.ref.path, { ...data.get(write.ref.path), ...write.fields });
          }
        }
        return callbackResult;
      };
      const result = transactionTail.then(run, run);
      transactionTail = result.catch(() => undefined);
      return result;
    },
    failNextCommit() { failNextCommit = true; },
    get(path) { return data.get(path); },
  };
  return db;
}

function tokenPath(uid, hash) {
  return `users/${uid}/private/pushTokens/tokens/${hash}`;
}

function claim(db, {
  uid = 'aliceUid', token = 'token-new', hash = 'hash-new',
  previousToken = null, previousHash = null,
  installationId = 'installation_0001', registrationId = 'registration_0001',
  generation = 1,
} = {}) {
  return claimPushTokenOwnership({
    db,
    uid,
    expoPushToken: token,
    previousExpoPushToken: previousToken,
    platform: 'ios',
    projectId: 'project',
    installationId,
    registrationId,
    generation,
    tokenHash: hash,
    previousTokenHash: previousHash,
    tokenRef: db.doc(tokenPath(uid, hash)),
    ownerRef: db.doc(`pushTokenOwners/${hash}`),
    installationRef: db.doc(`pushTokenInstallations/${installationId}`),
    installationRefFor: (id) => db.doc(`pushTokenInstallations/${id}`),
    previousTokenRef: previousToken ? db.doc(tokenPath(uid, previousHash)) : null,
    previousOwnerRef: previousToken ? db.doc(`pushTokenOwners/${previousHash}`) : null,
    deletionJobRef: db.doc(`accountDeletionJobs/${uid}`),
    now: 'NOW',
  });
}

describe('push token ownership transaction', () => {
  it('claims an enabled legacy token, disables A, enables B, and is idempotent', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-new')]: {
        expoPushToken: 'token-new', enabled: true, createdAt: 'OLD',
      },
    });
    await claim(db, { uid: 'bobUid' });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, false);
    assert.equal(db.get(tokenPath('bobUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'bobUid');
    await claim(db, { uid: 'bobUid' });
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'bobUid');
  });

  it('fails safely when multiple enabled legacy owners are ambiguous', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-new')]: { expoPushToken: 'token-new', enabled: true },
      [tokenPath('carolUid', 'hash-new')]: { expoPushToken: 'token-new', enabled: true },
    });
    await assert.rejects(
      claim(db, { uid: 'bobUid' }),
      (error) => error instanceof PushTokenOwnershipConflictError &&
        error.code === 'ambiguous-legacy-ownership'
    );
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, true);
    assert.equal(db.get(tokenPath('bobUid', 'hash-new')), undefined);
  });

  it('fails closed for an enabled noncanonical exact-token legacy document', async () => {
    const db = createFirestore({
      'legacyTokens/bad/tokens/hash-new': { expoPushToken: 'token-new', enabled: true },
    });
    await assert.rejects(
      claim(db),
      (error) => error.code === 'malformed-legacy-ownership'
    );
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')), undefined);
  });

  it('ignores disabled malformed legacy documents that cannot receive pushes', async () => {
    const db = createFirestore({
      'legacyTokens/bad/tokens/hash-new': { expoPushToken: 'token-new', enabled: false },
    });
    await claim(db);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, true);
  });

  it('fails closed when a canonical owner and malformed enabled match coexist', async () => {
    const db = createFirestore({
      [tokenPath('bobUid', 'hash-new')]: { expoPushToken: 'token-new', enabled: true },
      'legacyTokens/bad/tokens/hash-new': { expoPushToken: 'token-new', enabled: true },
    });
    await assert.rejects(claim(db), /malformed-legacy-ownership/);
    assert.equal(db.get(tokenPath('bobUid', 'hash-new')).enabled, true);
  });

  it('rotates A from T1 to T2 in one transaction', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-old')]: { expoPushToken: 'token-old', enabled: true },
      'pushTokenOwners/hash-old': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1',
        generation: 1,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1', tokenHash: 'hash-old',
        generation: 1,
      },
    });
    await claim(db, { previousToken: 'token-old', previousHash: 'hash-old', generation: 2 });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-old')).enabled, false);
    assert.equal(db.get('pushTokenOwners/hash-old'), undefined);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'aliceUid');
  });

  it('treats same-token registration as an idempotent refresh', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-new')]: { expoPushToken: 'token-new', enabled: true },
      'pushTokenOwners/hash-new': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_0001',
        generation: 1,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_0001', tokenHash: 'hash-new',
        generation: 1,
      },
    });
    await claim(db, {
      previousToken: 'token-new', previousHash: 'hash-new',
    });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'aliceUid');
  });

  it('cannot disable a forged previous token owned by B', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-old')]: { expoPushToken: 'token-old', enabled: true },
      [tokenPath('bobUid', 'hash-old')]: { expoPushToken: 'token-old', enabled: true },
      'pushTokenOwners/hash-old': {
        userId: 'bobUid', installationId: 'installation_bob1',
        registrationId: 'registration_bob1',
        generation: 1,
      },
    });
    await claim(db, { previousToken: 'token-old', previousHash: 'hash-old' });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-old')).enabled, true);
    assert.equal(db.get(tokenPath('bobUid', 'hash-old')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-old').userId, 'bobUid');
  });

  it('rolls back a failed rotation and converges on retry', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-old')]: { expoPushToken: 'token-old', enabled: true },
      'pushTokenOwners/hash-old': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1',
        generation: 1,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1', tokenHash: 'hash-old',
        generation: 1,
      },
    });
    db.failNextCommit();
    await assert.rejects(claim(db, {
      previousToken: 'token-old', previousHash: 'hash-old', generation: 2,
    }));
    assert.equal(db.get(tokenPath('aliceUid', 'hash-old')).enabled, true);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')), undefined);
    await claim(db, { previousToken: 'token-old', previousHash: 'hash-old', generation: 2 });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-old')).enabled, false);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'aliceUid');
  });

  it('makes A stale cleanup harmless after B takes ownership', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-new')]: { expoPushToken: 'token-new', enabled: true },
      'pushTokenOwners/hash-new': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_0001',
        generation: 1,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_0001', tokenHash: 'hash-new',
        generation: 1,
      },
    });
    await claim(db, { uid: 'bobUid', registrationId: 'registration_0002', generation: 2 });
    await releasePushTokenOwnership({
      db, uid: 'aliceUid', expoPushToken: 'token-new', tokenHash: 'hash-new',
      installationId: 'installation_0001', registrationId: 'registration_0001',
      generation: 1,
      tokenRef: db.doc(tokenPath('aliceUid', 'hash-new')),
      ownerRef: db.doc('pushTokenOwners/hash-new'), now: 'LATER',
      installationRef: db.doc('pushTokenInstallations/installation_0001'),
    });
    assert.equal(db.get(tokenPath('bobUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'bobUid');
  });

  it('makes generation-1 unregister harmless after same-UID generation 2 wins', async () => {
    const db = createFirestore();
    await claim(db, { registrationId: 'registration_0001' });
    await claim(db, { registrationId: 'registration_0002', generation: 2 });
    await releasePushTokenOwnership({
      db, uid: 'aliceUid', expoPushToken: 'token-new', tokenHash: 'hash-new',
      installationId: 'installation_0001', registrationId: 'registration_0001',
      generation: 1,
      tokenRef: db.doc(tokenPath('aliceUid', 'hash-new')),
      ownerRef: db.doc('pushTokenOwners/hash-new'),
      installationRef: db.doc('pushTokenInstallations/installation_0001'), now: 'LATER',
    });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').registrationId, 'registration_0002');
  });

  it('serializes concurrent claims so only the final owner stays enabled', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-new')]: { expoPushToken: 'token-new', enabled: true },
      'pushTokenOwners/hash-new': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_0001',
        generation: 1,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_0001', tokenHash: 'hash-new',
        generation: 1,
      },
    });
    await Promise.all([
      claim(db, { uid: 'bobUid', registrationId: 'registration_0002', generation: 2 }),
      claim(db, { uid: 'carolUid', registrationId: 'registration_0003', generation: 3 }),
    ]);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, false);
    assert.equal(db.get(tokenPath('bobUid', 'hash-new')).enabled, false);
    assert.equal(db.get(tokenPath('carolUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'carolUid');
  });

  it('unregistering an unknown token creates no disabled junk document', async () => {
    const db = createFirestore();
    await releasePushTokenOwnership({
      db, uid: 'aliceUid', expoPushToken: 'token-new', tokenHash: 'hash-new',
      installationId: 'installation_0001', registrationId: 'registration_0001',
      generation: 1,
      tokenRef: db.doc(tokenPath('aliceUid', 'hash-new')),
      ownerRef: db.doc('pushTokenOwners/hash-new'), now: 'NOW',
      installationRef: db.doc('pushTokenInstallations/installation_0001'),
    });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')), undefined);
    assert.equal(db.get('pushTokenOwners/hash-new'), undefined);
  });

  it('rejects registration after an account deletion job exists', async () => {
    const db = createFirestore({
      'accountDeletionJobs/aliceUid': { userId: 'aliceUid', status: 'running' },
    });
    await assert.rejects(claim(db), /account-deletion-exists/);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')), undefined);
  });

  it('permanently rejects registration after a completed deletion job', async () => {
    const db = createFirestore({
      'accountDeletionJobs/aliceUid': { userId: 'aliceUid', status: 'complete' },
    });
    await assert.rejects(claim(db), /account-deletion-exists/);
    await assert.rejects(claim(db), /account-deletion-exists/);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')), undefined);
    assert.equal(db.get('pushTokenOwners/hash-new'), undefined);
  });

  it('converges divergent rotations for one installation to one active token', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-old')]: { expoPushToken: 'token-old', enabled: true },
      'pushTokenOwners/hash-old': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1',
        generation: 1,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1', tokenHash: 'hash-old',
        generation: 1,
      },
    });
    await Promise.all([
      claim(db, {
        token: 'token-two', hash: 'hash-two', previousToken: 'token-old',
        previousHash: 'hash-old', registrationId: 'registration_0002',
        generation: 2,
      }),
      claim(db, {
        token: 'token-three', hash: 'hash-three', previousToken: 'token-old',
        previousHash: 'hash-old', registrationId: 'registration_0003',
        generation: 3,
      }),
    ]);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-old')).enabled, false);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-two')).enabled, false);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-three')).enabled, true);
    assert.equal(db.get('pushTokenInstallations/installation_0001').tokenHash, 'hash-three');
  });

  it('ignores a huge client generation and advances server generation exactly once', async () => {
    const db = createFirestore();
    const first = await claim(db, {
      token: 'token-two', hash: 'hash-two', registrationId: 'registration_0002',
      generation: Number.MAX_SAFE_INTEGER,
    });
    const second = await claim(db, {
      token: 'token-three', hash: 'hash-three', registrationId: 'registration_0003',
      generation: 1,
    });
    assert.equal(first.generation, 1);
    assert.equal(second.generation, 2);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-three')).enabled, true);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-two')).enabled, false);
  });

  it('returns the same server generation when the same registration retries', async () => {
    const db = createFirestore();
    const first = await claim(db, { generation: Number.MAX_SAFE_INTEGER });
    const retry = await claim(db, { generation: 2 });
    assert.equal(first.generation, 1);
    assert.equal(retry.generation, 1);
    assert.equal(db.get('pushTokenInstallations/installation_0001').generation, 1);
  });

  it('validates optional legacy client generations without trusting valid values', () => {
    assert.equal(isValidOptionalClientGeneration(undefined), true);
    assert.equal(isValidOptionalClientGeneration(Number.MAX_SAFE_INTEGER), true);
    for (const value of [0, -1, 1.5, NaN, Infinity, '2', null]) {
      assert.equal(isValidOptionalClientGeneration(value), false);
    }
  });

  it('migrates a poisoned pre-authority generation instead of inheriting it', async () => {
    const db = createFirestore({
      [tokenPath('aliceUid', 'hash-old')]: {
        expoPushToken: 'token-old', enabled: true,
      },
      'pushTokenOwners/hash-old': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1', generation: Number.MAX_SAFE_INTEGER,
      },
      'pushTokenInstallations/installation_0001': {
        userId: 'aliceUid', installationId: 'installation_0001',
        registrationId: 'registration_old1', tokenHash: 'hash-old',
        generation: Number.MAX_SAFE_INTEGER,
      },
    });
    const result = await claim(db, {
      uid: 'bobUid', registrationId: 'registration_0002',
    });
    assert.equal(result.generation, 1);
    assert.equal(db.get('pushTokenInstallations/installation_0001').userId, 'bobUid');
  });

  it('transfers one installation from A to B and disables A', async () => {
    const db = createFirestore();
    await claim(db, { registrationId: 'registration_0001', generation: 1 });
    await claim(db, {
      uid: 'bobUid', registrationId: 'registration_0002', generation: 2,
    });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-new')).enabled, false);
    assert.equal(db.get(tokenPath('bobUid', 'hash-new')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-new').userId, 'bobUid');
    assert.equal(db.get('pushTokenInstallations/installation_0001').userId, 'bobUid');
  });

  it('keeps two installations for one user independently enabled', async () => {
    const db = createFirestore();
    await claim(db, {
      token: 'token-one', hash: 'hash-one', installationId: 'installation_0001',
      registrationId: 'registration_0001',
    });
    await claim(db, {
      token: 'token-two', hash: 'hash-two', installationId: 'installation_0002',
      registrationId: 'registration_0002',
    });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-one')).enabled, true);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-two')).enabled, true);
  });

  it('does not let installation X disable installation Y through previousToken', async () => {
    const db = createFirestore();
    await claim(db, {
      token: 'token-one', hash: 'hash-one', installationId: 'installation_0001',
      registrationId: 'registration_0001',
    });
    await claim(db, {
      token: 'token-nine', hash: 'hash-nine', installationId: 'installation_0002',
      registrationId: 'registration_0009',
    });
    await claim(db, {
      token: 'token-two', hash: 'hash-two', installationId: 'installation_0001',
      registrationId: 'registration_0002', previousToken: 'token-nine',
      previousHash: 'hash-nine',
    });
    assert.equal(db.get(tokenPath('aliceUid', 'hash-one')).enabled, false);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-two')).enabled, true);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-nine')).enabled, true);
    assert.equal(db.get('pushTokenOwners/hash-nine').installationId, 'installation_0002');
  });

  it('transfers installation X from A to B without disturbing A installation Y', async () => {
    const db = createFirestore();
    await claim(db, {
      token: 'token-x', hash: 'hash-x', installationId: 'installation_0001',
      registrationId: 'registration_0001',
    });
    await claim(db, {
      token: 'token-y', hash: 'hash-y', installationId: 'installation_0002',
      registrationId: 'registration_0002',
    });
    await claim(db, {
      uid: 'bobUid', token: 'token-x', hash: 'hash-x',
      installationId: 'installation_0001', registrationId: 'registration_0003',
      previousToken: 'token-y', previousHash: 'hash-y',
    });
    assert.equal(db.get(tokenPath('bobUid', 'hash-x')).enabled, true);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-x')).enabled, false);
    assert.equal(db.get(tokenPath('aliceUid', 'hash-y')).enabled, true);
  });
});

function createStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
  };
}

describe('persisted UID-scoped registration state', () => {
  it('coalesces one UID while keeping different users independent', async () => {
    const state = createPushRegistrationState({ storage: createStorage() });
    let resolve;
    let calls = 0;
    const first = state.run('aliceUid', () => {
      calls += 1;
      return new Promise((done) => { resolve = done; });
    });
    assert.equal(first, state.run('aliceUid', () => Promise.resolve({ status: 'error' })));
    const bob = state.run('bobUid', () => Promise.resolve({ status: 'skipped' }));
    await Promise.resolve();
    resolve({ status: 'registered', expoPushToken: 'token' });
    await Promise.all([first, bob]);
    assert.equal(calls, 1);
  });

  it('persists response-lost cleanup intent across a restart', async () => {
    const storage = createStorage();
    const first = createPushRegistrationState({
      storage, randomId: () => 'registration_0001', now: () => 1,
    });
    await first.createRegistrationIntent('aliceUid', 'token-new');
    const restarted = createPushRegistrationState({ storage });
    assert.deepEqual(await restarted.getSnapshot('aliceUid'), {
      active: null,
      pending: [{ token: 'token-new', registrationId: 'registration_0001', generation: 1 }],
    });
  });

  it('clears only a confirmed token and preserves failed cleanup candidates', async () => {
    const ids = ['registration_0001', 'registration_0002'];
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => ids.shift(),
      now: () => 1,
    });
    const oldEntry = await state.createRegistrationIntent('aliceUid', 'token-old');
    await state.markRegistered('aliceUid', oldEntry);
    const newEntry = await state.createRegistrationIntent('aliceUid', 'token-new');
    await state.markUnregistered('aliceUid', oldEntry);
    assert.deepEqual(await state.getSnapshot('aliceUid'), {
      active: null, pending: [newEntry],
    });
  });

  it('bounds waiting for an in-flight registration and blocks new work during cleanup', async () => {
    const state = createPushRegistrationState({ storage: createStorage() });
    state.run('aliceUid', () => new Promise(() => {}));
    state.beginCleanup('aliceUid');
    const result = await state.waitForIdle('aliceUid', 10);
    assert.equal(result.status, 'timeout');
    assert.equal((await state.run('aliceUid', () => ({ status: 'registered' }))).status, 'signed-out');
  });

  it('settleWithin handles rejection and timeout without leaking either', async () => {
    assert.equal((await settleWithin(Promise.reject(new Error('offline')), 50)).status, 'rejected');
    assert.equal((await settleWithin(new Promise(() => {}), 5)).status, 'timeout');
  });

  it('bounds the total cleanup when installation lookup hangs', async () => {
    const state = createPushRegistrationState({ storage: createStorage() });
    const startedAt = Date.now();
    const result = await cleanupCurrentPushRegistration({
      state, uid: 'aliceUid',
      getInstallationId: () => new Promise(() => {}),
      unregister: async () => true, timeoutMs: 10,
    });
    assert.equal(result.status, 'timeout');
    assert.ok(Date.now() - startedAt < 100);
  });

  it('a late installation lookup cannot start cleanup after same-UID resume', async () => {
    const state = createPushRegistrationState({ storage: createStorage() });
    let finishLookup;
    let unregisterCalls = 0;
    const cleanup = cleanupCurrentPushRegistration({
      state, uid: 'aliceUid',
      getInstallationId: () => new Promise((resolve) => { finishLookup = resolve; }),
      unregister: async () => { unregisterCalls += 1; return true; }, timeoutMs: 10,
    });
    assert.equal((await cleanup).status, 'timeout');
    assert.equal(state.resume('aliceUid'), true);
    finishLookup('installation_0001');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(unregisterCalls, 0);
  });

  it('a timed-out installation read does not block the next login lookup', async () => {
    let reads = 0;
    const storage = {
      getItem: async (key) => {
        if (key !== '@studi/push-installation-id') return null;
        reads += 1;
        return reads === 1 ? new Promise(() => {}) : 'installation_0002';
      },
      setItem: async () => {},
    };
    const state = createPushRegistrationState({ storage });
    const cleanup = await cleanupCurrentPushRegistration({
      state, uid: 'aliceUid', getInstallationId: () => state.getInstallationId(),
      unregister: async () => true, timeoutMs: 10,
    });
    assert.equal(cleanup.status, 'timeout');
    assert.equal(await state.getInstallationId(), 'installation_0002');
  });

  it('bounds the total cleanup when AsyncStorage state reads hang', async () => {
    const storage = {
      getItem: async (key) => key.includes('push-registration')
        ? new Promise(() => {})
        : 'installation_0001',
      setItem: async () => {},
    };
    const state = createPushRegistrationState({ storage });
    const result = await cleanupCurrentPushRegistration({
      state, uid: 'aliceUid',
      getInstallationId: () => state.getInstallationId(),
      unregister: async () => true, timeoutMs: 10,
    });
    assert.equal(result.status, 'timeout');
  });

  it('a timed-out persistence write leaves the prior local state intact', async () => {
    const values = new Map();
    let hangWrites = false;
    const storage = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        if (hangWrites && key.includes('push-registration')) return new Promise(() => {});
        values.set(key, value);
      },
    };
    const state = createPushRegistrationState({
      storage, randomId: () => 'registration_0001', now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-one');
    await state.markRegistered('aliceUid', entry);
    hangWrites = true;
    const cleanup = await cleanupCurrentPushRegistration({
      state, uid: 'aliceUid', getInstallationId: async () => 'installation_0001',
      unregister: async () => true, timeoutMs: 10,
    });
    assert.equal(cleanup.status, 'timeout');
    assert.deepEqual((await state.getSnapshot('aliceUid')).active, entry);
  });

  it('completes normal cleanup within the outer timeout', async () => {
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => 'registration_0001', now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-one');
    await state.markRegistered('aliceUid', entry);
    const calls = [];
    const result = await cleanupCurrentPushRegistration({
      state, uid: 'aliceUid', getInstallationId: async () => 'installation_0001',
      unregister: async (value) => { calls.push(value); return true; }, timeoutMs: 100,
    });
    assert.equal(result.status, 'settled');
    assert.equal(calls.length, 1);
    assert.deepEqual((await state.getSnapshot('aliceUid')).active, null);
  });

  it('a timed-out outer cleanup cannot clear a newer same-UID registration', async () => {
    const ids = ['registration_0001', 'registration_0002'];
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => ids.shift(), now: () => 1,
    });
    const oldEntry = await state.createRegistrationIntent('aliceUid', 'token-one');
    await state.markRegistered('aliceUid', oldEntry);
    let finishUnregister;
    const cleanup = cleanupCurrentPushRegistration({
      state, uid: 'aliceUid', getInstallationId: async () => 'installation_0001',
      unregister: async () => new Promise((resolve) => { finishUnregister = resolve; }),
      timeoutMs: 10,
    });
    assert.equal((await cleanup).status, 'timeout');
    state.resume('aliceUid');
    const newEntry = await state.createRegistrationIntent('aliceUid', 'token-one', true);
    await state.markRegistered('aliceUid', newEntry);
    finishUnregister(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual((await state.getSnapshot('aliceUid')).active, newEntry);
  });

  it('a timed-out A cleanup cannot clear B registration state', async () => {
    const ids = ['registration_0001', 'registration_0002'];
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => ids.shift(), now: () => 1,
    });
    const alice = await state.createRegistrationIntent('aliceUid', 'token-one');
    await state.markRegistered('aliceUid', alice);
    let finishUnregister;
    const cleanup = cleanupCurrentPushRegistration({
      state, uid: 'aliceUid', getInstallationId: async () => 'installation_0001',
      unregister: async () => new Promise((resolve) => { finishUnregister = resolve; }),
      timeoutMs: 10,
    });
    assert.equal((await cleanup).status, 'timeout');
    const bob = await state.createRegistrationIntent('bobUid', 'token-one');
    await state.markRegistered('bobUid', bob);
    finishUnregister(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual((await state.getSnapshot('bobUid')).active, bob);
  });

  it('confirmed sign-out cleanup removes persisted ownership intent', async () => {
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => 'registration_0001',
      now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-old');
    await state.markRegistered('aliceUid', entry);
    const calls = [];
    const result = await cleanupPushRegistration({
      state,
      uid: 'aliceUid',
      installationId: 'installation_0001',
      unregister: async (value) => { calls.push(value); return true; },
      timeoutMs: 50,
    });
    assert.equal(result.status, 'settled');
    assert.deepEqual(calls, [{ ...entry, installationId: 'installation_0001' }]);
    assert.deepEqual(await state.getSnapshot('aliceUid'), {
      active: null, pending: [],
    });
  });

  it('callable rejection preserves cleanup intent without leaking rejection', async () => {
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => 'registration_0001',
      now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-uncertain');
    const result = await cleanupPushRegistration({
      state,
      uid: 'aliceUid',
      installationId: 'installation_0001',
      unregister: async () => { throw new Error('offline'); },
      timeoutMs: 50,
    });
    assert.equal(result.status, 'settled');
    assert.deepEqual((await state.getSnapshot('aliceUid')).pending, [entry]);
  });

  it('timeout returns promptly and preserves state for restart retry', async () => {
    const storage = createStorage();
    const state = createPushRegistrationState({
      storage, randomId: () => 'registration_0001',
      now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-old');
    await state.markRegistered('aliceUid', entry);
    const startedAt = Date.now();
    const result = await cleanupPushRegistration({
      state,
      uid: 'aliceUid',
      installationId: 'installation_0001',
      unregister: async () => new Promise(() => {}),
      timeoutMs: 10,
    });
    assert.equal(result.status, 'timeout');
    assert.ok(Date.now() - startedAt < 100);
    const restarted = createPushRegistrationState({ storage });
    assert.deepEqual((await restarted.getSnapshot('aliceUid')).active, entry);
  });

  it('waits for in-flight registration before unregistering its persisted candidate', async () => {
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => 'registration_0001',
      now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-new');
    let finishRegistration;
    state.run('aliceUid', async () => {
      return new Promise((resolve) => { finishRegistration = resolve; });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = [];
    const cleanup = cleanupPushRegistration({
      state,
      uid: 'aliceUid',
      installationId: 'installation_0001',
      unregister: async (value) => { calls.push(value); return true; },
      timeoutMs: 100,
    });
    finishRegistration({ status: 'error' });
    assert.equal((await cleanup).status, 'settled');
    assert.deepEqual(calls, [{ ...entry, installationId: 'installation_0001' }]);
  });

  it('does not clear a candidate when registration outlives the sign-out wait', async () => {
    const storage = createStorage();
    const state = createPushRegistrationState({
      storage, randomId: () => 'registration_0001',
      now: () => 1,
    });
    const entry = await state.createRegistrationIntent('aliceUid', 'token-in-flight');
    state.run('aliceUid', () => new Promise(() => {}));
    const calls = [];
    const result = await cleanupPushRegistration({
      state,
      uid: 'aliceUid',
      installationId: 'installation_0001',
      unregister: async (value) => { calls.push(value); return true; },
      timeoutMs: 20,
    });
    assert.equal(result.status, 'settled');
    assert.deepEqual(calls, []);
    const restarted = createPushRegistrationState({ storage });
    assert.deepEqual((await restarted.getSnapshot('aliceUid')).pending, [entry]);
  });

  it('stale generation-1 cleanup cannot clear generation-2 state after re-login', async () => {
    const ids = ['registration_0001', 'registration_0002'];
    const state = createPushRegistrationState({
      storage: createStorage(), randomId: () => ids.shift(),
      now: () => 1,
    });
    const generationOne = await state.createRegistrationIntent('aliceUid', 'token-one');
    await state.markRegistered('aliceUid', generationOne);
    let finishOldUnregister;
    const cleanup = cleanupPushRegistration({
      state,
      uid: 'aliceUid',
      installationId: 'installation_0001',
      unregister: async () => new Promise((resolve) => { finishOldUnregister = resolve; }),
      timeoutMs: 10,
    });
    assert.equal((await cleanup).status, 'timeout');
    assert.equal(state.resume('aliceUid'), true);
    const generationTwo = await state.createRegistrationIntent('aliceUid', 'token-one', true);
    await state.markRegistered('aliceUid', generationTwo);
    finishOldUnregister(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual((await state.getSnapshot('aliceUid')).active, generationTwo);
  });

  it('persists one installation id across restart and UID changes', async () => {
    const storage = createStorage();
    const first = createPushRegistrationState({
      storage, randomId: () => 'installation_0001',
      now: () => 1,
    });
    assert.equal(await first.getInstallationId(), 'installation_0001');
    const restarted = createPushRegistrationState({ storage });
    assert.equal(await restarted.getInstallationId(), 'installation_0001');
    const alice = await first.createRegistrationIntent('aliceUid', 'token-a');
    const bob = await restarted.createRegistrationIntent('bobUid', 'token-b');
    assert.ok(bob.generation > alice.generation);
  });

  it('malformed persisted state fails closed without borrowing another UID state', async () => {
    const storage = createStorage({
      '@studi/push-registration/aliceUid': '{bad json',
      '@studi/push-registration/bobUid': JSON.stringify({
        active: {
          token: 'bob-token', registrationId: 'registration_bob1', generation: 1,
        },
        pending: [],
      }),
    });
    const state = createPushRegistrationState({ storage });
    assert.deepEqual(await state.getSnapshot('aliceUid'), {
      active: null, pending: [],
    });
    assert.equal((await state.getSnapshot('bobUid')).active.token, 'bob-token');
  });
});
