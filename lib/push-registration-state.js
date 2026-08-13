const PUSH_CLEANUP_TIMEOUT_MS = 3500;
const STORAGE_PREFIX = "@studi/push-registration/";
const INSTALLATION_STORAGE_KEY = "@studi/push-installation-id";
const INSTALLATION_GENERATION_KEY = "@studi/push-installation-generation";

function defaultRandomId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validEntry(value) {
  return value && typeof value.token === "string" &&
    /^[A-Za-z0-9_-]{16,128}$/.test(value.registrationId ?? "") &&
    Number.isSafeInteger(value.generation) && value.generation > 0
    ? { token: value.token, registrationId: value.registrationId, generation: value.generation }
    : null;
}

function normalizeStoredState(value) {
  if (!value || typeof value !== "object") return { active: null, pending: [] };
  const active = validEntry(value.active);
  const pending = [];
  for (const candidate of Array.isArray(value.pending) ? value.pending : []) {
    const entry = validEntry(candidate);
    if (entry && !pending.some((item) => item.registrationId === entry.registrationId)) {
      pending.push(entry);
    }
  }
  return { active, pending };
}

function settleWithin(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ status: "settled", value }),
      (error) => ({ status: "rejected", error })
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createPushRegistrationState({ storage, randomId = defaultRandomId, now = Date.now } = {}) {
  const inFlightByUid = new Map();
  const stateByUid = new Map();
  const mutationByUid = new Map();
  const runEpochByUid = new Map();
  const closingUids = new Set();
  let installationPromise = null;
  let installationEpoch = 0;
  let generationTail = Promise.resolve();

  async function getInstallationId() {
    if (!installationPromise) {
      const epoch = installationEpoch;
      const lookup = (async () => {
        if (storage) {
          try {
            const stored = await storage.getItem(INSTALLATION_STORAGE_KEY);
            if (epoch !== installationEpoch) throw new Error("Stale installation lookup");
            if (/^[A-Za-z0-9_-]{16,128}$/.test(stored ?? "")) return stored;
          } catch {}
        }
        if (epoch !== installationEpoch) throw new Error("Stale installation lookup");
        const generated = randomId();
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(generated)) {
          throw new Error("Invalid generated installation id");
        }
        if (storage) await storage.setItem(INSTALLATION_STORAGE_KEY, generated);
        if (epoch !== installationEpoch) throw new Error("Stale installation lookup");
        return generated;
      })();
      installationPromise = lookup;
      lookup.catch(() => {
        if (installationPromise === lookup) installationPromise = null;
      });
    }
    return installationPromise;
  }

  function nextInstallationGeneration() {
    const next = generationTail.catch(() => undefined).then(async () => {
      let stored = 0;
      if (storage) {
        try {
          const raw = await storage.getItem(INSTALLATION_GENERATION_KEY);
          const parsed = Number(raw);
          if (Number.isSafeInteger(parsed) && parsed > 0) stored = parsed;
        } catch {}
      }
      const generation = Math.max(stored + 1, Math.floor(now()));
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new Error("Invalid registration generation");
      }
      if (storage) await storage.setItem(INSTALLATION_GENERATION_KEY, String(generation));
      return generation;
    });
    generationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async function load(uid) {
    if (stateByUid.has(uid)) return stateByUid.get(uid);
    let parsed = null;
    if (storage) {
      try {
        const raw = await storage.getItem(`${STORAGE_PREFIX}${uid}`);
        parsed = raw ? JSON.parse(raw) : null;
      } catch {}
    }
    const state = normalizeStoredState(parsed);
    stateByUid.set(uid, state);
    return state;
  }

  async function persist(uid, state) {
    if (storage) await storage.setItem(`${STORAGE_PREFIX}${uid}`, JSON.stringify(state));
    stateByUid.set(uid, state);
  }

  function mutate(uid, update) {
    const previous = mutationByUid.get(uid) ?? Promise.resolve();
    const mutation = previous.catch(() => undefined).then(async () => {
      const next = normalizeStoredState(await update(await load(uid)));
      await persist(uid, next);
      return next;
    }).finally(() => {
      if (mutationByUid.get(uid) === mutation) mutationByUid.delete(uid);
    });
    mutationByUid.set(uid, mutation);
    return mutation;
  }

  function run(uid, task) {
    if (closingUids.has(uid)) return Promise.resolve({ status: "signed-out" });
    const epoch = runEpochByUid.get(uid) ?? 0;
    const existing = inFlightByUid.get(uid);
    if (existing?.epoch === epoch) return existing.promise;
    const promise = Promise.resolve().then(task).finally(() => {
      if (inFlightByUid.get(uid)?.promise === promise) inFlightByUid.delete(uid);
    });
    inFlightByUid.set(uid, { epoch, promise });
    return promise;
  }

  return {
    beginCleanup(uid) {
      closingUids.add(uid);
      const epoch = (runEpochByUid.get(uid) ?? 0) + 1;
      runEpochByUid.set(uid, epoch);
      return epoch;
    },
    async createRegistrationIntent(uid, token, renew = false) {
      let intent;
      await mutate(uid, (state) => {
        const reusable = !renew
          ? state.pending.find((candidate) => candidate.token === token)
          : null;
        intent = reusable ?? {
          token,
          registrationId: randomId(),
          generation: 0,
        };
        return reusable ? state : state;
      });
      if (!intent.generation) {
        intent = { ...intent, generation: await nextInstallationGeneration() };
        await mutate(uid, (state) => ({ ...state, pending: [...state.pending, intent] }));
      }
      return intent;
    },
    getInstallationId,
    resetInstallationLookup() {
      installationEpoch += 1;
      installationPromise = null;
    },
    getSnapshot(uid) {
      return load(uid).then((state) => ({
        active: state.active ? { ...state.active } : null,
        pending: state.pending.map((candidate) => ({ ...candidate })),
      }));
    },
    markRegistered(uid, entry) {
      return mutate(uid, (state) => {
        const latest = state.pending[state.pending.length - 1];
        if (!latest || latest.registrationId !== entry.registrationId) return state;
        return { active: entry, pending: [] };
      });
    },
    markUnregistered(uid, entry) {
      return mutate(uid, (state) => ({
        active: state.active?.registrationId === entry.registrationId ? null : state.active,
        pending: state.pending.filter(
          (candidate) => candidate.registrationId !== entry.registrationId
        ),
      }));
    },
    resume(uid) {
      const wasClosing = closingUids.delete(uid);
      if (wasClosing) runEpochByUid.set(uid, (runEpochByUid.get(uid) ?? 0) + 1);
      return wasClosing;
    },
    isCleanupCurrent(uid, epoch) {
      return closingUids.has(uid) && runEpochByUid.get(uid) === epoch;
    },
    run,
    async waitForIdle(uid, timeoutMs) {
      const inFlight = inFlightByUid.get(uid)?.promise;
      return inFlight ? settleWithin(inFlight, timeoutMs) : { status: "settled" };
    },
  };
}

async function cleanupPushRegistration({
  state, uid, installationId, unregister, timeoutMs, cleanupEpoch,
}) {
  const epoch = cleanupEpoch ?? state.beginCleanup(uid);
  const cleanup = async () => {
    const idleResult = await state.waitForIdle(uid, Math.floor(timeoutMs / 2));
    const stored = await state.getSnapshot(uid);
    if (!state.isCleanupCurrent(uid, epoch)) return;
    const entries = [
      ...(stored.active ? [stored.active] : []),
      ...(idleResult.status === "timeout" ? [] : stored.pending),
    ].filter((entry, index, all) =>
      all.findIndex((item) => item.registrationId === entry.registrationId) === index
    );
    await Promise.all(entries.map(async (entry) => {
      if (!state.isCleanupCurrent(uid, epoch)) return;
      let removed = false;
      try {
        removed = await unregister({ ...entry, installationId });
      } catch {}
      if (removed) await state.markUnregistered(uid, entry);
    }));
  };
  return settleWithin(cleanup(), timeoutMs);
}

async function cleanupCurrentPushRegistration({
  state, uid, getInstallationId, unregister, timeoutMs,
}) {
  const cleanupEpoch = state.beginCleanup(uid);
  const result = await settleWithin((async () => {
    const installationId = await getInstallationId();
    if (!state.isCleanupCurrent(uid, cleanupEpoch)) return;
    return cleanupPushRegistration({
      state, uid, installationId, unregister, timeoutMs, cleanupEpoch,
    });
  })(), timeoutMs);
  if (result.status === "timeout") state.resetInstallationLookup();
  return result;
}

module.exports = {
  INSTALLATION_STORAGE_KEY,
  INSTALLATION_GENERATION_KEY,
  PUSH_CLEANUP_TIMEOUT_MS,
  STORAGE_PREFIX,
  cleanupPushRegistration,
  cleanupCurrentPushRegistration,
  createPushRegistrationState,
  normalizeStoredState,
  settleWithin,
};
